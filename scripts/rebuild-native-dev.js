/**

 * Rebuild native addons for the current Node.js version (local dev / satellite).

 * Run after upgrading Node or npm run build: npm run rebuild:native:dev

 *

 * Stop dev servers and Windows services first if rebuild reports EPERM.

 */



const { execSync } = require('child_process');

const fs = require('fs');

const path = require('path');

const { stripNpmCrossCompileEnv } = require('./native-rebuild-env');



const ROOT = path.join(__dirname, '..');

const gypEnv = stripNpmCrossCompileEnv();

const prebuildInstall = path.join(ROOT, 'node_modules', 'prebuild-install', 'bin.js');



/** @type {{ name: string, prebuild?: boolean }[]} */

const modules = [

  { name: 'better-sqlite3', prebuild: true },

  { name: 'ftdi-d2xx' },

  { name: 'usb' },

];



if (process.env.npm_config_target) {

  console.warn(

    `Note: ignoring npm_config_target=${process.env.npm_config_target} — rebuilding for ${process.version}.\n`

  );

}



console.log(`Rebuilding native modules for Node ${process.version} (ABI ${process.versions.modules})…\n`);



function runPrebuildInstall(modPath) {

  if (!fs.existsSync(prebuildInstall)) return false;

  execSync(`node "${prebuildInstall}"`, { cwd: modPath, stdio: 'inherit', env: gypEnv });

  return fs.existsSync(path.join(modPath, 'build', 'Release', 'better_sqlite3.node'));

}



function runNodeGyp(modPath) {

  execSync('npx --yes node-gyp@10 rebuild', { cwd: modPath, stdio: 'inherit', env: gypEnv });

}



let failed = 0;

for (const { name, prebuild } of modules) {

  const modPath = path.join(ROOT, 'node_modules', name);

  if (!fs.existsSync(modPath)) continue;



  console.log(`→ ${name}`);

  try {

    if (prebuild) {

      let ok = false;

      try {

        ok = runPrebuildInstall(modPath);

      } catch (_) {}

      if (!ok) {

        console.log('  prebuild not available — compiling from source…');

        runNodeGyp(modPath);

      }

    } else if (fs.existsSync(path.join(modPath, 'binding.gyp'))) {

      runNodeGyp(modPath);

    } else {

      execSync(`npm rebuild ${name}`, { cwd: ROOT, stdio: 'inherit', env: gypEnv });

    }

  } catch {

    failed++;

    console.error(`  failed: ${name}`);

  }

}



if (failed) {

  console.error(

    '\nSome rebuilds failed (often EPERM — file in use). Close dmx-controller, satellite, and Thaluxis services, then retry.'

  );

  process.exit(1);

}

console.log('\nDone. Restart the app / Thaluxis Satellite service if running.');


