@echo off
chcp 65001 >nul
cd /d "%~dp0"
set PATH=%APPDATA%\npm;%PATH%
if not exist logs mkdir logs
for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmmss"') do set "LOG_TS=%%i"
set "LOG_FILE=%CD%\logs\start-local-%LOG_TS%.log"
echo Log file: "%LOG_FILE%"
powershell -NoProfile -ExecutionPolicy Bypass -Command "& { & $env:ComSpec /d /s /c 'node .\scripts\start-local.mjs 2>&1' | Tee-Object -FilePath $env:LOG_FILE; exit $LASTEXITCODE }"
set "EXIT_CODE=%ERRORLEVEL%"
echo.
if /i not "%NO_PAUSE%"=="true" pause
exit /b %EXIT_CODE%
