/**
 * In-process mirror of DMX universe buffers (512 channels per local universe).
 * Updated whenever the server sends channel data to Art-Net / USB outputs.
 */

const universes = new Map();
let revision = 0;

function bumpRevision() {
  revision += 1;
}

function getRevision() {
  return revision;
}

function ensureUniverse(universe) {
  const u = universe || 1;
  if (!universes.has(u)) universes.set(u, new Uint8Array(512));
  return universes.get(u);
}

function setChannel(universe, channel, value) {
  const buf = ensureUniverse(universe);
  const ch = Math.max(1, Math.min(512, +channel));
  const v = Math.max(0, Math.min(255, Math.round(+value)));
  const i = ch - 1;
  if (buf[i] !== v) {
    buf[i] = v;
    bumpRevision();
  }
}

function setChannels(universe, channels) {
  if (!Array.isArray(channels) || channels.length === 0) return;
  const buf = ensureUniverse(universe);
  let changed = false;
  for (const { ch, val } of channels) {
    const c = Math.max(1, Math.min(512, +ch));
    const v = Math.max(0, Math.min(255, Math.round(+val)));
    const i = c - 1;
    if (buf[i] !== v) {
      buf[i] = v;
      changed = true;
    }
  }
  if (changed) bumpRevision();
}

function setFullUniverse(universe, data) {
  const buf = ensureUniverse(universe);
  const arr = Array.isArray(data) ? data : [];
  for (let i = 0; i < 512; i++) {
    buf[i] = i < arr.length ? Math.max(0, Math.min(255, Math.round(+arr[i]))) : 0;
  }
  bumpRevision();
}

function blackout() {
  for (const buf of universes.values()) buf.fill(0);
  bumpRevision();
}

function getChannel(universe, channel) {
  const buf = universes.get(universe || 1);
  if (!buf) return 0;
  const ch = Math.max(1, Math.min(512, +channel));
  return buf[ch - 1] || 0;
}

module.exports = {
  setChannel,
  setChannels,
  setFullUniverse,
  blackout,
  getChannel,
  getRevision,
};
