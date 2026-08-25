@echo off
REM Remove Thaluxis Satellite Windows service (run as Administrator)
cd /d "%~dp0.."
node scripts\windows-service.js uninstall
pause
