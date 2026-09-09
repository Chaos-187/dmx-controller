@echo off
REM Remove Thaluxis Master Windows service (run as Administrator)
cd /d "%~dp0.."

if exist "dist\dmx-controller.exe" (
  call "%~dp0service\uninstall-service.bat"
  exit /b %errorlevel%
)

node scripts\windows-service.js uninstall
pause
