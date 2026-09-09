@echo off
REM Install Thaluxis Master as a Windows service (run as Administrator)
cd /d "%~dp0.."

if exist "dist\dmx-controller.exe" (
  echo Using packaged exe service installer...
  call "%~dp0service\install-service.bat" "%~dp0..\dist"
  exit /b %errorlevel%
)

echo Dev install: server.js via node-windows
echo Rebuilding native modules for Node...
call npm run rebuild:native
if errorlevel 1 (
  echo Rebuild failed — stop any running Thaluxis services and retry.
  pause
  exit /b 1
)
node scripts\windows-service.js install
pause
