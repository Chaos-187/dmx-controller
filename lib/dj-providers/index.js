'use strict';

const virtualdj = require('./virtualdj');
const denonEngineBeta = require('./denon-engine-beta');
const seratoBeta = require('./serato-beta');

const ALL = [virtualdj, denonEngineBeta, seratoBeta];
const BY_ID = new Map(ALL.map((p) => [p.id, p]));

const DEFAULT_PROVIDER_ID = virtualdj.id;

function getEffectiveProviderId(getConfig) {
  if (typeof getConfig !== 'function') return virtualdj.id;
  const active = resolveActiveProviderId(getConfig('dj_active_provider'));
  if (active === denonEngineBeta.id && getConfig('denon_stagelinq_enabled') === '1') {
    return denonEngineBeta.id;
  }
  if (active === seratoBeta.id && getConfig('serato_integration_enabled') === '1') {
    return seratoBeta.id;
  }
  return virtualdj.id;
}

function listProviders() {
  return ALL.slice();
}

function getProvider(id) {
  return BY_ID.get(id) || null;
}

function getDefaultProviderId() {
  return DEFAULT_PROVIDER_ID;
}


/**
 * @param {string | null | undefined} configuredId
 */
function resolveActiveProviderId(configuredId) {
  const id = (configuredId || '').trim() || DEFAULT_PROVIDER_ID;
  return getProvider(id) ? id : DEFAULT_PROVIDER_ID;
}

function toPublic(provider) {
  return {
    id: provider.id,
    label: provider.label,
    status: provider.status,
    transport: provider.transport,
    capabilities: { ...provider.capabilities },
    configKeys: provider.configKeys || [],
    reservedConfigKeys: provider.reservedConfigKeys || [],
    supportedDevices: provider.supportedDevices || [],
    supportedProducts: provider.supportedProducts || [],
    referenceUrl: provider.referenceUrl || '',
    notes: provider.notes || '',
  };
}

function listPublic() {
  return ALL.map(toPublic);
}

function snapshot(configuredId, getConfig) {
  const active = resolveActiveProviderId(configuredId);
  const effective = getEffectiveProviderId(getConfig);
  return {
    active,
    effective,
    effectiveLabel: getProvider(effective)?.label || effective,
    activeProvider: toPublic(getProvider(active)),
    runtimeUsesActiveProvider: active === effective,
    providers: listPublic(),
  };
}

module.exports = {
  listProviders,
  getProvider,
  getDefaultProviderId,
  getEffectiveProviderId,
  resolveActiveProviderId,
  listPublic,
  snapshot,
  toPublic,
};
