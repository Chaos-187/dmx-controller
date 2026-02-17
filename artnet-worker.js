/**
 * Art-Net Worker Thread
 *
 * Runs in a separate thread to avoid blocking the main process.
 * Maintains a 512-byte DMX buffer per Art-Net node and transmits
 * Art-Net DMX (OpDmx) packets via UDP at a configurable frame rate.
 *
 * Art-Net Specification:
 *   - UDP port 6454 (0x1936)
 *   - OpDmx = 0x5000
 *   - Packet: 18-byte header + up to 512 bytes DMX data
 */

const { parentPort } = require('worker_threads');
const dgram = require('dgram');

// ─── Art-Net Constants ──────────────────────────────────────────────────────

const ARTNET_PORT = 6454;
const ARTNET_ID = Buffer.from('Art-Net\0');  // 8 bytes
const ARTNET_OP_DMX = 0x5000;               // OpDmx
const ARTNET_PROTOCOL_VERSION = 14;

// ─── State ──────────────────────────────────────────────────────────────────

/** @type {dgram.Socket} */
let udpSocket = null;

/**
 * Map of nodeId → node config + DMX buffer
 * Each node represents one Art-Net universe target
 */
const nodes = new Map();

/** Global sequence counter (0-255, wraps) */
let sequence = 1;

/** Interval handle for the transmit loop */
let txInterval = null;
let txRate = 44; // Hz

// ─── Utility ────────────────────────────────────────────────────────────────

function log(level, message) {
  if (parentPort) {
    parentPort.postMessage({ type: 'log', level, message });
  } else {
    const logger = console[level] || console.log;
    logger(message);
  }
}

function reply(type, data = {}) {
  if (parentPort) {
    parentPort.postMessage({ type, ...data });
  }
}

// ─── Art-Net Packet Builder ─────────────────────────────────────────────────

/**
 * Build an Art-Net OpDmx packet
 * @param {number} subnet    Art-Net subnet (0-15)
 * @param {number} universe  Art-Net universe (0-15)
 * @param {Buffer} dmxData   512 bytes of DMX channel data
 * @returns {Buffer}
 */
function buildArtDmxPacket(subnet, universe, dmxData) {
  const length = dmxData.length; // must be even, max 512
  const packet = Buffer.alloc(18 + length);

  // Header: "Art-Net\0"
  ARTNET_ID.copy(packet, 0);

  // OpCode: OpDmx (0x5000) — little-endian
  packet[8] = ARTNET_OP_DMX & 0xff;
  packet[9] = (ARTNET_OP_DMX >> 8) & 0xff;

  // Protocol version — big-endian
  packet[10] = 0x00;
  packet[11] = ARTNET_PROTOCOL_VERSION;

  // Sequence (1-255, 0 = disable)
  packet[12] = sequence;
  sequence = sequence >= 255 ? 1 : sequence + 1;

  // Physical port (informational)
  packet[13] = 0;

  // Sub-Uni: low nibble = universe, high nibble = subnet (within Net)
  // Art-Net 4 uses a 15-bit universe: Net(7) | SubNet(4) | Universe(4)
  // For simplicity, we pack SubUni as (subnet << 4) | universe in one byte,
  // and Net in the next byte (we default Net to 0).
  packet[14] = (subnet & 0x0f) << 4 | (universe & 0x0f);
  packet[15] = 0; // Net = 0

  // Length — big-endian
  packet[16] = (length >> 8) & 0xff;
  packet[17] = length & 0xff;

  // DMX data
  dmxData.copy(packet, 18);

  return packet;
}

// ─── Transmit Loop ──────────────────────────────────────────────────────────

function transmitAll() {
  if (!udpSocket) return;

  for (const [nodeId, node] of nodes) {
    if (!node.enabled) continue;

    try {
      const packet = buildArtDmxPacket(node.subnet, node.artnetUniverse, node.dmx);
      udpSocket.send(packet, 0, packet.length, node.port, node.ip, (err) => {
        if (err) {
          log('error', `[Art-Net] TX error → ${node.ip}:${node.port} — ${err.message}`);
        }
      });
    } catch (e) {
      log('error', `[Art-Net] Packet error for node ${nodeId}: ${e.message}`);
    }
  }
}

function startTxLoop(rate) {
  stopTxLoop();
  txRate = rate || 44;
  txInterval = setInterval(transmitAll, Math.round(1000 / txRate));
  log('info', `[Art-Net] TX loop started at ${txRate} fps`);
}

function stopTxLoop() {
  if (txInterval) {
    clearInterval(txInterval);
    txInterval = null;
  }
}

// ─── Node Management ────────────────────────────────────────────────────────

/**
 * Add or update an Art-Net output node
 */
function upsertNode({ id, ip, port, subnet, artnetUniverse, localUniverse, enabled }) {
  const existing = nodes.get(id);
  if (existing) {
    existing.ip = ip || existing.ip;
    existing.port = port || existing.port;
    existing.subnet = subnet ?? existing.subnet;
    existing.artnetUniverse = artnetUniverse ?? existing.artnetUniverse;
    existing.localUniverse = localUniverse ?? existing.localUniverse;
    existing.enabled = enabled !== undefined ? enabled : existing.enabled;
    log('info', `[Art-Net] Updated node ${id} → ${existing.ip}:${existing.port} (sub:${existing.subnet} uni:${existing.artnetUniverse})`);
  } else {
    nodes.set(id, {
      ip: ip || '255.255.255.255',
      port: port || ARTNET_PORT,
      subnet: subnet || 0,
      artnetUniverse: artnetUniverse || 0,
      localUniverse: localUniverse || 1,
      enabled: enabled !== undefined ? enabled : true,
      dmx: Buffer.alloc(512, 0),
    });
    log('info', `[Art-Net] Added node ${id} → ${ip}:${port || ARTNET_PORT} (sub:${subnet||0} uni:${artnetUniverse||0})`);
  }
}

function removeNode(id) {
  nodes.delete(id);
  log('info', `[Art-Net] Removed node ${id}`);
}

/**
 * Set a single channel value for a given local universe
 */
function setChannel(localUniverse, channel, value) {
  for (const [, node] of nodes) {
    if (node.localUniverse === localUniverse && node.enabled) {
      if (channel >= 1 && channel <= 512) {
        node.dmx[channel - 1] = Math.max(0, Math.min(255, value));
      }
    }
  }
}

/**
 * Set multiple channels at once: { localUniverse, channels: [{ch, val}] }
 */
function setChannels({ localUniverse, channels }) {
  for (const [, node] of nodes) {
    if (node.localUniverse === localUniverse && node.enabled) {
      for (const { ch, val } of channels) {
        if (ch >= 1 && ch <= 512) {
          node.dmx[ch - 1] = Math.max(0, Math.min(255, val));
        }
      }
    }
  }
}

/**
 * Set a full 512-byte buffer for a local universe
 */
function setFullUniverse(localUniverse, data) {
  for (const [, node] of nodes) {
    if (node.localUniverse === localUniverse && node.enabled) {
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
      buf.copy(node.dmx, 0, 0, Math.min(buf.length, 512));
    }
  }
}

/**
 * Blackout all universes
 */
function blackout() {
  for (const [, node] of nodes) {
    node.dmx.fill(0);
  }
  // Force one immediate transmit so the blackout goes out now
  transmitAll();
  log('info', '[Art-Net] Blackout');
}

// ─── Initialise ─────────────────────────────────────────────────────────────

function initialize() {
  try {
    udpSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

    udpSocket.on('error', (err) => {
      log('error', `[Art-Net] UDP socket error: ${err.message}`);
    });

    udpSocket.bind(() => {
      udpSocket.setBroadcast(true);
      log('info', '[Art-Net] UDP socket ready (broadcast enabled)');
      reply('ready');
    });
  } catch (e) {
    log('error', `[Art-Net] Failed to create UDP socket: ${e.message}`);
    reply('error', { error: e.message });
  }
}

function shutdown() {
  log('info', '[Art-Net] Shutting down worker...');
  stopTxLoop();
  blackout();

  if (udpSocket) {
    udpSocket.close();
    udpSocket = null;
  }

  reply('shutdown-complete');
  process.exit(0);
}

// ─── Message Handler ────────────────────────────────────────────────────────

function handleMessage(msg) {
  if (!msg || !msg.action) return;

  switch (msg.action) {
    case 'upsertNode':
      upsertNode(msg.payload);
      break;
    case 'removeNode':
      removeNode(msg.payload.id);
      break;
    case 'setChannel':
      setChannel(msg.payload.localUniverse, msg.payload.channel, msg.payload.value);
      break;
    case 'setChannels':
      setChannels(msg.payload);
      break;
    case 'setFullUniverse':
      setFullUniverse(msg.payload.localUniverse, msg.payload.data);
      break;
    case 'blackout':
      blackout();
      break;
    case 'startTx':
      startTxLoop(msg.payload.rate);
      break;
    case 'stopTx':
      stopTxLoop();
      break;
    case 'shutdown':
      shutdown();
      break;
    default:
      log('warn', `[Art-Net] Unknown action: ${msg.action}`);
  }
}

// ─── Entry Point ────────────────────────────────────────────────────────────

if (parentPort) {
  parentPort.on('message', handleMessage);
  initialize();
} else {
  console.error('[Art-Net] Worker must be spawned from a parent thread.');
  process.exit(1);
}
