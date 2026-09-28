@echo off
setlocal EnableExtensions
set "SERVICE=ThaluxisSatellite"
if not "%~1"=="" (
  set "INSTALL_DIR=%~1"
) else (
  set "INSTALL_DIR=%~dp0"
)
if /i "%~2"=="silent" set "SILENT=1"
if not "%INSTALL_DIR:~-1%"=="\" set "INSTALL_DIR=%INSTALL_DIR%\"
set "EXE=%INSTALL_DIR%thaluxis-satellite.exe"
set "RUNNER=%INSTALL_DIR%run-satellite-service.bat"
set "REGISTER_PS=%INSTALL_DIR%register-satellite-service.ps1"
set "DATA_DIR=%ProgramData%\EYUP Events\ThaluxisSatellite"
set "LOG_DIR=%DATA_DIR%\logs"

call :EnsureAdmin || exit /b 1

if not exist "%EXE%" (
  echo ERROR: thaluxis-satellite.exe not found in %INSTALL_DIR%
  if not defined SILENT pause
  exit /b 1
)

echo Installing Thaluxis Satellite Windows service...
if not exist "%DATA_DIR%" mkdir "%DATA_DIR%"
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

set "INSTALL_DIR_PS=%INSTALL_DIR%"
if "%INSTALL_DIR_PS:~-1%"=="\" set "INSTALL_DIR_PS=%INSTALL_DIR_PS:~0,-1%"
powershell -NoProfile -ExecutionPolicy Bypass -File "%REGISTER_PS%" -InstallDir "%INSTALL_DIR_PS%"
if errorlevel 1 (
  echo Failed to register the Windows service.
  if not defined SILENT pause
  exit /b 1
)

net start "%SERVICE%"
if errorlevel 1 (
  echo Service failed to start. Check %LOG_DIR%\
  if not defined SILENT pause
  exit /b 1
)

echo Status UI: http://localhost:8788
if not defined SILENT pause
exit /b 0

:EnsureAdmin
net session >nul 2>&1
if not errorlevel 1 exit /b 0
if defined SILENT exit /b 1
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -LiteralPath '%~f0' -ArgumentList @('%~1','silent') -Verb RunAs"
exit /b 1
