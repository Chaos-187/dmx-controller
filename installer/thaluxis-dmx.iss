; Thaluxis DMX — Windows installer (Inno Setup 6)
; Build locally:  iscc installer\thaluxis-dmx.iss /DMyAppVersion=1.2.0
; CI builds after npm run build — see .github/workflows/release.yml

#ifndef MyAppVersion
  #define MyAppVersion "0.0.0"
#endif

#define MyAppName "Thaluxis DMX"
#define MyAppPublisher "EYUP Events"
#define MyAppExeName "dmx-controller.exe"
#define MyAppURL "https://github.com/Chaos-187/dmx-controller"
#define MyInstallSubdir "EYUP Events\ThaluxisMaster"
#define MyUninstallRegKey "SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\{A7B4E2F1-9C3D-4E8A-B5F6-1D2E3A4B5C6D}_is1"

[Setup]
AppId={{A7B4E2F1-9C3D-4E8A-B5F6-1D2E3A4B5C6D}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}/issues
AppUpdatesURL={#MyAppURL}/releases
DefaultDirName={autopf}\{#MyInstallSubdir}
DefaultGroupName={#MyAppName}
DisableDirPage=auto
DisableProgramGroupPage=auto
UsePreviousAppDir=yes
CloseApplications=force
CloseApplicationsFilter={#MyAppExeName}
RestartApplications=no
LicenseFile=
OutputDir=..
OutputBaseFilename=dmx-controller-{#MyAppVersion}-setup
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=admin
ArchitecturesInstallIn64BitMode=x64
UninstallDisplayIcon={app}\{#MyAppExeName}
SetupLogging=yes
AppMutex=ThaluxisMasterSetupMutex,{#MyAppExeName}

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked
Name: "installservice"; Description: "Install or update the ThaluxisMaster Windows service"; GroupDescription: "Service:"; Flags: checkedonce

[Files]
; dist/ must exist (npm run build) — never ship or overwrite runtime data/
Source: "..\dist\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs; Excludes: "data\*"

[Dirs]
Name: "{app}\logs"; Permissions: users-modify

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{group}\Config (browser)"; Filename: "http://localhost/config.html"
Name: "{group}\Install Windows Service"; Filename: "{app}\install-service.bat"
Name: "{group}\Stop Windows Service"; Filename: "{app}\stop-service.bat"
Name: "{group}\Uninstall {#MyAppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\install-service.bat"; Parameters: """{app}"" silent"; Description: "Register or update ThaluxisMaster service"; Flags: postinstall waituntilterminated; Tasks: installservice
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#StringChange(MyAppName, '&', '&&')}}"; Flags: postinstall nowait skipifsilent unchecked

[UninstallRun]
Filename: "{app}\prepare-upgrade.bat"; Parameters: """{app}"""; Flags: runhidden waituntilterminated
Filename: "{app}\uninstall-service.bat"; Parameters: """{app}"" silent"; Flags: runhidden waituntilterminated

[Code]
function GetExistingInstallPath(): String;
begin
  Result := '';
  if RegQueryStringValue(HKLM64, '{#MyUninstallRegKey}', 'InstallLocation', Result) then
    Exit;
  if RegQueryStringValue(HKLM, '{#MyUninstallRegKey}', 'InstallLocation', Result) then
    Exit;
  Result := ExpandConstant('{autopf}\{#MyInstallSubdir}');
end;

function GetInstalledVersion(): String;
begin
  Result := '';
  if RegQueryStringValue(HKLM64, '{#MyUninstallRegKey}', 'DisplayVersion', Result) then
    Exit;
  if RegQueryStringValue(HKLM, '{#MyUninstallRegKey}', 'DisplayVersion', Result) then
    Exit;
  RegQueryStringValue(HKCU64, '{#MyUninstallRegKey}', 'DisplayVersion', Result);
end;

function InitializeSetup(): Boolean;
var
  PrevVersion: String;
  ExistingPath: String;
begin
  Result := True;
  PrevVersion := GetInstalledVersion();
  ExistingPath := GetExistingInstallPath();

  if (PrevVersion <> '') or (DirExists(ExistingPath) and FileExists(ExistingPath + '\{#MyAppExeName}')) then
  begin
    if PrevVersion <> '' then
      MsgBox(
        'An existing installation was found (version ' + PrevVersion + ').' + #13#10 + #13#10 +
        'This setup will upgrade to version {#MyAppVersion}.' + #13#10 +
        'The ThaluxisMaster service will be stopped during the upgrade.' + #13#10 +
        'Your database in ProgramData is preserved.',
        mbInformation, MB_OK)
    else
      MsgBox(
        'An existing Thaluxis Master folder was found.' + #13#10 + #13#10 +
        'This setup will upgrade the installation to version {#MyAppVersion}.',
        mbInformation, MB_OK);
  end;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
  AppPath: String;
begin
  Result := '';
  NeedsRestart := False;
  AppPath := GetExistingInstallPath();

  if not DirExists(AppPath) then
    Exit;

  if FileExists(AppPath + '\prepare-upgrade.bat') then
    Exec(AppPath + '\prepare-upgrade.bat', '"' + AppPath + '"', AppPath, SW_HIDE, ewWaitUntilTerminated, ResultCode)
  else if FileExists(AppPath + '\stop-service.bat') then
    Exec(AppPath + '\stop-service.bat', 'silent', AppPath, SW_HIDE, ewWaitUntilTerminated, ResultCode);

  Exec(ExpandConstant('{cmd}'), '/C taskkill /F /IM {#MyAppExeName}', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
end;
