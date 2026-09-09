/**
 * Prepare a GitHub release — verify package.json version and print next steps.
 *
 * Usage:
 *   node scripts/release-prepare.js           # check current version
 *   node scripts/release-prepare.js 1.3.0     # set version in package.json
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PKG_PATH = path.join(ROOT, 'package.json');

const nextVersion = process.argv[2];
const pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf8'));

if (nextVersion) {
  if (!/^\d+\.\d+\.\d+$/.test(nextVersion)) {
    console.error('Version must be semver: major.minor.patch (e.g. 1.3.0)');
    process.exit(1);
  }
  pkg.version = nextVersion;
  fs.writeFileSync(PKG_PATH, JSON.stringify(pkg, null, 2) + '\n');
  console.log(`Updated package.json version → ${nextVersion}`);
}

const version = pkg.version;
const tag = `v${version}`;

console.log('\n=== Thaluxis DMX release checklist ===\n');
console.log(`Version: ${version}`);
console.log(`Tag:     ${tag}`);
console.log('\n1. Commit all changes');
console.log(`2. git tag ${tag}`);
console.log(`3. git push origin main`);
console.log(`4. git push origin ${tag}`);
console.log('\nGitHub Actions will build dist/, zip it, and publish a release.');
console.log('Hub installs check GitHub Releases and download dmx-controller-v*.zip\n');
