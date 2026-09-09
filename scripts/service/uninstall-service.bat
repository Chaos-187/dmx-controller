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

echo Stopping service "%SERVICE%"...
sc stop "%SERVICE%" >nul 2>&1
timeout /t 3 /nobreak >nul

echo Removing service "%SERVICE%"...
sc delete "%SERVICE%"
if errorlevel 1 (
  echo Failed to remove service. Stop the service manually and retry.
  pause
  exit /b 1
)

echo Service removed.
pause
exit /b 0

:EnsureAdmin
net session >nul 2>&1
if not errorlevel 1 exit /b 0
echo Requesting Administrator privileges...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
exit /b 1
