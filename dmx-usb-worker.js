/**
 * DMX USB Worker Thread (FTDI D2XX + libusb)
 *
 * Runs in a separate thread to avoid blocking the main process.
 * Maintains a 512-byte DMX buffer and transmits DMX512 frames
 * via USB adapters.
 *
 * Supported backends:
 *   1. FTDI D2XX — for Enttec Open DMX, DMXKING ultraDMX Micro, etc.
 *      - 250,000 baud, 8N2, break via baud-rate switch or setBreakOn/Off
 *   2. libusb (USB bulk) — for SoundSwitch DMX Micro, etc.
 *      - USB bulk OUT transfer on endpoint 1
 *      - Uses device-specific packet framing (e.g. "sTRt" header)
 */

const { parentPort } = require('worker_threads');

// ─── Constants ──────────────────────────────────────────────────────────────

const DMX_BAUD_RATE = 250000;
const DMX_BREAK_BAUD = 76800;    // lower baud to generate >88µs break with a 0x00
const DMX_CHANNELS = 512;
const DMX_START_CODE = 0x00;

// SoundSwitch DMX Micro protocol (observed via Wireshark USB capture)
// 522-byte bulk OUT packet: 4-byte "sTRt" header + 6 control bytes + 512 DMX data
const SOUNDSWITCH_HEADER = Buffer.from([
  0x73, 0x54, 0x52, 0x74,  // "sTRt" magic
  0x01,                     // command: output DMX
  0x00,                     // flags / universe
  0x02,                     // data length high (512 >> 8)
  0x02,                     // protocol version / mode
  0x00, 0x00,               // reserved / start code
]);
const SOUNDSWITCH_PACKET_SIZE = SOUNDSWITCH_HEADER.length + DMX_CHANNELS; // 522

// Known USB VID:PID → protocol mapping
const USB_PROTOCOLS = {
  '15e4:0053': 'soundswitch',   // SoundSwitch DMX Micro Interface
  '15e4:0100': 'soundswitch',   // SoundSwitch DMX Interface
};

// ─── State ──────────────────────────────────────────────────────────────────

let FTDI = null;           // ftdi-d2xx module (loaded at runtime)
let device = null;         // open FTDI device handle
let usbDevice = null;      // open libusb device handle
let usbEndpoint = null;    // USB bulk OUT endpoint
let usbProtocol = null;    // 'soundswitch' or null
let activeBackend = null;  // 'ftdi' or 'usb'
let dmxBuffer = Buffer.alloc(DMX_CHANNELS, 0);   // 512 channels
let txInterval = null;
let txRate = 40;           // Hz
let isOpen = false;
let deviceInfo = null;     // info about the opened device
let useBreakMethod = 'baud'; // 'baud' or 'break' — how to generate DMX break (FTDI only)

// ─── Utility ────────────────────────────────────────────────────────────────

function log(level, message) {
  if (parentPort) {
    parentPort.postMessage({ type: 'log', level, message });
  } else {
    (console[level] || console.log)(message);
  }
}

function reply(type, data = {}) {
  if (parentPort) {
    parentPort.postMessage({ type, ...data });
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── FTDI Device Management ─────────────────────────────────────────────────

async function listDevices() {
  try {
    if (!FTDI) FTDI = require('ftdi-d2xx');
    const devices = await FTDI.getDeviceInfoList();
    log('info', `[DMX-USB] Found ${devices.length} FTDI device(s)`);
    reply('deviceList', { devices: devices.map((d, i) => ({
      index: i,
      serial_number: d.serial_number || '',
      description: d.description || '',
      type: d.type || 0,
      id: d.id || 0,
      usb_loc_id: d.usb_loc_id || 0,
    }))});
    return devices;
  } catch (e) {
    log('error', `[DMX-USB] Failed to list devices: ${e.message}`);
    reply('deviceList', { devices: [], error: e.message });
    return [];
  }
}

async function openDevice(identifier) {
  try {
    if (isOpen && device) {
      await closeDevice();
    }

    if (!FTDI) FTDI = require('ftdi-d2xx');

    log('info', `[DMX-USB] Opening device: ${JSON.stringify(identifier)}`);

    // identifier can be { serial_number } or { description } or { usb_loc_id }
    device = await FTDI.openDevice(identifier);

    // Configure for DMX512
    await device.setBaudRate(DMX_BAUD_RATE);
    await device.setDataCharacteristics(8, 2, 0); // 8N2 (8 data, 2 stop, no parity)
    await device.setFlowControl(0);                // None
    await device.purge(3);                         // Purge RX + TX buffers
    await device.setLatencyTimer(2);               // 2ms latency (minimum)
    await device.resetDevice();

    // Re-apply after reset
    await sleep(50);
    await device.setBaudRate(DMX_BAUD_RATE);
    await device.setDataCharacteristics(8, 2, 0);
    await device.setFlowControl(0);
    await device.purge(3);

    isOpen = true;
    deviceInfo = identifier;
    log('info', `[DMX-USB] Device opened and configured for DMX512`);
    reply('opened', { identifier });
    return true;
  } catch (e) {
    log('error', `[DMX-USB] Failed to open device: ${e.message}`);
    reply('error', { error: e.message, action: 'open' });
    device = null;
    isOpen = false;
    return false;
  }
}

async function closeDevice() {
  stopTxLoop();
  if (activeBackend === 'usb') {
    await closeUsbDevice();
  } else if (device) {
    try {
      // Send one last blackout
      dmxBuffer.fill(0);
      await sendDmxFrame();
      await sleep(30);
      await device.close();
    } catch (e) {
      log('warn', `[DMX-USB] Error closing device: ${e.message}`);
    }
    device = null;
  }
  isOpen = false;
  deviceInfo = null;
  activeBackend = null;
  log('info', '[DMX-USB] Device closed');
  reply('closed');
}

// ─── libusb Device Management ───────────────────────────────────────────────

/**
 * Open a USB device via libusb for bulk DMX transfer.
 * @param {object} payload  { vid: 0x15e4, pid: 0x0053, serial_number: '...' }
 */
async function openUsbDevice(payload) {
  try {
    if (isOpen) await closeDevice();

    const usb = require('usb');
    const vid = typeof payload.vid === 'string' ? parseInt(payload.vid, 16) : payload.vid;
    const pid = typeof payload.pid === 'string' ? parseInt(payload.pid, 16) : payload.pid;
    const vidHex = vid.toString(16).padStart(4, '0');
    const pidHex = pid.toString(16).padStart(4, '0');
    const key = `${vidHex}:${pidHex}`;

    log('info', `[DMX-USB] Opening USB device VID:0x${vidHex} PID:0x${pidHex}`);

    // Find the device
    const devices = usb.getDeviceList();
    let target = null;
    for (const d of devices) {
      if (d.deviceDescriptor.idVendor === vid && d.deviceDescriptor.idProduct === pid) {
        // If serial number specified, match it
        if (payload.serial_number) {
          try {
            d.open();
            const sn = d.deviceDescriptor.iSerialNumber
              ? await new Promise((resolve, reject) => {
                  d.getStringDescriptor(d.deviceDescriptor.iSerialNumber, (err, val) => {
                    if (err) reject(err); else resolve(val);
                  });
                })
              : '';
            if (sn === payload.serial_number) {
              target = d; // already opened
              break;
            }
            d.close();
          } catch {
            try { d.close(); } catch {}
          }
        } else {
          target = d;
          break;
        }
      }
    }

    if (!target) {
      throw new Error(`USB device not found: VID:0x${vidHex} PID:0x${pidHex}`);
    }

    // Open if not already opened during serial number matching
    try { target.open(); } catch {}

    // Claim interface 0
    const iface = target.interface(0);
    if (process.platform === 'linux' && iface.isKernelDriverActive()) {
      iface.detachKernelDriver();
    }
    iface.claim();

    // Find bulk OUT endpoint
    let outEp = null;
    for (const ep of iface.endpoints) {
      if (ep.direction === 'out' && ep.transferType === usb.LIBUSB_TRANSFER_TYPE_BULK) {
        outEp = ep;
        break;
      }
    }
    if (!outEp) {
      // Fallback: try endpoint 1 OUT (0x01) directly
      outEp = iface.endpoint(0x01);
    }
    if (!outEp) {
      target.close();
      throw new Error('No bulk OUT endpoint found on the device');
    }

    usbDevice = target;
    usbEndpoint = outEp;
    usbProtocol = USB_PROTOCOLS[key] || 'raw';
    activeBackend = 'usb';
    isOpen = true;
    deviceInfo = { source: 'usb', vid: `0x${vidHex}`, pid: `0x${pidHex}`, serial_number: payload.serial_number || '' };

    log('info', `[DMX-USB] USB device opened — protocol: ${usbProtocol}, endpoint: 0x${outEp.address.toString(16)}`);
    reply('opened', { identifier: deviceInfo });
    return true;
  } catch (e) {
    log('error', `[DMX-USB] Failed to open USB device: ${e.message}`);
    reply('error', { error: e.message, action: 'open' });
    usbDevice = null;
    usbEndpoint = null;
    usbProtocol = null;
    activeBackend = null;
    isOpen = false;
    return false;
  }
}

async function closeUsbDevice() {
  if (usbDevice) {
    try {
      // Send blackout
      dmxBuffer.fill(0);
      await sendDmxFrameUsb();
      await sleep(30);

      // Release interface and close
      try { usbDevice.interface(0).release(true, () => {}); } catch {}
      await sleep(20);
      try { usbDevice.close(); } catch {}
    } catch (e) {
      log('warn', `[DMX-USB] Error closing USB device: ${e.message}`);
    }
    usbDevice = null;
    usbEndpoint = null;
    usbProtocol = null;
  }
}

/**
 * Send a DMX frame via USB bulk transfer.
 * Builds the packet according to the device's protocol.
 */
async function sendDmxFrameUsb() {
  if (!usbDevice || !usbEndpoint || !isOpen) return;

  try {
    let packet;

    if (usbProtocol === 'soundswitch') {
      // SoundSwitch protocol: 10-byte header + 512 DMX channels = 522 bytes
      packet = Buffer.alloc(SOUNDSWITCH_PACKET_SIZE);
      SOUNDSWITCH_HEADER.copy(packet, 0);
      dmxBuffer.copy(packet, SOUNDSWITCH_HEADER.length);
    } else {
      // Raw/generic: just send start code + 512 channels
      packet = Buffer.alloc(1 + DMX_CHANNELS);
      packet[0] = DMX_START_CODE;
      dmxBuffer.copy(packet, 1);
    }

    await new Promise((resolve, reject) => {
      usbEndpoint.transfer(packet, (err) => {
        if (err) reject(err); else resolve();
      });
    });
  } catch (e) {
    log('error', `[DMX-USB] USB TX error: ${e.message}`);
    if (e.message.includes('LIBUSB_ERROR') || e.message.includes('DEVICE_NOT_FOUND') || e.errno) {
      log('error', '[DMX-USB] USB device lost — stopping TX');
      stopTxLoop();
      isOpen = false;
      usbDevice = null;
      usbEndpoint = null;
      activeBackend = null;
      reply('error', { error: 'Device disconnected', action: 'tx' });
    }
  }
}

// ─── DMX Frame Transmission ─────────────────────────────────────────────────

/**
 * Send a single DMX512 frame.
 * 
 * DMX frame structure:
 *   1. BREAK  — at least 88µs of space (logic low)
 *   2. MAB    — at least 8µs of mark (logic high)
 *   3. Start Code (0x00) + up to 512 channel bytes
 *
 * We use the baud-rate trick for the break:
 *   - Switch to a lower baud rate and send 0x00 to create a long low pulse
 *   - Switch back to 250k baud and send the DMX data
 */
async function sendDmxFrame() {
  // Route to the active backend
  if (activeBackend === 'usb') return sendDmxFrameUsb();
  if (!device || !isOpen) return;

  try {
    if (useBreakMethod === 'break') {
      // Method 1: Use setBreakOn/Off (simpler but not all FTDI chips support timing precisely)
      await device.setBreakOn();
      await sleep(1); // ~1ms break (exceeds 88µs minimum)
      await device.setBreakOff();
      // MAB is inherent in the line going high before we start transmitting
    } else {
      // Method 2: Baud rate switching (most reliable for Enttec Open DMX)
      await device.setBaudRate(DMX_BREAK_BAUD);
      await device.write(Buffer.from([0x00])); // sends ~130µs break at 76800 baud
      await device.setBaudRate(DMX_BAUD_RATE);
    }

    // Build DMX packet: start code + 512 channels
    const packet = Buffer.alloc(1 + DMX_CHANNELS);
    packet[0] = DMX_START_CODE;
    dmxBuffer.copy(packet, 1);

    await device.write(packet);
  } catch (e) {
    log('error', `[DMX-USB] TX error: ${e.message}`);
    // If we get a write error, the device may have been unplugged
    if (e.message.includes('DEVICE_NOT_FOUND') || e.message.includes('IO_ERROR')) {
      log('error', '[DMX-USB] Device lost — stopping TX');
      stopTxLoop();
      isOpen = false;
      device = null;
      reply('error', { error: 'Device disconnected', action: 'tx' });
    }
  }
}

// ─── Transmit Loop ──────────────────────────────────────────────────────────

let txBusy = false;

function startTxLoop(rate) {
  stopTxLoop();
  txRate = rate || 40;
  const interval = Math.round(1000 / txRate);

  txInterval = setInterval(async () => {
    if (txBusy) return; // skip frame if previous still sending
    txBusy = true;
    await sendDmxFrame();
    txBusy = false;
  }, interval);

  log('info', `[DMX-USB] TX loop started at ${txRate} fps (${interval}ms)`);
  reply('txStarted', { rate: txRate });
}

function stopTxLoop() {
  if (txInterval) {
    clearInterval(txInterval);
    txInterval = null;
    txBusy = false;
    log('info', '[DMX-USB] TX loop stopped');
  }
}

// ─── Channel Control ────────────────────────────────────────────────────────

function setChannel(channel, value) {
  if (channel >= 1 && channel <= DMX_CHANNELS) {
    dmxBuffer[channel - 1] = Math.max(0, Math.min(255, value));
  }
}

function setChannels(channels) {
  for (const { ch, val } of channels) {
    if (ch >= 1 && ch <= DMX_CHANNELS) {
      dmxBuffer[ch - 1] = Math.max(0, Math.min(255, val));
    }
  }
}

function setFullUniverse(data) {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  buf.copy(dmxBuffer, 0, 0, Math.min(buf.length, DMX_CHANNELS));
}

function blackout() {
  dmxBuffer.fill(0);
  // Send immediate blackout frame if device is open
  if (isOpen && device) {
    sendDmxFrame().catch(() => {});
  }
  log('info', '[DMX-USB] Blackout');
}

let savedDmxBuffer = null;

function saveBuffers() {
  savedDmxBuffer = Buffer.from(dmxBuffer);
  log('info', '[DMX-USB] Saved DMX buffer');
}

function restoreBuffers() {
  if (savedDmxBuffer) {
    savedDmxBuffer.copy(dmxBuffer);
    savedDmxBuffer = null;
    if (isOpen && device) {
      sendDmxFrame().catch(() => {});
    }
  }
  log('info', '[DMX-USB] Restored DMX buffer');
}

// ─── Shutdown ───────────────────────────────────────────────────────────────

async function shutdown() {
  log('info', '[DMX-USB] Shutting down worker...');
  stopTxLoop();
  blackout();
  await sleep(50);
  await closeDevice();
  reply('shutdown-complete');
  process.exit(0);
}

// ─── Message Handler ────────────────────────────────────────────────────────

async function handleMessage(msg) {
  if (!msg || !msg.action) return;

  switch (msg.action) {
    case 'listDevices':
      await listDevices();
      break;

    case 'open':
      await openDevice(msg.payload);
      break;

    case 'openUsb':
      await openUsbDevice(msg.payload);
      break;

    case 'close':
      await closeDevice();
      break;

    case 'setChannel':
      setChannel(msg.payload.channel, msg.payload.value);
      break;

    case 'setChannels':
      setChannels(msg.payload.channels);
      break;

    case 'setFullUniverse':
      setFullUniverse(msg.payload.data);
      break;

    case 'blackout':
      blackout();
      break;

    case 'saveBuffers':
      saveBuffers();
      break;

    case 'restoreBuffers':
      restoreBuffers();
      break;

    case 'startTx':
      startTxLoop(msg.payload.rate);
      break;

    case 'stopTx':
      stopTxLoop();
      break;

    case 'setBreakMethod':
      useBreakMethod = msg.payload.method === 'break' ? 'break' : 'baud';
      log('info', `[DMX-USB] Break method set to: ${useBreakMethod}`);
      break;

    case 'shutdown':
      await shutdown();
      break;

    default:
      log('warn', `[DMX-USB] Unknown action: ${msg.action}`);
  }
}

// ─── Entry Point ────────────────────────────────────────────────────────────

if (parentPort) {
  parentPort.on('message', handleMessage);
  // Signal ready immediately (no socket to bind like Art-Net)
  reply('ready');
  log('info', '[DMX-USB] Worker ready');
} else {
  console.error('[DMX-USB] Worker must be spawned from a parent thread.');
  process.exit(1);
}
