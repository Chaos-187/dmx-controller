/**
 * Network interface helpers — pick LAN over VPN, bind services, mDNS advertise.
 */
'use strict';

const os = require('os');

const VPN_NAME_RE = /vpn|tun|tap|wireguard|wintun|nordlynx|openvpn|hamachi|zerotier|tailscale|nordvpn|proton|pptp|l2tp|softether|cgwin/i;

function isIPv4(net) {
  return net.family === 'IPv4' || net.family === 4;
}

/** Stable key for config storage: "Adapter Name|192.168.1.5" */
function interfaceKey(name, address) {
  return `${name}|${address}`;
}

function parseInterfaceKey(key) {
  if (!key || key === 'auto') return null;
  const pipe = key.indexOf('|');
  if (pipe >= 0) {
    return { name: key.slice(0, pipe), address: key.slice(pipe + 1) };
  }
  return { name: key, address: null };
}

/** All non-loopback IPv4 adapters. */
function listNetworkInterfaces() {
  const nets = os.networkInterfaces();
  const out = [];
  for (const [name, addrs] of Object.entries(nets)) {
    if (!addrs) continue;
    for (const net of addrs) {
      if (!isIPv4(net) || net.internal) continue;
      out.push({
        key: interfaceKey(name, net.address),
        name,
        address: net.address,
        netmask: net.netmask,
        mac: net.mac,
        cidr: net.cidr,
        likelyVpn: VPN_NAME_RE.test(name),
      });
    }
  }
  return out;
}

function scoreInterface(iface) {
  let score = 0;
  if (iface.likelyVpn) score -= 100;
  if (iface.address.startsWith('169.254.')) score -= 50;
  if (/^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(iface.address)) score += 20;
  if (/ethernet|wi-fi|wifi|wlan|eth|en0|en1|local area connection/i.test(iface.name)) score += 10;
  return score;
}

function findInterfaceByConfig(configValue) {
  const parsed = parseInterfaceKey(configValue);
  if (!parsed) return null;
  const ifaces = listNetworkInterfaces();
  if (parsed.address) {
    return ifaces.find(i => i.name === parsed.name && i.address === parsed.address) || null;
  }
  return ifaces.find(i => i.name === parsed.name)
    || ifaces.find(i => i.address === parsed.name)
    || null;
}

/** Best interface for mDNS advertise when config is auto or missing. */
function getAdvertiseInterface(getConfig) {
  const configured = getConfig?.('network_interface');
  const found = findInterfaceByConfig(configured);
  if (found) return found;

  const ifaces = listNetworkInterfaces();
  if (!ifaces.length) {
    return { key: 'auto', name: 'Loopback', address: '127.0.0.1', likelyVpn: false };
  }
  return [...ifaces].sort((a, b) => scoreInterface(b) - scoreInterface(a))[0];
}

/** @deprecated alias */
function getPreferredInterface(getConfig) {
  return getAdvertiseInterface(getConfig);
}

function getLocalIPv4(getConfig) {
  return getAdvertiseInterface(getConfig).address;
}

/** Host to bind TCP/HTTP listeners — 0.0.0.0 (all) or a specific adapter IP. */
function getBindHost(getConfig) {
  const bind = getConfig?.('network_bind');
  if (!bind || bind === '0.0.0.0') return '0.0.0.0';
  const found = findInterfaceByConfig(bind);
  return found ? found.address : '0.0.0.0';
}

/** Options for multicast-dns / bonjour-service. */
function getMdnsOpts(getConfig) {
  const ip = getLocalIPv4(getConfig);
  if (!ip || ip === '127.0.0.1') return { reuseAddr: true };
  return { reuseAddr: true, interface: ip };
}

module.exports = {
  interfaceKey,
  listNetworkInterfaces,
  findInterfaceByConfig,
  getAdvertiseInterface,
  getPreferredInterface,
  getLocalIPv4,
  getBindHost,
  getMdnsOpts,
};
