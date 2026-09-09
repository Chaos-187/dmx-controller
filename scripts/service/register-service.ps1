#Requires -RunAsAdministrator
param(
    [Parameter(Mandatory = $true)]
    [string] $InstallDir
)

$ErrorActionPreference = 'Stop'
$ServiceName = 'ThaluxisMaster'
$InstallDir = $InstallDir.TrimEnd('\', '/')
$Exe = Join-Path $InstallDir 'dmx-controller.exe'
$Runner = Join-Path $InstallDir 'run-service.bat'
$Cmd = Join-Path $env:SystemRoot 'System32\cmd.exe'

function Get-PeMachineType {
    param([string] $Path)
    $bytes = [System.IO.File]::ReadAllBytes($Path)
    if ($bytes.Length -lt 0x40) { return $null }
    $peOffset = [BitConverter]::ToInt32($bytes, 0x3C)
    if ($peOffset -le 0 -or ($peOffset + 6) -ge $bytes.Length) { return $null }
    return [BitConverter]::ToUInt16($bytes, $peOffset + 4)
}

if (-not (Test-Path -LiteralPath $Exe)) {
    throw "dmx-controller.exe not found: $Exe"
}
if (-not (Test-Path -LiteralPath $Runner)) {
    throw "run-service.bat not found: $Runner"
}

$machine = Get-PeMachineType -Path $Exe
if ($machine -eq 0x014C -and [Environment]::Is64BitOperatingSystem) {
    throw 'dmx-controller.exe is 32-bit but this build requires 64-bit Windows.'
}
if ($machine -ne 0x8664) {
    Write-Warning ("dmx-controller.exe PE machine type 0x{0:X4} (expected 0x8664 x64)." -f $machine)
}

$existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "Removing existing $ServiceName service..."
    Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    & sc.exe delete $ServiceName | Out-Null
    Start-Sleep -Seconds 1
}

Stop-Process -Name 'dmx-controller' -Force -ErrorAction SilentlyContinue

$BinPath = "`"$Cmd`" /c `"$Runner`""
Write-Host "Registering $ServiceName"
Write-Host "  binPath: $BinPath"

New-Service -Name $ServiceName `
    -BinaryPathName $BinPath `
    -DisplayName 'Thaluxis Master' `
    -StartupType Automatic `
    -Description 'Thaluxis Master - DMX lighting control, Art-Net output, and VirtualDJ OS2L integration.' | Out-Null

Write-Host "Service registered."
