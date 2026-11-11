@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul
cd /d "%~dp0"
set PATH=%APPDATA%\npm;%PATH%
if not exist logs mkdir logs
for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmmss"') do set "LOG_TS=%%i"
set "LOG_FILE=%CD%\logs\translate-%LOG_TS%.log"
echo Log file: "%LOG_FILE%"
echo [%date% %time%] 全量翻译工具启动> "%LOG_FILE%"

:menu
cls
echo ============================
echo        全量翻译工具
echo ============================
echo 1. 全部翻译 - 跳过已存在
echo 2. 全部重翻 - 覆盖已存在
echo 3. 指定语言 - 跳过已存在
echo 4. 指定语言 - 覆盖已存在
echo 5. 连通测试 - 翻译 1 个文件
echo 6. 退出
echo.
choice /c 123456 /n /m "请选择 [1-6]: "
set "action=%errorlevel%"

if "%action%"=="6" goto end
if "%action%"=="5" goto smoke_test
if "%action%"=="4" goto custom_force
if "%action%"=="3" goto custom_skip
if "%action%"=="2" goto all_force
if "%action%"=="1" goto all_skip
goto menu

:all_skip
set "FORCE_ARG="
set "LOCALE_INPUT="
goto choose_throttle

:all_force
set "FORCE_ARG=--force"
set "LOCALE_INPUT="
goto choose_throttle

:custom_skip
set "FORCE_ARG="
goto ask_locale

:custom_force
set "FORCE_ARG=--force"
goto ask_locale

:smoke_test
set "FORCE_ARG=--force"
set "LOCALE_INPUT=ja"
set "EXTRA_ARGS=--limit 1"
set "SKIP_AUDIT=1"
set "THROTTLE=1"
goto run

:ask_locale
echo.
echo 请输入语言代码，多个语言用英文逗号分隔。
echo 示例：zh-CN
echo 示例：ja,ko
echo 示例：fr,de,es
set /p "LOCALE_INPUT=语言代码: "
if not defined LOCALE_INPUT goto menu
goto choose_throttle

:choose_throttle
echo.
echo 并发速度：
echo 1. 保守 - 同时 2 个语言
echo 2. 推荐 - 同时 3 个语言
echo 3. 更快 - 同时 4 个语言
choice /c 123 /n /m "请选择速度 [1-3]: "
set "speed=%errorlevel%"
if "%speed%"=="3" set "THROTTLE=4"
if "%speed%"=="2" set "THROTTLE=3"
if "%speed%"=="1" set "THROTTLE=2"
if not defined THROTTLE set "THROTTLE=3"
goto run

:run
echo.
echo 开始执行翻译...
echo 并发数：%THROTTLE%
if defined LOCALE_INPUT echo 目标语言：%LOCALE_INPUT%
if defined FORCE_ARG goto show_force
echo 模式：跳过已存在文件
goto build_args

:show_force
echo 模式：覆盖已存在文件
goto build_args

:build_args
echo.
set "CMD_ARGS=--throttle-limit %THROTTLE%"
if defined LOCALE_INPUT set "CMD_ARGS=!CMD_ARGS! --locale %LOCALE_INPUT%"
if defined FORCE_ARG set "CMD_ARGS=!CMD_ARGS! %FORCE_ARG%"
if defined EXTRA_ARGS set "CMD_ARGS=!CMD_ARGS! %EXTRA_ARGS%"

powershell -NoProfile -ExecutionPolicy Bypass -Command "& { node '%~dp0scripts\i18n\translate-locales.mjs' !CMD_ARGS! 2>&1 | Tee-Object -FilePath $env:LOG_FILE -Append; exit $LASTEXITCODE }"
set "TRANSLATE_EXIT=%errorlevel%"
echo.
if "%TRANSLATE_EXIT%"=="0" goto audit
echo 翻译失败，已跳过审计。
echo.
pause
goto end

:audit
if defined SKIP_AUDIT goto smoke_ok
echo 开始执行翻译审计...
powershell -NoProfile -ExecutionPolicy Bypass -Command "& { pnpm i18n:audit 2>&1 | Tee-Object -FilePath $env:LOG_FILE -Append; exit $LASTEXITCODE }"
set "AUDIT_EXIT=%errorlevel%"
echo.
if "%AUDIT_EXIT%"=="0" goto audit_ok
echo 审计未通过，请根据上面的报错修复。
goto finish

:audit_ok
echo 翻译和审计已全部完成。
goto finish

:smoke_ok
echo 连通测试已完成。
goto finish

:finish
echo.
pause
goto end

:end
endlocal
