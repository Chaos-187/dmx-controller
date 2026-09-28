@echo off
setlocal EnableExtensions
set "INSTALL_DIR=%~dp0"
if not "%INSTALL_DIR:~-1%"=="\" set "INSTALL_DIR=%INSTALL_DIR%\"
set "EXE=%INSTALL_DIR%thaluxis-satellite.exe"
set "DATA_DIR=%ProgramData%\EYUP Events\ThaluxisSatellite"
set "LOG_DIR=%DATA_DIR%\logs"

if not exist "%LOG_DIR%" mkdir "%LOG_DIR%" 2>nul

>>"%LOG_DIR%\service-wrapper.log" echo [%date% %time%] run-satellite-service.bat starting
>>"%LOG_DIR%\service-wrapper.log" echo   INSTALL_DIR=%INSTALL_DIR%

if not exist "%EXE%" (
  >>"%LOG_DIR%\service-wrapper.log" echo ERROR: thaluxis-satellite.exe not found
  exit /b 1
)

cd /d "%INSTALL_DIR%"
"%EXE%" >>"%LOG_DIR%\service-out.log" 2>>"%LOG_DIR%\service-err.log"
set "RC=%ERRORLEVEL%"
>>"%LOG_DIR%\service-wrapper.log" echo [%date% %time%] thaluxis-satellite.exe exited with code %RC%
exit /b %RC%
