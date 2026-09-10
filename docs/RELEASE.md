# Releasing Thaluxis DMX

Releases are built automatically by GitHub Actions when you push a version tag. Installed hubs check GitHub Releases for updates and can download/apply new builds from **Config → About**.

## Quick release

```bash
# 1. Set the version (updates package.json)
npm run release:prepare -- 1.3.0

# 2. Commit, tag, and push
git add package.json
git commit -m "Release v1.3.0"
git tag v1.3.0
git push origin main
git push origin v1.3.0
```

GitHub Actions (`.github/workflows/release.yml`) will:

1. Verify `package.json` version matches the tag
2. Run `npm run build` (pkg exe + native addons + ffmpeg)
3. Zip `dist/*` as `dmx-controller-v1.3.0.zip`
4. Build `dmx-controller-1.3.0-setup.exe` with Inno Setup
5. Create a GitHub Release and attach the zip + installer

## Release assets

Each release includes:

| Asset | Purpose |
|-------|---------|
| `dmx-controller-v1.3.0-setup.exe` | Windows installer (Program Files, shortcuts, optional service) |
| `dmx-controller-v1.3.0.zip` | Portable / manual install; used by the in-app auto-updater |

Build the installer locally after `npm run build`:

```bash
npm run build:installer
```

Requires [Inno Setup 6](https://jrsoftware.org/isinfo.php) (`iscc` on PATH).

### Zip asset (auto-updater)

The auto-updater looks for:

- Preferred: `dmx-controller-v{version}.zip`
- Fallback: any `.zip` containing `dmx-controller` in the name

The zip includes:

| File | Purpose |
|------|---------|
| `dmx-controller.exe` | Main hub |
| `*.node`, `prebuilds/` | Native addons |
| `ffmpeg.exe`, etc. | Audio analysis (optional) |
| `version.json` | Build metadata |

## Windows installer

The **setup.exe** on GitHub Releases:

- Installs to `C:\Program Files\EYUP Events\ThaluxisMaster\`
- **Upgrades** an existing install in place (same AppId) — stops the service, replaces binaries, re-registers the service, preserves database
- Creates Start Menu shortcuts (hub, config URL, service scripts)
- Optional: desktop shortcut
- Optional: install or update **ThaluxisMaster** Windows service (checked by default)
- Database lives in **`%ProgramData%\EYUP Events\ThaluxisMaster\`** (not under Program Files)

## Windows service (exe install)

After extracting a release zip (or from the installed folder), run **`install-service.bat`** next to `dmx-controller.exe` (Administrator required). This registers **ThaluxisMaster** as a Windows service using **`cmd.exe`** to run **`run-service.bat`**, which launches the hub with the correct working directory and logging. Requires **64-bit Windows**.

If the service fails to start, check logs in **`%ProgramData%\EYUP Events\ThaluxisMaster\logs\`**:

| File | Contents |
|------|----------|
| `service-wrapper.log` | Service start/stop and exit codes |
| `service-err.log` | Hub stderr (crashes, port bind errors) |
| `service-out.log` | Hub stdout |

Run **`diagnose-service.bat`** from the install folder (Administrator not required) for service status, `sc qc` output, port 80 checks, and a short manual test.

In **services.msc**, the service path shows **`cmd.exe`** running **`run-service.bat`** — that is normal. The hub is **`dmx-controller.exe`**. Verify with:

```bat
sc qc ThaluxisMaster
```

Database and settings for Program Files installs live in **`%ProgramData%\EYUP Events\ThaluxisMaster\`** (writable by the service), not under Program Files.

| Script | Purpose |
|--------|---------|
| `install-service.bat` | Register & start the service |
| `uninstall-service.bat` | Stop & remove the service |
| `start-service.bat` | Start the service |
| `stop-service.bat` | Stop the service |
| `diagnose-service.bat` | Troubleshoot service / port / logs |

The auto-updater stops and restarts **ThaluxisMaster** when applying updates.

### Known issue: services.msc may show “Stopped” while the hub runs

The current registration uses **`sc.exe` + `cmd.exe` + batch**, not a native service binary. Windows sometimes reports **Stopped** in **services.msc** even when **`dmx-controller.exe`** is running (or the opposite: Stopped in the UI but the process exited). Trust **`sc query ThaluxisMaster`**, **`service-wrapper.log`**, and **http://localhost** more than the mmc status icon.

Future improvement (not implemented yet): a dedicated service host exe, or a vetted wrapper that reports **SERVICE_RUNNING** correctly to the SCM (e.g. WinSW on x64, or NSSM where that binary runs on the target PC).

**Development** (from git clone, `node server.js`): use `npm run service:install` or `scripts\install-master-service.cmd` — those use node-windows with `server.js`.

## Auto-update (installed hubs)

On **Windows** installs with `dmx-controller.exe`:

1. **Config → About → Check for updates** — queries GitHub Releases API
2. **Download update** — saves to `updates/` next to the exe
3. **Install & restart** — stops the Windows service (if installed), copies files, **preserves `data/`**, restarts

Dev installs (`node server.js`) show update availability but apply is exe-only.

### Environment variables

| Variable | Purpose |
|----------|---------|
| `DMX_UPDATE_REPO` | Override `owner/repo` (default from `package.json`) |
| `GITHUB_TOKEN` | Optional — higher GitHub API rate limits on the server |

## Manual release (without Actions)

```bash
npm run build
cd dist
# zip contents on Windows:
Compress-Archive -Path * -DestinationPath ../dmx-controller-v1.3.0.zip
```

Upload the zip to a new GitHub Release with tag `v1.3.0`.

## Version rules

- Tag must be `vMAJOR.MINOR.PATCH` (e.g. `v1.3.0`)
- `package.json` `version` must match the tag without the `v`
- CI fails if they do not match
