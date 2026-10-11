@echo off
setlocal
title AION 2 Interactive map - Build and deploy
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\aion2-map-viewer\Build-Deploy-Aion2Map.ps1" %*
set "build_result=%errorlevel%"
if not "%build_result%"=="0" (
    echo.
    echo Website deployment failed. See the error above.
    pause
)
exit /b %build_result%
