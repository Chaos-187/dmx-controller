; Thaluxis DMX — Windows installer (Inno Setup 6)
; Choose Hub (show PC) or Satellite (VDJ laptop) at install time.
; Build: npm run build  then  iscc installer\thaluxis-dmx.iss /DMyAppVersion=x.y.z

#ifndef MyAppVersion
  #define MyAppVersion "0.0.0"
#endif

#define MyAppPublisher "EYUP Events"
#define MyAppURL "https://github.com/Chaos-187/dmx-controller"
#define MyHubUninstallRegKey "SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\{A7B4E2F1-9C3D-4E8A-B5F6-1D2E3A4B5C6D}_is1"
#define MySatUninstallRegKey "SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\{B8C5F3A2-0D4E-5F9B-C6A7-2E3F4B5C6D7E}_is1"

[Setup]
AppId={{A7B4E2F1-9C3D-4E8A-B5F6-1D2E3A4B5C6D}
AppName=Thaluxis DMX
AppVersion={#MyAppVersion}
AppVerName=Thaluxis DMX {#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}/issues
AppUpdatesURL={#MyAppURL}/releases
DefaultDirName={code:GetDefaultInstallDir}
DefaultGroupName=Thaluxis DMX
DisableDirPage=auto
DisableProgramGroupPage=auto
UsePreviousAppDir=no
CloseApplications=force
CloseApplicationsFilter=dmx-controller.exe,thaluxis-satellite.exe
RestartApplications=no
LicenseFile=
OutputDir=..
OutputBaseFilename=dmx-controller-{#MyAppVersion}-setup
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=admin
ArchitecturesInstallIn64BitMode=x64
SetupLogging=yes
AppMutex=ThaluxisMasterSetupMutex,dmx-controller.exe,thaluxis-satellite.exe

[Types]
Name: "hub"; Description: "Thaluxis Hub — lighting control server (show PC)"
Name: "satellite"; Description: "Thaluxis Satellite — VirtualDJ laptop (OS2L + track sync)"

[Components]
Name: "hub"; Description: "Hub application"; Types: hub; Flags: fixed
Name: "satellite"; Description: "Satellite application"; Types: satellite; Flags: fixed

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked
Name: "installhubservice"; Description: "Install or update the ThaluxisMaster Windows service (hub)"; GroupDescription: "Service:"; Flags: checkedonce; Components: hub
Name: "installsatservice"; Description: "Install or update the Thaluxis Satellite Windows service"; GroupDescription: "Service:"; Flags: checkedonce; Components: satellite

[Files]
; ── Hub (full dist except satellite-only exe) ──
Source: "..\dist\dmx-controller.exe"; DestDir: "{app}"; Flags: ignoreversion; Components: hub
Source: "..\dist\*.node"; DestDir: "{app}"; Flags: ignoreversion; Components: hub
Source: "..\dist\prebuilds\*"; DestDir: "{app}\prebuilds"; Flags: ignoreversion recursesubdirs createallsubdirs; Components: hub
Source: "..\dist\workers\*"; DestDir: "{app}\workers"; Flags: ignoreversion recursesubdirs createallsubdirs; Components: hub
Source: "..\dist\plugins\*"; DestDir: "{app}\plugins"; Flags: ignoreversion recursesubdirs createallsubdirs; Components: hub
Source: "..\dist\ffmpeg.exe"; DestDir: "{app}"; Flags: ignoreversion; Components: hub
Source: "..\dist\ffplay.exe"; DestDir: "{app}"; Flags: ignoreversion; Components: hub
Source: "..\dist\ffprobe.exe"; DestDir: "{app}"; Flags: ignoreversion; Components: hub
Source: "..\dist\version.json"; DestDir: "{app}"; Flags: ignoreversion; Components: hub
Source: "..\dist\run-service.bat"; DestDir: "{app}"; Flags: ignoreversion; Components: hub
Source: "..\dist\install-service.bat"; DestDir: "{app}"; Flags: ignoreversion; Components: hub
Source: "..\dist\uninstall-service.bat"; DestDir: "{app}"; Flags: ignoreversion; Components: hub
Source: "..\dist\stop-service.bat"; DestDir: "{app}"; Flags: ignoreversion; Components: hub
Source: "..\dist\start-service.bat"; DestDir: "{app}"; Flags: ignoreversion; Components: hub
Source: "..\dist\diagnose-service.bat"; DestDir: "{app}"; Flags: ignoreversion; Components: hub
Source: "..\dist\prepare-upgrade.bat"; DestDir: "{app}"; Flags: ignoreversion; Components: hub
Source: "..\dist\register-service.ps1"; DestDir: "{app}"; Flags: ignoreversion; Components: hub

; ── Satellite (minimal runtime next to exe) ──
Source: "..\dist\thaluxis-satellite.exe"; DestDir: "{app}"; Flags: ignoreversion; Components: satellite
Source: "..\dist\better_sqlite3.node"; DestDir: "{app}"; Flags: ignoreversion; Components: satellite
Source: "..\dist\ffmpeg.exe"; DestDir: "{app}"; Flags: ignoreversion; Components: satellite
Source: "..\dist\ffprobe.exe"; DestDir: "{app}"; Flags: ignoreversion; Components: satellite
Source: "..\dist\run-satellite-service.bat"; DestDir: "{app}"; Flags: ignoreversion; Components: satellite
Source: "..\dist\install-satellite-service.bat"; DestDir: "{app}"; Flags: ignoreversion; Components: satellite
Source: "..\dist\uninstall-satellite-service.bat"; DestDir: "{app}"; Flags: ignoreversion; Components: satellite
Source: "..\dist\prepare-satellite-upgrade.bat"; DestDir: "{app}"; Flags: ignoreversion; Components: satellite
Source: "..\dist\register-satellite-service.ps1"; DestDir: "{app}"; Flags: ignoreversion; Components: satellite
Source: "..\dist\satellite-config.example.json"; DestDir: "{app}"; Flags: ignoreversion; Components: satellite

[Icons]
Name: "{group}\Thaluxis Hub"; Filename: "{app}\dmx-controller.exe"; Components: hub
Name: "{group}\Hub Config (browser)"; Filename: "http://localhost/config.html"; Components: hub
Name: "{group}\Install Hub Service"; Filename: "{app}\install-service.bat"; Components: hub
Name: "{group}\Thaluxis Satellite"; Filename: "{app}\thaluxis-satellite.exe"; Components: satellite
Name: "{group}\Satellite Status (browser)"; Filename: "http://localhost:8788"; Components: satellite
Name: "{group}\Install Satellite Service"; Filename: "{app}\install-satellite-service.bat"; Components: satellite
Name: "{group}\Uninstall Thaluxis DMX"; Filename: "{uninstallexe}"
Name: "{autodesktop}\Thaluxis Hub"; Filename: "{app}\dmx-controller.exe"; Tasks: desktopicon; Components: hub
Name: "{autodesktop}\Thaluxis Satellite"; Filename: "{app}\thaluxis-satellite.exe"; Tasks: desktopicon; Components: satellite

[Run]
Filename: "{app}\install-service.bat"; Parameters: """{app}"" silent"; Description: "Register ThaluxisMaster service"; Flags: postinstall waituntilterminated; Tasks: installhubservice; Components: hub
Filename: "{app}\install-satellite-service.bat"; Parameters: """{app}"" silent"; Description: "Register Thaluxis Satellite service"; Flags: postinstall waituntilterminated; Tasks: installsatservice; Components: satellite
Filename: "{app}\dmx-controller.exe"; Description: "Launch Thaluxis Hub"; Flags: postinstall nowait skipifsilent unchecked; Components: hub
Filename: "{app}\thaluxis-satellite.exe"; Description: "Launch Thaluxis Satellite"; Flags: postinstall nowait skipifsilent unchecked; Components: satellite

[UninstallRun]
Filename: "{app}\prepare-upgrade.bat"; Parameters: """{app}"""; Flags: runhidden waituntilterminated; Components: hub
Filename: "{app}\uninstall-service.bat"; Parameters: """{app}"" silent"; Flags: runhidden waituntilterminated; Components: hub
Filename: "{app}\prepare-satellite-upgrade.bat"; Flags: runhidden waituntilterminated; Components: satellite
Filename: "{app}\uninstall-satellite-service.bat"; Parameters: "silent"; Flags: runhidden waituntilterminated; Components: satellite

[Code]
function IsHubInstall(): Boolean;
begin
  Result := IsComponentSelected('hub');
end;

function IsSatInstall(): Boolean;
begin
  Result := IsComponentSelected('satellite');
end;

{ DefaultDirName={code:...} runs before the wizard exists — do not use IsComponentSelected there. }
function GetDefaultInstallDir(Param: String): String;
begin
  Result := ExpandConstant('{autopf}\EYUP Events\ThaluxisMaster');
end;

function ResolvedInstallDir(): String;
begin
  if IsSatInstall() and not IsHubInstall() then
    Result := ExpandConstant('{autopf}\EYUP Events\ThaluxisSatellite')
  else
    Result := ExpandConstant('{autopf}\EYUP Events\ThaluxisMaster');
end;

procedure CurPageChanged(CurPageID: Integer);
begin
  { Hub vs satellite is chosen on the type/components pages — set {app} after that. }
  if (CurPageID = wpSelectComponents) or (CurPageID = wpSelectDir) or (CurPageID = wpSelectTasks) then
    WizardForm.DirEdit.Text := ResolvedInstallDir();
end;

function GetExistingInstallPath(): String;
var
  ResultCode: Integer;
begin
  Result := '';
  if IsHubInstall() then
  begin
    if RegQueryStringValue(HKLM64, '{#MyHubUninstallRegKey}', 'InstallLocation', Result) then Exit;
    if RegQueryStringValue(HKLM, '{#MyHubUninstallRegKey}', 'InstallLocation', Result) then Exit;
    Result := ExpandConstant('{autopf}\EYUP Events\ThaluxisMaster');
  end
  else
  begin
    if RegQueryStringValue(HKLM64, '{#MySatUninstallRegKey}', 'InstallLocation', Result) then Exit;
    Result := ExpandConstant('{autopf}\EYUP Events\ThaluxisSatellite');
  end;
end;

function GetInstalledVersion(): String;
begin
  Result := '';
  if RegQueryStringValue(HKLM64, '{#MyHubUninstallRegKey}', 'DisplayVersion', Result) then Exit;
  if RegQueryStringValue(HKLM, '{#MyHubUninstallRegKey}', 'DisplayVersion', Result) then Exit;
  if RegQueryStringValue(HKLM64, '{#MySatUninstallRegKey}', 'DisplayVersion', Result) then Exit;
  if RegQueryStringValue(HKLM, '{#MySatUninstallRegKey}', 'DisplayVersion', Result) then Exit;
end;

function InitializeSetup(): Boolean;
var
  PrevVersion: String;
begin
  Result := True;
  PrevVersion := GetInstalledVersion();
  if PrevVersion <> '' then
    MsgBox('An existing installation was found (version ' + PrevVersion + ').' + #13#10 +
      'This setup will upgrade to version {#MyAppVersion}.', mbInformation, MB_OK);
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
  AppPath: String;
begin
  Result := '';
  NeedsRestart := False;
  AppPath := GetExistingInstallPath();

  if IsHubInstall() then
  begin
    if FileExists(AppPath + '\prepare-upgrade.bat') then
      Exec(AppPath + '\prepare-upgrade.bat', '"' + AppPath + '"', AppPath, SW_HIDE, ewWaitUntilTerminated, ResultCode);
    Exec(ExpandConstant('{cmd}'), '/C taskkill /F /IM dmx-controller.exe', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  end;

  if IsSatInstall() then
  begin
    if FileExists(AppPath + '\prepare-satellite-upgrade.bat') then
      Exec(AppPath + '\prepare-satellite-upgrade.bat', '', AppPath, SW_HIDE, ewWaitUntilTerminated, ResultCode);
    Exec(ExpandConstant('{cmd}'), '/C taskkill /F /IM thaluxis-satellite.exe', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  end;
end;
