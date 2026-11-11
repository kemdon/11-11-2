@echo off
chcp 65001 >nul
cd /d "%~dp0"
set PATH=%APPDATA%\npm;%PATH%
set NO_PROXY=127.0.0.1,localhost,::1
if not exist logs mkdir logs
for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmmss"') do set "LOG_TS=%%i"
set "LOG_FILE=%CD%\logs\update-local-%LOG_TS%.log"
echo Log file: "%LOG_FILE%"
if /i "%DRY_RUN%"=="true" set "VERIFY_ONLY=true"
if /i "%DEPLOY_DRY_RUN%"=="true" set "VERIFY_ONLY=true"
if /i "%~1"=="--dry-run" set "VERIFY_ONLY=true"
if /i "%VERIFY_ONLY%"=="true" (
  echo Explicit dry-run detected. Running local verification only. Cloudflare Pages deploy will be skipped.
  powershell -NoProfile -ExecutionPolicy Bypass -Command "& { & $env:ComSpec /d /s /c 'pnpm run audit:images 2>&1' | Tee-Object -FilePath $env:LOG_FILE; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; & $env:ComSpec /d /s /c 'pnpm run audit:admin-preview 2>&1' | Tee-Object -FilePath $env:LOG_FILE -Append; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; & $env:ComSpec /d /s /c 'pnpm run audit:keystatic:layout 2>&1' | Tee-Object -FilePath $env:LOG_FILE -Append; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; & $env:ComSpec /d /s /c 'pnpm run build 2>&1' | Tee-Object -FilePath $env:LOG_FILE -Append; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; & $env:ComSpec /d /s /c 'pnpm run audit:images -- --built 2>&1' | Tee-Object -FilePath $env:LOG_FILE -Append; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; Write-Host 'Skipped Cloudflare Pages deploy because VERIFY_ONLY=true.'; exit 0 }"
) else if /i "%DEPLOY_PREVIEW%"=="true" (
  echo DEPLOY_PREVIEW=true detected. Running Cloudflare Pages preview deployment flow.
  powershell -NoProfile -ExecutionPolicy Bypass -Command "& { & $env:ComSpec /d /s /c 'pnpm run preview:deploy 2>&1' | Tee-Object -FilePath $env:LOG_FILE; exit $LASTEXITCODE }"
) else (
  echo Running default Cloudflare Pages production deployment flow.
  powershell -NoProfile -ExecutionPolicy Bypass -Command "& { & $env:ComSpec /d /s /c 'pnpm run deploy 2>&1' | Tee-Object -FilePath $env:LOG_FILE; exit $LASTEXITCODE }"
)
set "EXIT_CODE=%ERRORLEVEL%"
echo.
if /i not "%NO_PAUSE%"=="true" pause
exit /b %EXIT_CODE%
