@echo off
chcp 65001 >nul
cd /d "%~dp0"
set PATH=%APPDATA%\npm;%PATH%
set NO_PROXY=127.0.0.1,localhost,::1

if /i "%~1"=="/?" goto :help
if /i "%~1"=="--help" goto :help

if not exist logs mkdir logs
for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmmss"') do set "LOG_TS=%%i"
set "LOG_FILE=%CD%\logs\translate-%LOG_TS%.log"
echo Log file: "%LOG_FILE%"
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command "& { $translateCommand = 'node .\scripts\i18n\translate-locales.mjs --stale %* 2>&1'; & $env:ComSpec /d /s /c $translateCommand | Tee-Object -FilePath $env:LOG_FILE; $translateCode = $LASTEXITCODE; if ($translateCode -ne 0) { exit $translateCode }; & $env:ComSpec /d /s /c 'pnpm run i18n:audit 2>&1' | Tee-Object -FilePath $env:LOG_FILE -Append; exit $LASTEXITCODE }"
set "EXIT_CODE=%ERRORLEVEL%"
echo.
if "%NO_PAUSE%"=="" pause
exit /b %EXIT_CODE%

:help
echo.
echo Translate website content
echo.
echo Usage:
echo   翻译网站.cmd                 incrementally translate stale files, then audit
echo   翻译网站.cmd --locale ja     incrementally translate one locale, then audit
echo   翻译网站.cmd --limit 1       incrementally translate limited files for testing
echo   翻译网站.cmd --force         fully retranslate content, then audit
echo.
echo Environment:
echo   NO_PAUSE=true       skip pause
echo.
exit /b 0
