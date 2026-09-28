@echo off
setlocal EnableExtensions
set "SERVICE=ThaluxisSatellite"
net stop "%SERVICE%" >nul 2>&1
sc stop "%SERVICE%" >nul 2>&1
timeout /t 2 /nobreak >nul
taskkill /F /IM thaluxis-satellite.exe >nul 2>&1
exit /b 0
