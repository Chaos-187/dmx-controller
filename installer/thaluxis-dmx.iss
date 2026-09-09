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

[Setup]
AppId={{A7B4E2F1-9C3D-4E8A-B5F6-1D2E3A4B5C6D}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}/issues
AppUpdatesURL={#MyAppURL}/releases
DefaultDirName={autopf}\EYUP Events\ThaluxisMaster
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
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

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked
Name: "installservice"; Description: "Install and start as a Windows service (ThaluxisMaster)"; GroupDescription: "Service:"; Flags: checkedonce

[Files]
; dist/ must exist (npm run build) — data/ is created at runtime, not overwritten on upgrade
Source: "..\dist\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs; Excludes: "data\*"

[Dirs]
Name: "{app}\data"; Permissions: users-modify
Name: "{app}\logs"; Permissions: users-modify

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{group}\Config (browser)"; Filename: "http://localhost/config.html"
Name: "{group}\Install Windows Service"; Filename: "{app}\install-service.bat"
Name: "{group}\Stop Windows Service"; Filename: "{app}\stop-service.bat"
Name: "{group}\Uninstall {#MyAppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\install-service.bat"; Parameters: "{app} silent"; Description: "Register ThaluxisMaster Windows service"; Flags: postinstall skipifsilent waituntilterminated; Tasks: installservice
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#StringChange(MyAppName, '&', '&&')}}"; Flags: postinstall nowait skipifsilent unchecked

[UninstallRun]
Filename: "{app}\stop-service.bat"; Flags: runhidden waituntilterminated
Filename: "{app}\uninstall-service.bat"; Parameters: "{app} silent"; Flags: runhidden waituntilterminated

[Code]
procedure CurStepChanged(CurStep: TSetupStep);
var
  ResultCode: Integer;
begin
  { On upgrade, stop the service before overwriting files }
  if (CurStep = ssInstall) and DirExists(ExpandConstant('{app}')) then
  begin
    if FileExists(ExpandConstant('{app}\stop-service.bat')) then
      Exec(ExpandConstant('{app}\stop-service.bat'), '', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  end;
end;
