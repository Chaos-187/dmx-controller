@echo off
REM Install Thaluxis Satellite as a Windows service (run as Administrator)
cd /d "%~dp0.."
node scripts\windows-service.js install
pause
