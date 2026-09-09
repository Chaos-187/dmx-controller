@echo off
setlocal EnableExtensions
set "SERVICE=ThaluxisMaster"
set "INSTALL_DIR=%~dp0"
if not "%~1"=="" set "INSTALL_DIR=%~1"
if /i "%~2"=="silent" set "SILENT=1"
if not "%INSTALL_DIR:~-1%"=="\" set "INSTALL_DIR=%INSTALL_DIR%\"
set "NSSM=%INSTALL_DIR%nssm.exe"

call :EnsureAdmin || exit /b 1

set "FOUND=0"
"%NSSM%" status %SERVICE% >nul 2>&1
if not errorlevel 1 set "FOUND=1"
sc query "%SERVICE%" >nul 2>&1
if not errorlevel 1 set "FOUND=1"

if "%FOUND%"=="0" (
  echo Service "%SERVICE%" is not installed.
  if not defined SILENT pause
  exit /b 0
)

echo Stopping service "%SERVICE%"...
net stop "%SERVICE%" >nul 2>&1
sc stop "%SERVICE%" >nul 2>&1
timeout /t 3 /nobreak >nul

if exist "%NSSM%" (
  echo Removing NSSM service "%SERVICE%"...
  "%NSSM%" remove %SERVICE% confirm
) else (
  echo Removing legacy sc.exe service "%SERVICE%"...
  sc delete "%SERVICE%"
)

if errorlevel 1 (
  echo Failed to remove service.
  if not defined SILENT pause
  exit /b 1
)

echo Service removed.
if not defined SILENT pause
exit /b 0

:EnsureAdmin
net session >nul 2>&1
if not errorlevel 1 exit /b 0
if defined SILENT exit /b 1
echo Requesting Administrator privileges...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
exit /b 1
