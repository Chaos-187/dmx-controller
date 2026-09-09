@echo off
setlocal EnableExtensions
REM Launched by NSSM — sets env, working dir, and logging under ProgramData.
set "INSTALL_DIR=%~dp0"
if not "%INSTALL_DIR:~-1%"=="\" set "INSTALL_DIR=%INSTALL_DIR%\"
set "EXE=%INSTALL_DIR%dmx-controller.exe"
set "DATA_DIR=%ProgramData%\EYUP Events\ThaluxisMaster"
set "LOG_DIR=%DATA_DIR%\logs"
set "DMX_DATA_DIR=%DATA_DIR%"

if not exist "%LOG_DIR%" mkdir "%LOG_DIR%" 2>nul

>>"%LOG_DIR%\service-wrapper.log" echo [%date% %time%] run-service.bat starting
>>"%LOG_DIR%\service-wrapper.log" echo   INSTALL_DIR=%INSTALL_DIR%
>>"%LOG_DIR%\service-wrapper.log" echo   DMX_DATA_DIR=%DMX_DATA_DIR%

if not exist "%EXE%" (
  >>"%LOG_DIR%\service-wrapper.log" echo ERROR: dmx-controller.exe not found
  exit /b 1
)

cd /d "%INSTALL_DIR%"
"%EXE%" >>"%LOG_DIR%\service-out.log" 2>>"%LOG_DIR%\service-err.log"
set "RC=%ERRORLEVEL%"
>>"%LOG_DIR%\service-wrapper.log" echo [%date% %time%] dmx-controller.exe exited with code %RC%
exit /b %RC%
