@echo off
chcp 65001 >nul
cd /d "%~dp0"
set PATH=%APPDATA%\npm;%PATH%

:: Set Taobao npm mirror
set npm_config_registry=https://registry.npmmirror.com

node ".\scripts\setup.mjs"
echo.
pause
