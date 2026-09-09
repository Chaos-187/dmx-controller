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
set "NSSM=%INSTALL_DIR%nssm.exe"

call :EnsureAdmin || exit /b 1

if not exist "%EXE%" (
  echo.
  echo ERROR: dmx-controller.exe not found in:
  echo   %INSTALL_DIR%
  echo.
  if not defined SILENT pause
  exit /b 1
)

if not exist "%NSSM%" (
  echo.
  echo ERROR: nssm.exe not found in:
  echo   %INSTALL_DIR%
  echo Reinstall from a current release build ^(npm run build bundles nssm.exe^).
  echo.
  if not defined SILENT pause
  exit /b 1
)

echo Installing Thaluxis Master service via NSSM...
echo   Application: %EXE%
echo   Directory:   %INSTALL_DIR%
echo.

REM Remove legacy sc.exe registration ^(does not work with pkg exe^)
sc query "%SERVICE%" >nul 2>&1
if not errorlevel 1 (
  echo Removing legacy sc.exe service registration...
  sc stop "%SERVICE%" >nul 2>&1
  timeout /t 2 /nobreak >nul
  sc delete "%SERVICE%" >nul 2>&1
)

REM Reinstall NSSM service if it already exists
"%NSSM%" status %SERVICE% >nul 2>&1
if not errorlevel 1 (
  echo Updating existing NSSM service...
  net stop "%SERVICE%" >nul 2>&1
  timeout /t 2 /nobreak >nul
  "%NSSM%" remove %SERVICE% confirm >nul 2>&1
)

if not exist "%INSTALL_DIR%logs" mkdir "%INSTALL_DIR%logs"

set "DATA_DIR=%ProgramData%\EYUP Events\ThaluxisMaster"
if not exist "%DATA_DIR%" mkdir "%DATA_DIR%"
icacls "%DATA_DIR%" /grant *S-1-5-18:(OI)(CI)F /grant *S-1-5-32-544:(OI)(CI)F /grant *S-1-5-32-545:(OI)(CI)M /T >nul 2>&1

REM Migrate database out of Program Files if a previous install created it there
if exist "%INSTALL_DIR%data\dmx-controller.db" (
  if not exist "%DATA_DIR%\dmx-controller.db" (
    echo Migrating database to %DATA_DIR% ...
    xcopy "%INSTALL_DIR%data\*" "%DATA_DIR%\" /E /I /Y >nul 2>&1
  )
)

"%NSSM%" install %SERVICE% "%EXE%"
if errorlevel 1 (
  echo Failed to register service with NSSM.
  if not defined SILENT pause
  exit /b 1
)

"%NSSM%" set %SERVICE% AppDirectory "%INSTALL_DIR%"
"%NSSM%" set %SERVICE% AppEnvironmentExtra "DMX_DATA_DIR=%DATA_DIR%"
"%NSSM%" set %SERVICE% DisplayName "Thaluxis Master"
"%NSSM%" set %SERVICE% Description "Thaluxis Master - DMX lighting control, Art-Net output, and VirtualDJ OS2L integration."
"%NSSM%" set %SERVICE% Start SERVICE_AUTO_START
"%NSSM%" set %SERVICE% AppStdout "%INSTALL_DIR%logs\service-out.log"
"%NSSM%" set %SERVICE% AppStderr "%INSTALL_DIR%logs\service-err.log"
"%NSSM%" set %SERVICE% AppStdoutCreationDisposition 4
"%NSSM%" set %SERVICE% AppStderrCreationDisposition 4
"%NSSM%" set %SERVICE% AppRotateFiles 1
"%NSSM%" set %SERVICE% AppRotateOnline 1
"%NSSM%" set %SERVICE% AppRotateBytes 1048576

echo Starting service...
net start "%SERVICE%"
if errorlevel 1 (
  echo Service failed to start. Check logs in:
  echo   %INSTALL_DIR%logs\
  sc query "%SERVICE%"
  if not defined SILENT pause
  exit /b 1
)

echo.
sc query "%SERVICE%"
echo.
echo Web UI: http://localhost
echo Database: %DATA_DIR%\dmx-controller.db
echo Logs: %INSTALL_DIR%logs\
echo.
if not defined SILENT pause
exit /b 0

:EnsureAdmin
net session >nul 2>&1
if not errorlevel 1 exit /b 0
if defined SILENT exit /b 1
echo Requesting Administrator privileges...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -ArgumentList '%~1','silent' -Verb RunAs"
exit /b 1
