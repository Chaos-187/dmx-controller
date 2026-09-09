@echo off
setlocal EnableExtensions
set "SERVICE=ThaluxisMaster"
if not "%~1"=="" (
  set "INSTALL_DIR=%~1"
) else (
  set "INSTALL_DIR=%~dp0"
)
if not "%INSTALL_DIR:~-1%"=="\" set "INSTALL_DIR=%INSTALL_DIR%\"
set "EXE=%INSTALL_DIR%dmx-controller.exe"

call :EnsureAdmin || exit /b 1

if not exist "%EXE%" (
  echo.
  echo ERROR: dmx-controller.exe not found in:
  echo   %INSTALL_DIR%
  echo.
  echo Place this script next to dmx-controller.exe ^(the dist folder^).
  pause
  exit /b 1
)

sc query "%SERVICE%" >nul 2>&1
if not errorlevel 1 (
  echo Service "%SERVICE%" is already installed.
  sc qc "%SERVICE%"
  echo.
  pause
  exit /b 0
)

echo Installing Thaluxis Master service...
echo   Executable: %EXE%
echo.

sc create "%SERVICE%" binPath= "%EXE%" start= auto DisplayName= "Thaluxis Master"
if errorlevel 1 (
  echo Failed to create service.
  pause
  exit /b 1
)

sc description "%SERVICE%" "Thaluxis Master - DMX lighting control, Art-Net output, and VirtualDJ OS2L integration."

echo Starting service...
sc start "%SERVICE%"
echo.
sc query "%SERVICE%"
echo.
echo Web UI: http://localhost
echo Database: %INSTALL_DIR%data\dmx-controller.db
echo.
pause
exit /b 0

:EnsureAdmin
net session >nul 2>&1
if not errorlevel 1 exit /b 0
echo Requesting Administrator privileges...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
exit /b 1
