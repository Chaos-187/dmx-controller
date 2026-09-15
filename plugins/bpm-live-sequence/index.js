/**
 * Experimental: beat-synced rig looks driven by live audio BPM (no timeline sequence).

 */



const {

  LOOKS,

  computeLook,

  fixtureColorsToChannelUpdates,
  sortedColorFixtures,
} = require('./patterns');

const { levelsToAudio, soundLookCatalog } = require('./sound-looks');



const TICK_MS = 50;

const AUTO_BEATS_PER_LOOK = 8;



let timer = null;

let ctxRef = null;

let phase = 0;

/** Beat-scaled motion progress (matches sequencer: ~1 cycle per N beats at speed 1). */
let effectProgress = 0;

let lastBeatFlash = 0;

let beatCounter = 0;

let autoLookIndex = 0;

let lastStatus = { active: false };



function cfgBool(ctx, key, def) {

  const v = ctx.getConfig(key, def ? '1' : '0');

  return v === '1' || v === 'true';

}



function cfgNum(ctx, key, def) {

  const n = parseFloat(ctx.getConfig(key, String(def)));

  return Number.isFinite(n) ? n : def;

}



function cfgLook(ctx) {

  const v = ctx.getConfig('look', 'sound_flash');

  return LOOKS.includes(v) ? v : 'sound_flash';

}



function resolveBpm(levels, useHalftime) {

  if (!levels) return null;

  let bpm = levels.bpm;

  if (useHalftime && levels.bpm_halftime) bpm = levels.bpm_halftime;

  if (bpm == null || !Number.isFinite(bpm)) return null;

  return Math.max(40, Math.min(220, bpm));

}



function pushUpdates(channelUpdates, services) {

  const { artnetServer, dmxUsbServer, getDmxOutputEnabled } = services;

  if (!getDmxOutputEnabled()) return;

  for (const [universe, addrs] of Object.entries(channelUpdates)) {

    const channels = Object.entries(addrs).map(([ch, val]) => ({

      ch: +ch,

      val: Math.max(0, Math.min(255, Math.round(val))),

    }));

    if (!channels.length) continue;

    artnetServer.setChannels(+universe, channels);

    dmxUsbServer.setChannels(+universe, channels);

  }

}



function blackoutFixtures(fixtures) {
  const map = new Map();
  for (const f of sortedColorFixtures(fixtures)) {
    map.set(f.id, { r: 0, g: 0, b: 0, dim: 0 });
  }
  return fixtureColorsToChannelUpdates(fixtures, map);
}



function tick() {

  if (!ctxRef) return;

  const {

    audioInput,

    getFixtureChannelMapCached,

    isAnySequencePlaying,

    getDmxOutputEnabled,

    artnetServer,

    dmxUsbServer,

  } = ctxRef;



  const enabled = cfgBool(ctxRef, 'enabled', false);

  const yieldSeq = cfgBool(ctxRef, 'yield_sequence', true);

  const useHalftime = cfgBool(ctxRef, 'use_halftime', false);

  const blackoutNoBpm = cfgBool(ctxRef, 'blackout_no_bpm', true);

  const look = cfgLook(ctxRef);

  const intensity = cfgNum(ctxRef, 'intensity', 85) / 100;

  const cycleBeats = Math.max(1, Math.min(16, Math.round(cfgNum(ctxRef, 'cycle_beats', 4))));

  const effectSpeed = Math.max(0.25, Math.min(4, cfgNum(ctxRef, 'effect_speed', 1)));

  const services = { artnetServer, dmxUsbServer, getDmxOutputEnabled };



  if (!enabled || !audioInput.capture.running) {

    lastStatus = { active: false, reason: !enabled ? 'disabled' : 'audio_inactive' };

    return;

  }

  if (yieldSeq && isAnySequencePlaying()) {

    lastStatus = { active: false, reason: 'sequence_playing' };

    return;

  }



  const levels = audioInput.capture.getLevels();

  const audio = levelsToAudio(audioInput.capture.getDmxLevels());

  const bpm = resolveBpm(levels, useHalftime);

  const fixtures = getFixtureChannelMapCached();

  if (!bpm) {

    if (blackoutNoBpm) {

      pushUpdates(blackoutFixtures(fixtures), services);

    }

    lastStatus = {

      active: false,

      reason: 'no_bpm',

      audio: !!levels,

      blackout: blackoutNoBpm,

    };

    return;

  }



  const beatMs = 60000 / bpm;

  const beatSec = beatMs / 1000;

  phase = (phase + TICK_MS / beatMs) % 1;

  effectProgress += (TICK_MS / 1000 / beatSec) * effectSpeed / cycleBeats;

  const beat = levels.beat || 0;

  if (beat > 0.2) {

    if (Date.now() - lastBeatFlash > beatMs * 0.35) {

      beatCounter += 1;

      if (look === 'auto_rotate' && beatCounter % AUTO_BEATS_PER_LOOK === 0) {

        autoLookIndex += 1;

      }

    }

    lastBeatFlash = Date.now();

  }

  const beatPulse = Math.max(0, 1 - (Date.now() - lastBeatFlash) / 120);



  const { fixtureColors, effectiveLook } = computeLook(look, {

    fixtures,

    phase,

    effectProgress,

    beatPulse,

    levels,

    audio,

    intensity,

    autoLookIndex,

  });



  pushUpdates(fixtureColorsToChannelUpdates(fixtures, fixtureColors), services);



  lastStatus = {

    active: true,

    bpm: Math.round(bpm),

    look,

    effective_look: effectiveLook,

    phase: Math.round(phase * 1000) / 1000,

    effect_progress: Math.round(effectProgress * 1000) / 1000,

    cycle_beats: cycleBeats,

    effect_speed: effectSpeed,

    beat_pulse: Math.round(beatPulse * 100) / 100,

    fixtures: fixtureColors.size,

    use_halftime: useHalftime,

  };

}



function startTimer(ctx) {

  stopTimer();

  ctxRef = ctx;

  timer = setInterval(tick, TICK_MS);

}



function stopTimer() {

  if (timer) {

    clearInterval(timer);

    timer = null;

  }

  phase = 0;

  effectProgress = 0;

  beatCounter = 0;

  autoLookIndex = 0;

  lastStatus = { active: false };

}



function configPayload(ctx) {

  return {

    enabled: cfgBool(ctx, 'enabled', false),

    yield_sequence: cfgBool(ctx, 'yield_sequence', true),

    use_halftime: cfgBool(ctx, 'use_halftime', false),

    blackout_no_bpm: cfgBool(ctx, 'blackout_no_bpm', true),

    look: cfgLook(ctx),

    intensity: cfgNum(ctx, 'intensity', 85),

    cycle_beats: Math.round(cfgNum(ctx, 'cycle_beats', 4)),

    effect_speed: cfgNum(ctx, 'effect_speed', 1),

  };

}



module.exports = {

  meta: {

    id: 'bpm-live-sequence',

    name: 'BPM Live Sequence',

    version: '0.4.0',

    experimental: true,

    description:

      'Sound-reactive live lighting from audio input — beat flash, VU meters, bass chase, and spectrum looks synced to BPM. Requires Audio Input capture.',

  },



  register(ctx) {

    startTimer(ctx);



    ctx.api.get('/looks', (_req, res) => {

      res.json({

        looks: soundLookCatalog(),

      });

    });



    ctx.api.get('/status', (_req, res) => {

      res.json({

        config: configPayload(ctx),

        runtime: lastStatus,

        audio_running: ctx.audioInput.capture.running,

      });

    });



    ctx.api.get('/config', (_req, res) => {

      res.json(configPayload(ctx));

    });



    ctx.api.post('/config', (req, res) => {

      const body = req.body || {};

      if (body.enabled !== undefined) ctx.setConfig('enabled', body.enabled ? '1' : '0');

      if (body.yield_sequence !== undefined) ctx.setConfig('yield_sequence', body.yield_sequence ? '1' : '0');

      if (body.use_halftime !== undefined) ctx.setConfig('use_halftime', body.use_halftime ? '1' : '0');

      if (body.blackout_no_bpm !== undefined) {

        ctx.setConfig('blackout_no_bpm', body.blackout_no_bpm ? '1' : '0');

      }

      if (body.look !== undefined && LOOKS.includes(body.look)) {

        ctx.setConfig('look', body.look);

        autoLookIndex = 0;

        beatCounter = 0;

      }

      if (body.intensity !== undefined) {

        ctx.setConfig('intensity', String(Math.max(10, Math.min(100, +body.intensity || 85))));

      }

      if (body.cycle_beats !== undefined) {

        ctx.setConfig('cycle_beats', String(Math.max(1, Math.min(16, Math.round(+body.cycle_beats || 4)))));

      }

      if (body.effect_speed !== undefined) {

        ctx.setConfig('effect_speed', String(Math.max(0.25, Math.min(4, +body.effect_speed || 1))));

      }

      if (ctx.broadcast) {

        ctx.broadcast({ type: 'plugin_config', plugin: 'bpm-live-sequence' });

      }

      res.json({ ok: true });

    });

  },



  shutdown() {

    stopTimer();

    ctxRef = null;

  },



  getStatus() {

    return lastStatus;

  },

};

