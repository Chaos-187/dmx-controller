@echo off
setlocal EnableExtensions
set "SERVICE=ThaluxisMaster"

call :EnsureAdmin || exit /b 1

sc query "%SERVICE%" >nul 2>&1
if errorlevel 1 (
  echo Service "%SERVICE%" is not installed.
  pause
  exit /b 0
)

echo Stopping "%SERVICE%"...
sc stop "%SERVICE%"
if errorlevel 1 (
  echo Stop failed — service may already be stopped.
)
echo.
sc query "%SERVICE%"
pause
exit /b 0

:EnsureAdmin
net session >nul 2>&1
if not errorlevel 1 exit /b 0
echo Requesting Administrator privileges...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
exit /b 1
