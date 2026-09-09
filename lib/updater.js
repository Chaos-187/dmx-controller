/**
 * GitHub release auto-updater for Thaluxis DMX (Windows / pkg builds).
 *
 * Checks GitHub Releases, downloads the release zip, and applies it via a
 * detached PowerShell script (stops service, copies files, preserves data/).
 */

const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const http = require('http');
const path = require('path');
const { execSync, spawn } = require('child_process');

const pkg = require('../package.json');

const APP_DIR = process.pkg ? path.dirname(process.execPath) : path.join(__dirname, '..');
const UPDATES_DIR = path.join(APP_DIR, 'updates');
const SERVICE_NAME = 'ThaluxisMaster';
const EXE_NAME = 'dmx-controller.exe';

const DEFAULT_REPO = (() => {
  const repo = pkg.repository;
  if (typeof repo === 'string') {
    const m = repo.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
    if (m) return `${m[1]}/${m[2]}`;
  }
  if (repo && repo.url) {
    const m = repo.url.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
    if (m) return `${m[1]}/${m[2].replace(/\.git$/, '')}`;
  }
  return process.env.DMX_UPDATE_REPO || 'Chaos-187/dmx-controller';
})();

/** @type {object} */
let state = {
  status: 'idle',
  currentVersion: pkg.version,
  latestVersion: null,
  releaseTag: null,
  releaseNotes: '',
  releaseUrl: null,
  assetName: null,
  assetSize: 0,
  downloadPath: null,
  stagingDir: null,
  progress: 0,
  error: null,
  checkedAt: null,
  canAutoApply: false,
  repo: DEFAULT_REPO,
};

function getAppDir() {
  return APP_DIR;
}

function canAutoUpdate() {
  if (process.platform !== 'win32') return false;
  return !!process.pkg || fs.existsSync(path.join(APP_DIR, EXE_NAME));
}

function parseVersion(v) {
  const m = String(v || '').replace(/^v/i, '').match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return [+m[1], +m[2], +m[3]];
}

function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return 0;
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  }
  return 0;
}

function getStatus() {
  return {
    ...state,
    currentVersion: pkg.version,
    canAutoApply: canAutoUpdate(),
  };
}

function setState(patch) {
  state = { ...state, ...patch, currentVersion: pkg.version, canAutoApply: canAutoUpdate() };
  return getStatus();
}

function githubApiPath(apiPath) {
  return {
    hostname: 'api.github.com',
    path: apiPath.startsWith('/') ? apiPath : `/${apiPath}`,
    headers: {
      'User-Agent': 'Thaluxis-DMX-Updater',
      Accept: 'application/vnd.github+json',
      ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
    },
  };
}

function httpGetJson(options) {
  return new Promise((resolve, reject) => {
    https.get(options, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 400) {
          if (res.statusCode === 404) {
            reject(new Error('No GitHub releases found yet — publish a release first (see docs/RELEASE.md)'));
            return;
          }
          reject(new Error(`GitHub API ${res.statusCode}: ${body.slice(0, 200)}`));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(new Error(`Invalid JSON from GitHub: ${e.message}`));
        }
      });
    }).on('error', reject);
  });
}

function pickReleaseAsset(release) {
  const assets = release.assets || [];
  const tag = release.tag_name || '';
  const preferred = assets.find(a => /^dmx-controller-v.+\.zip$/i.test(a.name));
  if (preferred) return preferred;
  return assets.find(a => /\.zip$/i.test(a.name) && /dmx-controller/i.test(a.name))
    || assets.find(a => /\.zip$/i.test(a.name))
    || null;
}

async function checkForUpdate({ force = false } = {}) {
  if (state.status === 'downloading') {
    return getStatus();
  }
  if (!force && state.checkedAt && Date.now() - state.checkedAt < 5 * 60 * 1000 && state.latestVersion) {
    return getStatus();
  }

  setState({ status: 'checking', error: null });

  try {
    const repo = process.env.DMX_UPDATE_REPO || DEFAULT_REPO;
    const release = await httpGetJson(githubApiPath(`/repos/${repo}/releases/latest`));
    const asset = pickReleaseAsset(release);
    if (!asset) throw new Error('No zip asset found on latest GitHub release');

    const latestVersion = String(release.tag_name || '').replace(/^v/i, '');
    const updateAvailable = compareVersions(pkg.version, latestVersion) < 0;

    return setState({
      status: updateAvailable ? 'available' : 'idle',
      latestVersion,
      releaseTag: release.tag_name,
      releaseNotes: release.body || '',
      releaseUrl: release.html_url,
      assetName: asset.name,
      assetSize: asset.size || 0,
      downloadPath: null,
      stagingDir: null,
      progress: 0,
      error: null,
      checkedAt: Date.now(),
      repo,
    });
  } catch (e) {
    return setState({
      status: 'error',
      error: e.message,
      checkedAt: Date.now(),
    });
  }
}

function downloadBinary(url, destPath, onProgress) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);

    const request = (targetUrl, redirects = 0) => {
      if (redirects > 8) {
        reject(new Error('Too many redirects while downloading update'));
        return;
      }
      const lib = targetUrl.startsWith('https:') ? https : http;
      lib.get(targetUrl, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          request(res.headers.location, redirects + 1);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`Download failed (${res.statusCode})`));
          return;
        }

        const total = +(res.headers['content-length'] || 0);
        let received = 0;
        res.on('data', (chunk) => {
          received += chunk.length;
          if (total > 0 && onProgress) onProgress(received / total);
        });
        res.pipe(file);
        file.on('finish', () => file.close(() => resolve({ bytes: received })));
      }).on('error', reject);
    };

    file.on('error', (err) => {
      fs.unlink(destPath, () => reject(err));
    });

    request(url);
  });
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function extractZipWindows(zipPath, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  const ps = `[Console]::OutputEncoding = [Text.UTF8Encoding]::UTF8; Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}' -Force`;
  execSync(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${ps}"`, { stdio: 'pipe' });
}

async function downloadUpdate() {
  if (!canAutoUpdate()) {
    throw new Error('Auto-update applies to Windows installs with dmx-controller.exe only');
  }
  if (state.status !== 'available' && state.status !== 'ready' && state.status !== 'error') {
    await checkForUpdate({ force: true });
  }
  if (compareVersions(pkg.version, state.latestVersion) >= 0) {
    throw new Error('Already on the latest version');
  }
  if (!state.assetName) {
    throw new Error('No release asset — run check first');
  }

  fs.mkdirSync(UPDATES_DIR, { recursive: true });
  const zipPath = path.join(UPDATES_DIR, state.assetName);
  const stagingDir = path.join(UPDATES_DIR, `staging-${state.releaseTag || state.latestVersion}`);

  setState({ status: 'downloading', error: null, progress: 0, downloadPath: zipPath, stagingDir });

  try {
    const repo = state.repo || DEFAULT_REPO;
    const release = await httpGetJson(githubApiPath(`/repos/${repo}/releases/latest`));
    const asset = pickReleaseAsset(release);
    if (!asset) throw new Error('Release asset no longer available');

    await downloadBinary(asset.browser_download_url, zipPath, (pct) => {
      setState({ progress: Math.round(pct * 100) });
    });

    if (fs.existsSync(stagingDir)) fs.rmSync(stagingDir, { recursive: true, force: true });
    extractZipWindows(zipPath, stagingDir);

    const manifestPath = path.join(stagingDir, 'version.json');
    let manifest = null;
    if (fs.existsSync(manifestPath)) {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    }

    return setState({
      status: 'ready',
      progress: 100,
      downloadPath: zipPath,
      stagingDir,
      manifest,
      sha256: sha256File(zipPath),
    });
  } catch (e) {
    return setState({ status: 'error', error: e.message, progress: 0 });
  }
}

function writeApplyScript(stagingDir, installDir, parentPid) {
  const scriptPath = path.join(UPDATES_DIR, 'apply-update.ps1');
  const logPath = path.join(UPDATES_DIR, 'apply-update.log');
  const content = `# Thaluxis DMX auto-update
$ErrorActionPreference = 'Stop'
$InstallDir = '${installDir.replace(/'/g, "''")}'
$StagingDir = '${stagingDir.replace(/'/g, "''")}'
$ServiceName = '${SERVICE_NAME}'
$LogFile = '${logPath.replace(/'/g, "''")}'
$ParentPid = ${parentPid}

function Log($msg) {
  $line = "$(Get-Date -Format o) $msg"
  Add-Content -LiteralPath $LogFile -Value $line
}

try {
  Log 'Waiting for hub process to exit...'
  if ($ParentPid -gt 0) {
    Wait-Process -Id $ParentPid -ErrorAction SilentlyContinue
  }
  Start-Sleep -Seconds 2

  $svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
  if ($svc -and $svc.Status -eq 'Running') {
    Log "Stopping service $ServiceName"
    Stop-Service -Name $ServiceName -Force
    Start-Sleep -Seconds 3
  }

  Log "Copying files from $StagingDir to $InstallDir"
  & robocopy $StagingDir $InstallDir /E /XD data updates /XF apply-update.ps1 apply-update.log /NFL /NDL /NJH /NJS /nc /ns /np | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "robocopy failed with exit code $LASTEXITCODE" }

  if ($svc) {
    Log "Starting service $ServiceName"
    Start-Service -Name $ServiceName
  } else {
    $exe = Join-Path $InstallDir '${EXE_NAME}'
    if (Test-Path $exe) {
      Log "Starting $exe"
      Start-Process -FilePath $exe -WorkingDirectory $InstallDir
    }
  }
  Log 'Update complete'
} catch {
  Log "Update failed: $_"
  exit 1
}
`;
  fs.writeFileSync(scriptPath, content, 'utf8');
  return scriptPath;
}

function applyUpdate() {
  if (state.status !== 'ready' || !state.stagingDir) {
    throw new Error('No downloaded update ready to apply');
  }
  if (!canAutoUpdate()) {
    throw new Error('Auto-apply is only supported for Windows exe installs');
  }

  const scriptPath = writeApplyScript(state.stagingDir, APP_DIR, process.pid);
  setState({ status: 'applying' });

  const child = spawn(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
    { detached: true, stdio: 'ignore', windowsHide: true },
  );
  child.unref();

  setTimeout(() => process.exit(0), 500);
  return { ok: true, message: 'Update is applying — the hub will restart shortly.' };
}

module.exports = {
  getAppDir,
  canAutoUpdate,
  getStatus,
  checkForUpdate,
  downloadUpdate,
  applyUpdate,
  compareVersions,
  DEFAULT_REPO,
};
