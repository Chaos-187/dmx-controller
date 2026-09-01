@echo off
REM Install Thaluxis Master (run as Administrator)
cd /d "%~dp0.."
echo Rebuilding native modules for Node...
call npm run rebuild:native
if errorlevel 1 (
  echo Rebuild failed — stop any running Thaluxis services and retry.
  pause
  exit /b 1
)
node scripts\windows-service.js install
pause
