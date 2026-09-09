@echo off
setlocal EnableExtensions
set "SERVICE=ThaluxisMaster"
set "INSTALL_DIR=%~dp0"
if not "%INSTALL_DIR:~-1%"=="\" set "INSTALL_DIR=%INSTALL_DIR%\"
set "DATA_DIR=%ProgramData%\EYUP Events\ThaluxisMaster"
set "LOG_DIR=%DATA_DIR%\logs"

echo.
echo === ThaluxisMaster service diagnostics ===
echo Install dir: %INSTALL_DIR%
echo Data dir:    %DATA_DIR%
echo Log dir:     %LOG_DIR%
echo OS:          %PROCESSOR_ARCHITECTURE%
echo.

echo --- Service status ---
sc query "%SERVICE%"
echo.

echo --- Service config ---
sc qc "%SERVICE%"
echo.

echo --- Port 80 listeners (hub default) ---
netstat -ano | findstr /R /C:":80 "
echo.

echo --- Recent log files ---
if exist "%LOG_DIR%" (
  dir /O-D "%LOG_DIR%"
  echo.
  if exist "%LOG_DIR%\service-wrapper.log" (
    echo --- service-wrapper.log (last 20 lines) ---
    powershell -NoProfile -Command "Get-Content -LiteralPath '%LOG_DIR%\service-wrapper.log' -Tail 20"
    echo.
  )
  if exist "%LOG_DIR%\service-err.log" (
    echo --- service-err.log (last 30 lines) ---
    powershell -NoProfile -Command "Get-Content -LiteralPath '%LOG_DIR%\service-err.log' -Tail 30"
    echo.
  )
) else (
  echo Log directory does not exist yet: %LOG_DIR%
  echo.
)

echo --- Manual test (5 second run) ---
if exist "%INSTALL_DIR%dmx-controller.exe" (
  set "DMX_DATA_DIR=%DATA_DIR%"
  cd /d "%INSTALL_DIR%"
  echo Running dmx-controller.exe for 5 seconds with DMX_DATA_DIR set...
  start "" /B "%INSTALL_DIR%dmx-controller.exe"
  timeout /t 5 /nobreak >nul
  taskkill /F /IM dmx-controller.exe >nul 2>&1
  echo Manual test finished - if Windows said the app cannot run on this PC, you need 64-bit Windows.
) else (
  echo dmx-controller.exe not found.
)
echo.
pause
