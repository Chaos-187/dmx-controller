@echo off
REM Install Thaluxis Satellite as a Windows service (run as Administrator)
cd /d "%~dp0.."
echo Rebuilding native modules for Node...
call npm run rebuild:native
if errorlevel 1 (
  echo Rebuild failed — stop the Thaluxis Satellite service and retry.
  pause
  exit /b 1
)
cd satellite
call npm install
node scripts\windows-service.js install
echo.
echo Logs if the service fails: satellite\daemon\thaluxissatellite.err.log
pause
