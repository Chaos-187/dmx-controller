@echo off
setlocal EnableExtensions
REM Stop hub + service before upgrade/reinstall (no prompts — safe for installer use)
set "SERVICE=ThaluxisMaster"
if not "%~1"=="" (
  set "INSTALL_DIR=%~1"
) else (
  set "INSTALL_DIR=%~dp0"
)
if not "%INSTALL_DIR:~-1%"=="\" set "INSTALL_DIR=%INSTALL_DIR%\"

net stop "%SERVICE%" >nul 2>&1
sc stop "%SERVICE%" >nul 2>&1
timeout /t 2 /nobreak >nul
taskkill /F /IM dmx-controller.exe >nul 2>&1

exit /b 0
