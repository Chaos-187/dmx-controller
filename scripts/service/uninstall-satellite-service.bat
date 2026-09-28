@echo off
setlocal EnableExtensions
set "SERVICE=ThaluxisSatellite"
if /i "%~1"=="silent" set "SILENT=1"
net stop "%SERVICE%" >nul 2>&1
sc stop "%SERVICE%" >nul 2>&1
timeout /t 2 /nobreak >nul
sc delete "%SERVICE%" >nul 2>&1
taskkill /F /IM thaluxis-satellite.exe >nul 2>&1
exit /b 0
