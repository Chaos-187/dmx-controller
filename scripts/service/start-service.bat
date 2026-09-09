@echo off
setlocal EnableExtensions
set "SERVICE=ThaluxisMaster"
if /i "%~1"=="silent" set "SILENT=1"
if /i "%~2"=="silent" set "SILENT=1"

call :EnsureAdmin || exit /b 1

sc query "%SERVICE%" >nul 2>&1
if errorlevel 1 (
  echo Service "%SERVICE%" is not installed. Run install-service.bat first.
  if not defined SILENT pause
  exit /b 1
)

echo Starting "%SERVICE%"...
net start "%SERVICE%"
if errorlevel 1 (
  echo Start failed — service may already be running.
)
echo.
sc query "%SERVICE%"
if not defined SILENT pause
exit /b 0

:EnsureAdmin
net session >nul 2>&1
if not errorlevel 1 exit /b 0
if defined SILENT exit /b 1
echo Requesting Administrator privileges...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -ArgumentList 'silent' -Verb RunAs"
exit /b 1
