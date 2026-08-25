/**
 * Shared Thaluxis product naming for hub + satellite nodes.
 */

const HUB_DEFAULT_NAME = 'Thaluxis Hub';
const SATELLITE_DEFAULT_NAME = 'Thaluxis Satellite';
const HUB_BONJOUR_NAME = 'Thaluxis-Hub';
const SATELLITE_BONJOUR_PREFIX = 'Thaluxis-Satellite';

function sanitizeBonjourName(name, fallback) {
  const cleaned = String(name || '')
    .trim()
    .replace(/[^a-zA-Z0-9- ]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 63);
  return cleaned || fallback;
}

function getHubDisplayName(db) {
  return (db?.getConfig?.('hub_name') || '').trim() || HUB_DEFAULT_NAME;
}

function getHubBonjourName(db) {
  return sanitizeBonjourName(getHubDisplayName(db), HUB_BONJOUR_NAME);
}

function getSatelliteBonjourName(displayName) {
  const base = sanitizeBonjourName(displayName, SATELLITE_BONJOUR_PREFIX);
  if (base.startsWith(SATELLITE_BONJOUR_PREFIX)) return base;
  return `${SATELLITE_BONJOUR_PREFIX}-${base}`.slice(0, 63);
}

module.exports = {
  HUB_DEFAULT_NAME,
  SATELLITE_DEFAULT_NAME,
  HUB_BONJOUR_NAME,
  SATELLITE_BONJOUR_PREFIX,
  sanitizeBonjourName,
  getHubDisplayName,
  getHubBonjourName,
  getSatelliteBonjourName,
};
