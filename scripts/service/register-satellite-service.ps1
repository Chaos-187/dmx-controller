#Requires -RunAsAdministrator
param(
    [Parameter(Mandatory = $true)]
    [string] $InstallDir
)

$ErrorActionPreference = 'Stop'
$ServiceName = 'ThaluxisSatellite'
$InstallDir = ($InstallDir -replace '^[\s"]+|[\s"]+$', '').TrimEnd('\', '/')
if (-not $InstallDir) {
    throw 'InstallDir was empty or invalid.'
}
$Exe = Join-Path $InstallDir 'thaluxis-satellite.exe'
$Runner = Join-Path $InstallDir 'run-satellite-service.bat'
$Cmd = Join-Path $env:SystemRoot 'System32\cmd.exe'

if (-not (Test-Path -LiteralPath $Exe)) {
    throw "thaluxis-satellite.exe not found: $Exe"
}
if (-not (Test-Path -LiteralPath $Runner)) {
    throw "run-satellite-service.bat not found: $Runner"
}

$existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "Removing existing $ServiceName service..."
    Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    & sc.exe delete $ServiceName | Out-Null
    Start-Sleep -Seconds 1
}

Stop-Process -Name 'thaluxis-satellite' -Force -ErrorAction SilentlyContinue

$BinPath = "`"$Cmd`" /c `"$Runner`""
Write-Host "Registering $ServiceName"
Write-Host "  binPath: $BinPath"

New-Service -Name $ServiceName `
    -BinaryPathName $BinPath `
    -DisplayName 'Thaluxis Satellite' `
    -StartupType Automatic `
    -Description 'Thaluxis Satellite — VirtualDJ OS2L and track analysis for the Thaluxis DMX hub.' | Out-Null

Write-Host "Service registered."
