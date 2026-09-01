@echo off
REM Remove Thaluxis Master Windows service (run as Administrator)
cd /d "%~dp0.."
node scripts\windows-service.js uninstall
pause
