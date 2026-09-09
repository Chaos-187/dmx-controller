@echo off
setlocal EnableExtensions
set "SERVICE=ThaluxisMaster"
if not "%~1"=="" (
  set "INSTALL_DIR=%~1"
) else (
  set "INSTALL_DIR=%~dp0"
)
if /i "%~2"=="silent" set "SILENT=1"
if not "%INSTALL_DIR:~-1%"=="\" set "INSTALL_DIR=%INSTALL_DIR%\"
set "EXE=%INSTALL_DIR%dmx-controller.exe"
set "RUNNER=%INSTALL_DIR%run-service.bat"
set "REGISTER_PS=%INSTALL_DIR%register-service.ps1"
set "DATA_DIR=%ProgramData%\EYUP Events\ThaluxisMaster"
set "LOG_DIR=%DATA_DIR%\logs"

call :EnsureAdmin || exit /b 1

if not exist "%EXE%" (
  echo.
  echo ERROR: dmx-controller.exe not found in:
  echo   %INSTALL_DIR%
  echo.
  if not defined SILENT pause
  exit /b 1
)

if not exist "%RUNNER%" (
  echo.
  echo ERROR: run-service.bat not found in:
  echo   %INSTALL_DIR%
  echo Reinstall from a current release build.
  echo.
  if not defined SILENT pause
  exit /b 1
)

if not exist "%REGISTER_PS%" (
  echo.
  echo ERROR: register-service.ps1 not found in:
  echo   %INSTALL_DIR%
  echo Reinstall from a current release build.
  echo.
  if not defined SILENT pause
  exit /b 1
)

echo Installing Thaluxis Master Windows service...
echo   Hub:       %EXE%
echo   Launcher:  %RUNNER%
echo   Data:      %DATA_DIR%
echo.

if not exist "%DATA_DIR%" mkdir "%DATA_DIR%"
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"
icacls "%DATA_DIR%" /grant *S-1-5-18:(OI)(CI)F /grant *S-1-5-32-544:(OI)(CI)F /grant *S-1-5-32-545:(OI)(CI)M /T >nul 2>&1

REM Migrate database out of Program Files if a previous install created it there
if exist "%INSTALL_DIR%data\dmx-controller.db" (
  if not exist "%DATA_DIR%\dmx-controller.db" (
    echo Migrating database to %DATA_DIR% ...
    xcopy "%INSTALL_DIR%data\*" "%DATA_DIR%\" /E /I /Y >nul 2>&1
  )
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%REGISTER_PS%" -InstallDir "%INSTALL_DIR%"
if errorlevel 1 (
  echo Failed to register the Windows service.
  if not defined SILENT pause
  exit /b 1
)

echo Starting service...
net start "%SERVICE%"
if errorlevel 1 (
  echo Service failed to start. Check logs in:
  echo   %LOG_DIR%\
  echo Run diagnose-service.bat for more detail.
  sc query "%SERVICE%"
  if not defined SILENT pause
  exit /b 1
)

echo.
sc query "%SERVICE%"
echo.
echo Web UI: http://localhost
echo Database: %DATA_DIR%\dmx-controller.db
echo Logs: %LOG_DIR%\
echo.
if not defined SILENT pause
exit /b 0

:EnsureAdmin
net session >nul 2>&1
if not errorlevel 1 exit /b 0
if defined SILENT exit /b 1
echo Requesting Administrator privileges...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -LiteralPath '%~f0' -ArgumentList @('%INSTALL_DIR%','silent') -Verb RunAs"
exit /b 1
