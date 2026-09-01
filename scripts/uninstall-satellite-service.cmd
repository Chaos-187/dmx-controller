@echo off
REM Remove Thaluxis Satellite Windows service (run as Administrator)
cd /d "%~dp0..\satellite"
node scripts\windows-service.js uninstall
pause
