$ErrorActionPreference = 'Stop'
$toolRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

Push-Location $toolRoot
try {
    if (-not (Test-Path -LiteralPath '.\dist\index.html')) {
        node .\build-site.mjs
        if ($LASTEXITCODE -ne 0) { throw 'Map packaging failed. Build the native textures and data first.' }
    }
    Write-Host 'Opening AION 2 Interactive map at http://127.0.0.1:4179/' -ForegroundColor Cyan
    Start-Process 'http://127.0.0.1:4179/'
    node .\server.mjs
}
finally {
    Pop-Location
}
