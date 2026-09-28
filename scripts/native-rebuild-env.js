/**
 * npm_config_target (etc.) in the environment forces node-gyp to cross-compile.
 * Cursor/build shells often leave target=24.11.0 set — strip before local rebuilds.
 */

function stripNpmCrossCompileEnv(baseEnv = process.env) {
  const env = { ...baseEnv };
  for (const key of Object.keys(env)) {
    if (key.toLowerCase().startsWith('npm_config_')) {
      delete env[key];
    }
  }
  return env;
}

module.exports = { stripNpmCrossCompileEnv };
