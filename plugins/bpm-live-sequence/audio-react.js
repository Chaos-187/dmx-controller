/** VU-style audio shaping: gain + slow fall (delay). */

const LEVEL_KEYS = ['bass', 'mid', 'treble', 'energy', 'sub_bass'];

let vuSmooth = null;

function resetVuAudioSmooth() {
  vuSmooth = null;
}

/**
 * @param {Record<string, number>} raw from levelsToAudio
 * @param {number} gain 0.25–3
 * @param {number} delayMs fall time when level drops (0 = instant)
 * @param {number} tickMs frame interval
 */
function processVuAudio(raw, gain, delayMs, tickMs) {
  const g = Math.max(0.25, Math.min(3, gain));
  const delay = Math.max(0, Math.min(2000, delayMs));
  const fall = delay <= 0 ? 1 : Math.min(1, tickMs / delay);

  const target = {};
  for (const k of LEVEL_KEYS) {
    target[k] = Math.min(1, Math.max(0, (raw[k] || 0) * g));
  }

  if (!vuSmooth) {
    vuSmooth = { ...target, beat: raw.beat ?? 0 };
    return { ...vuSmooth };
  }

  for (const k of LEVEL_KEYS) {
    const t = target[k];
    if (t >= vuSmooth[k]) vuSmooth[k] = t;
    else vuSmooth[k] += (t - vuSmooth[k]) * fall;
  }
  vuSmooth.beat = raw.beat ?? 0;

  return { ...vuSmooth };
}

module.exports = {
  resetVuAudioSmooth,
  processVuAudio,
};
