[CmdletBinding()]
param(
    [ValidateRange(1, 65535)][int]$Port = 4179,
    [switch]$NoBrowser
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

Push-Location $toolRoot
try {
    $node = Get-Command node.exe -ErrorAction Stop
    $nodeVersion = & $node.Source --version
    if ($LASTEXITCODE -ne 0) { throw 'Install Node.js 22 or newer, then run this batch file again.' }
    if ([int]($nodeVersion.TrimStart('v').Split('.')[0]) -lt 22) { throw 'Node.js 22 or newer is required.' }
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
