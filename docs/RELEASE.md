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
4. Create a GitHub Release and attach the zip

## Release asset

Each release must include a **zip** of the `dist/` folder. The auto-updater looks for:

- Preferred: `dmx-controller-v{version}.zip`
- Fallback: any `.zip` containing `dmx-controller` in the name

The zip includes:

| File | Purpose |
|------|---------|
| `dmx-controller.exe` | Main hub |
| `*.node`, `prebuilds/` | Native addons |
| `ffmpeg.exe`, etc. | Audio analysis (optional) |
| `version.json` | Build metadata |

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
