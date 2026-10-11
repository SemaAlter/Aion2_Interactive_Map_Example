[CmdletBinding()]
param(
    [ValidateRange(1, 65535)][int]$Port = 4179,
    [switch]$NoBrowser,
    [switch]$DownloadNode
)
$ErrorActionPreference = 'Stop'
$toolRoot = $PSScriptRoot
$repoRoot = [IO.Path]::GetFullPath((Join-Path $toolRoot '..\..'))
$serverPath = Join-Path $toolRoot 'server.mjs'
$url = "http://127.0.0.1:$Port/"
$previousHost = $env:HOST
$previousPort = $env:PORT
$stoppedServer = $false
$packaged = $false
$startedServer = $null

function Start-MapServer {
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
    $logRoot = Join-Path $repoRoot 'development_logs'
    New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
    $script:outputLog = Join-Path $logRoot "map-viewer-$stamp.stdout.log"
    $script:errorLog = Join-Path $logRoot "map-viewer-$stamp.stderr.log"
    Start-Process -FilePath $node.Source -ArgumentList ('"' + $serverPath + '"') -WorkingDirectory $toolRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput $outputLog -RedirectStandardError $errorLog
}

function Test-NodeVersion($command) {
    if (-not $command) { return $false }
    $version = & $command.Source --version 2>$null
    return $LASTEXITCODE -eq 0 -and [int]("$version".TrimStart('v').Split('.')[0]) -ge 22
}

# Portable Node.js in .node\, so no administrator rights or system install are needed.
function Install-PortableNode($target) {
    $ProgressPreference = 'SilentlyContinue'
    $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $release = (Invoke-RestMethod -UseBasicParsing 'https://nodejs.org/dist/index.json') |
        Where-Object { $_.lts -and $_.files -contains "win-$arch-zip" } | Select-Object -First 1
    if (-not $release) { throw 'Could not find a Node.js LTS release to download.' }
    $name = "node-$($release.version)-win-$arch"
    $base = "https://nodejs.org/dist/$($release.version)"
    $temp = Join-Path ([IO.Path]::GetTempPath()) ([IO.Path]::GetRandomFileName())
    New-Item -ItemType Directory -Path $temp | Out-Null
    try {
        Write-Host "Downloading Node.js $($release.version) ($arch)..." -ForegroundColor Cyan
        $zip = Join-Path $temp "$name.zip"
        Invoke-WebRequest -UseBasicParsing -Uri "$base/$name.zip" -OutFile $zip
        $sums = (Invoke-WebRequest -UseBasicParsing -Uri "$base/SHASUMS256.txt").Content
        $expected = ($sums -split '\r?\n' | Where-Object { $_ -match "\s$([regex]::Escape("$name.zip"))$" }) -replace '\s.*$'
        if (-not $expected -or (Get-FileHash -Algorithm SHA256 $zip).Hash -ne $expected.Trim().ToUpperInvariant()) {
            throw 'Downloaded Node.js failed its SHA-256 check. Nothing was installed.'
        }
        Expand-Archive -LiteralPath $zip -DestinationPath $temp
        if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }
        Move-Item -LiteralPath (Join-Path $temp $name) -Destination $target
    } finally {
        Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue
    }
}

Push-Location $toolRoot
try {
    $portableNode = Join-Path $toolRoot '.node'
    $node = Get-Command (Join-Path $portableNode 'node.exe') -ErrorAction SilentlyContinue
    if (-not (Test-NodeVersion $node)) { $node = Get-Command node.exe -ErrorAction SilentlyContinue }
    if (-not (Test-NodeVersion $node)) {
        if (-not $DownloadNode) {
            $answer = Read-Host 'Node.js 22 or newer was not found. Download a portable copy into this folder (about 35 MB)? [Y/n]'
            if ($answer -and $answer -notmatch '^(y|yes)$') { throw 'Node.js 22 or newer is required. Install it from https://nodejs.org/, then run this batch file again.' }
        }
        Install-PortableNode $portableNode
        $node = Get-Command (Join-Path $portableNode 'node.exe') -ErrorAction Stop
        if (-not (Test-NodeVersion $node)) { throw 'The downloaded Node.js did not start.' }
    }
    $env:HOST = '127.0.0.1'
    $env:PORT = [string]$Port

    # Verify the listener before stopping anything. Never stop all Node processes.
    $listeners = @(Get-NetTCPConnection -State Listen -ErrorAction Stop | Where-Object LocalPort -eq $Port)
    $listenerIds = @($listeners | Select-Object -ExpandProperty OwningProcess -Unique)
    foreach ($listenerId in $listenerIds) {
        $listener = Get-CimInstance Win32_Process -Filter "ProcessId=$listenerId"
        $serverPattern = '(?:^|[\s"])(?:' + [regex]::Escape($serverPath) + '|tools[\\/]aion2-map-viewer[\\/]server\.mjs)(?:[\s"]|$)'
        if ($listener.ExecutablePath -ne $node.Source -or $listener.CommandLine -notmatch $serverPattern) {
            throw "Port $Port belongs to another application (PID $listenerId). Nothing was stopped."
        }
    }

    Write-Host 'Testing website...' -ForegroundColor Cyan
    & $node.Source --test 'tests/*.test.mjs'
    if ($LASTEXITCODE -ne 0) { throw 'Website tests failed. The running server was left unchanged.' }

    foreach ($listenerId in $listenerIds) {
        $listener = Get-CimInstance Win32_Process -Filter "ProcessId=$listenerId"
        if ($listener.ExecutablePath -ne $node.Source -or $listener.CommandLine -notmatch $serverPattern) { throw 'Listener changed during tests. Nothing else was stopped.' }
        Stop-Process -Id $listenerId -ErrorAction Stop
        Wait-Process -Id $listenerId -Timeout 10 -ErrorAction SilentlyContinue
        $stoppedServer = $true
    }
    Write-Host 'Building and deploying dist...' -ForegroundColor Cyan
    & $node.Source '.\build-site.mjs'
    if ($LASTEXITCODE -ne 0) { throw 'Website packaging failed. Check the missing asset or build error above.' }
    $packaged = $true
    $startedServer = Start-MapServer
    $deadline = (Get-Date).AddSeconds(30)
    do {
        $startedServer.Refresh()
        if ($startedServer.HasExited) { throw "Map server exited. Check $errorLog" }
        try {
            $health = Invoke-WebRequest -UseBasicParsing -Uri ($url + 'healthz') -TimeoutSec 2
            if ($health.StatusCode -eq 200 -and $health.Content -eq 'ok') { break }
        } catch { }
        if ((Get-Date) -ge $deadline) { throw "Map server did not become ready. Check $errorLog" }
        Start-Sleep -Milliseconds 250
    } while ($true)
    Write-Host "Website deployed: $url" -ForegroundColor Green
    Write-Host "Server PID: $($startedServer.Id). Logs: $outputLog"
    if (-not $NoBrowser) { Start-Process $url }
} catch {
    if ($startedServer -and -not $startedServer.HasExited) { Stop-Process -Id $startedServer.Id -ErrorAction SilentlyContinue }
    # Packaging retains the existing dist on failure; bring that release back.
    if ($stoppedServer -and -not $packaged -and (Test-Path -LiteralPath (Join-Path $toolRoot 'dist\index.html'))) {
        try { $restoredServer = Start-MapServer; Write-Host "Restarted retained release (PID $($restoredServer.Id))." } catch { Write-Warning 'Could not restart the retained release.' }
    }
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
} finally {
    $env:HOST = $previousHost
    $env:PORT = $previousPort
    Pop-Location
}
