/**
 * Live rig output visualizer — 3D perspective view with fixture colors and mover beams.
 */
(function (global) {
  const LS_ENABLE = 'rigOutputVizEnabled';
  const LS_EXTERNAL_ACTIVE = 'rigOutputVizExternalActive';
  const EXTERNAL_STALE_MS = 4000;
  const POLL_MS_FALLBACK = 150;
  const MAX_DPR = 1.25;
  const CAM_DEFAULT = { azimuth: -35, elevation: 30, zoom: 1, panX: 0, panY: 0 };
  const FL = 1.0;
  const CEIL = 0.05;
  const NODE_COLORS = ['#e94560', '#00e676', '#448aff', '#ffea00', '#00e5ff', '#e040fb', '#ff9100', '#76ff03'];

  function rgbCss(r, g, b, a) {
    return `rgba(${r | 0},${g | 0},${b | 0},${a})`;
  }

  function rigProject3d(x, yH, zD, cam) {
    const rx = x ?? 0.5;
    const ry = yH ?? 0.5;
    const rz = zD ?? 0.5;
    const wx = rx - 0.5;
    const wy = -(ry - 0.5);
    const wz = rz - 0.5;
    const azR = cam.azimuth * Math.PI / 180;
    const rx2 = wx * Math.cos(azR) + wz * Math.sin(azR);
    const ry2 = wy;
    const rz2 = -wx * Math.sin(azR) + wz * Math.cos(azR);
    const elR = cam.elevation * Math.PI / 180;
    const rx3 = rx2;
    const ry3 = ry2 * Math.cos(elR) - rz2 * Math.sin(elR);
    const rz3 = ry2 * Math.sin(elR) + rz2 * Math.cos(elR);
    const focal = 1.8;
    const persp = focal / Math.max(focal + rz3, 0.1);
    const zoom = cam.zoom;
    const sx = 0.5 + (rx3 * persp * 0.55 + cam.panX) * zoom;
    const sy = 0.5 + (-ry3 * persp * 0.55 + cam.panY) * zoom;
    return {
      sx: sx * 100,
      sy: sy * 100,
      scale: Math.max(0.35, persp * zoom * 0.85),
      depth: rz3,
    };
  }

  function toScreen(proj, w, h) {
    return { x: (proj.sx / 100) * w, y: (proj.sy / 100) * h, scale: proj.scale, depth: proj.depth };
  }

  function fixturePos(fix) {
    return { x: fix.rig_x ?? 0.5, yH: fix.rig_z ?? 0.5, zD: fix.rig_y ?? 0.5 };
  }

  function moverBeamDir(fix) {
    let pan = fix.pan ?? 128;
    let tilt = fix.tilt ?? 128;
    if (fix.invert_pan) pan = 255 - pan;
    if (fix.invert_tilt) tilt = 255 - tilt;
    const panRad = ((pan - 128) / 128) * Math.PI;
    const tiltRad = ((128 - tilt) / 128) * (Math.PI / 2);
    const cosT = Math.cos(tiltRad);
    const sinT = Math.sin(tiltRad);
    let dwx = Math.sin(panRad) * cosT;
    let dwy = -sinT;
    let dwz = -Math.cos(panRad) * cosT;
    const len = Math.hypot(dwx, dwy, dwz) || 1;
    return { dwx: dwx / len, dwy: dwy / len, dwz: dwz / len };
  }

  function beamEnd(fix, distance) {
    const pos = fixturePos(fix);
    const wx = pos.x - 0.5;
    const wy = -(pos.yH - 0.5);
    const wz = pos.zD - 0.5;
    const d = moverBeamDir(fix);
    const dist = distance ?? 0.42;
    return {
      x: wx + d.dwx * dist + 0.5,
      yH: 0.5 - (wy + d.dwy * dist),
      zD: wz + d.dwz * dist + 0.5,
    };
  }

  function interpolatePath(pts, t) {
    if (!pts || pts.length === 0) return { x: 0.5, yH: 0.5, zD: 0.5 };
    if (pts.length === 1) return { x: pts[0].x, yH: pts[0].yH ?? pts[0].z ?? 0.5, zD: pts[0].zD ?? pts[0].y ?? 0.5 };
    const lens = [0];
    for (let i = 1; i < pts.length; i++) {
      const dx = pts[i].x - pts[i - 1].x;
      const dy = (pts[i].y ?? pts[i].zD) - (pts[i - 1].y ?? pts[i - 1].zD);
      lens.push(lens[i - 1] + Math.sqrt(dx * dx + dy * dy));
    }
    const total = lens[lens.length - 1];
    if (total === 0) return { x: pts[0].x, yH: pts[0].yH ?? 0.5, zD: pts[0].zD ?? pts[0].y ?? 0.5 };
    const target = Math.max(0, Math.min(1, t)) * total;
    for (let i = 1; i < pts.length; i++) {
      if (target <= lens[i]) {
        const seg = lens[i] - lens[i - 1];
        const local = seg > 0 ? (target - lens[i - 1]) / seg : 0;
        const yA = pts[i - 1].y ?? pts[i - 1].zD ?? 0.5;
        const yB = pts[i].y ?? pts[i].zD ?? 0.5;
        return {
          x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * local,
          yH: (pts[i - 1].yH ?? pts[i - 1].z ?? 0.5) + ((pts[i].yH ?? pts[i].z ?? 0.5) - (pts[i - 1].yH ?? pts[i - 1].z ?? 0.5)) * local,
          zD: yA + (yB - yA) * local,
        };
      }
    }
    const last = pts[pts.length - 1];
    return { x: last.x, yH: last.yH ?? last.z ?? 0.5, zD: last.y ?? last.zD ?? 0.5 };
  }

  function notifyExternalChange(active) {
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        const bc = new BroadcastChannel('rig-output-viz');
        bc.postMessage({ type: 'external', active: !!active });
        bc.close();
      }
    } catch { /* ignore */ }
  }

  class RigOutputVisualizer {
    constructor(canvas, options) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.options = options || {};
      this.mode = options.mode || (options.standalone ? 'external' : 'embedded');
      this.enabled = false;
      this._pollTimer = null;
      this._fetchInFlight = false;
      this._renderScheduled = false;
      this._ws = null;
      this._wsOk = false;
      this._wsShared = false;
      this._wsSharedHandler = null;
      this._lastSeq = -1;
      this._rigElementsLoaded = false;
      this._fixtures = [];
      this._rigElements = [];
      this._cam = { ...CAM_DEFAULT };
      this._drag = null;
      this._resizeObs = null;
      this._onResize = () => this._resize();
      window.addEventListener('resize', this._onResize);
      if (typeof BroadcastChannel !== 'undefined') {
        this._bc = new BroadcastChannel('rig-output-viz');
        this._bc.onmessage = (e) => {
          if (e.data && e.data.type === 'external') this._syncRunning();
        };
      }
      window.addEventListener('storage', (e) => {
        if (e.key === LS_EXTERNAL_ACTIVE) this._syncRunning();
      });
      if (typeof ResizeObserver !== 'undefined' && canvas.parentElement) {
        this._resizeObs = new ResizeObserver(() => this._resize());
        this._resizeObs.observe(canvas.parentElement);
      }
      this._wireCamera();
      requestAnimationFrame(() => this._resize());
    }

    static touchExternalHeartbeat() {
      try {
        localStorage.setItem(LS_EXTERNAL_ACTIVE, String(Date.now()));
      } catch { /* ignore */ }
      notifyExternalChange(true);
    }

    static releaseExternal() {
      try {
        localStorage.removeItem(LS_EXTERNAL_ACTIVE);
      } catch { /* ignore */ }
      notifyExternalChange(false);
    }

    static isExternalActive() {
      try {
        const t = localStorage.getItem(LS_EXTERNAL_ACTIVE);
        if (!t) return false;
        return Date.now() - parseInt(t, 10) < EXTERNAL_STALE_MS;
      } catch {
        return false;
      }
    }

    static isEnabledInStorage() {
      try {
        return localStorage.getItem(LS_ENABLE) === '1';
      } catch {
        return false;
      }
    }

    static setEnabledInStorage(on) {
      try {
        localStorage.setItem(LS_ENABLE, on ? '1' : '0');
      } catch { /* ignore */ }
    }

    setEnabled(on) {
      this.enabled = !!on;
      RigOutputVisualizer.setEnabledInStorage(this.enabled);
      this._syncRunning();
    }

    _isPausedByExternal() {
      return this.mode === 'embedded' && RigOutputVisualizer.isExternalActive();
    }

    _shouldPoll() {
      return this.enabled && !this._isPausedByExternal();
    }

    _syncRunning() {
      if (!this.enabled) {
        this._stopTransport();
        this._drawPlaceholder('Live preview off');
        return;
      }
      if (this._isPausedByExternal()) {
        this._stopTransport();
        this._scheduleRender();
        return;
      }
      this._connectWs();
      this._startFallbackPoll();
      this._loadRigElementsOnce();
      this._pollOnce();
      this._scheduleRender();
    }

    _scheduleRender() {
      if (this._renderScheduled) return;
      this._renderScheduled = true;
      requestAnimationFrame(() => {
        this._renderScheduled = false;
        if (!this.enabled) return;
        this._render();
      });
    }

    _stopTransport() {
      if (this._pollTimer) {
        clearInterval(this._pollTimer);
        this._pollTimer = null;
      }
      this._disconnectWs();
    }

    _startFallbackPoll() {
      if (this._pollTimer) return;
      this._pollTimer = setInterval(() => {
        if (!this._shouldPoll()) return;
        if (this._wsOk) return;
        this._pollOnce();
      }, POLL_MS_FALLBACK);
    }

    _connectWs() {
      if (!this._shouldPoll()) return;
      if (this.mode === 'embedded' && global.ws && global.ws.readyState === WebSocket.OPEN) {
        this._ws = global.ws;
        this._wsOk = true;
        this._wsShared = true;
        if (!this._wsSharedHandler) {
          this._wsSharedHandler = (ev) => {
            try {
              const msg = JSON.parse(ev.data);
              if (msg.type === 'rig_output') {
                this._applyPayload(msg);
                this._scheduleRender();
              }
            } catch { /* ignore */ }
          };
          global.ws.addEventListener('message', this._wsSharedHandler);
        }
        global.ws.send(JSON.stringify({ type: 'rig_output_subscribe', on: true }));
        return;
      }
      if (this._ws) return;
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${location.host}`);
      this._ws = ws;
      ws.onopen = () => {
        if (this._ws !== ws) return;
        this._wsOk = true;
        ws.send(JSON.stringify({ type: 'rig_output_subscribe', on: true }));
      };
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type === 'rig_output') {
            this._applyPayload(msg);
            this._scheduleRender();
          }
        } catch { /* ignore */ }
      };
      ws.onclose = () => {
        if (this._ws !== ws) return;
        this._wsOk = false;
        this._ws = null;
        if (this.enabled && this._shouldPoll()) {
          setTimeout(() => this._connectWs(), 2000);
        }
      };
      ws.onerror = () => { /* onclose handles retry */ };
    }

    _disconnectWs() {
      if (this._wsShared && this._ws) {
        try { this._ws.send(JSON.stringify({ type: 'rig_output_subscribe', on: false })); } catch { /* ignore */ }
        if (this._wsSharedHandler) {
          this._ws.removeEventListener('message', this._wsSharedHandler);
          this._wsSharedHandler = null;
        }
        this._wsShared = false;
        this._ws = null;
        this._wsOk = false;
        return;
      }
      const ws = this._ws;
      if (!ws) return;
      this._ws = null;
      this._wsOk = false;
      ws.onopen = null;
      ws.onmessage = null;
      ws.onclose = null;
      ws.onerror = null;
      if (ws.readyState === WebSocket.OPEN) {
        try { ws.send(JSON.stringify({ type: 'rig_output_subscribe', on: false })); } catch { /* ignore */ }
        ws.close();
      }
    }

    _applyPayload(msg) {
      if (msg.seq != null && msg.seq === this._lastSeq) return;
      this._lastSeq = msg.seq != null ? msg.seq : (msg.ts || 0);
      this._fixtures = msg.fixtures || [];
    }

    async _loadRigElementsOnce() {
      if (this._rigElementsLoaded) return;
      this._rigElementsLoaded = true;
      try {
        this._rigElements = await fetch('/api/rig-elements').then((r) => r.json());
        this._scheduleRender();
      } catch {
        this._rigElementsLoaded = false;
      }
    }

    destroy() {
      this.enabled = false;
      this._stopTransport();
      window.removeEventListener('resize', this._onResize);
      if (this._resizeObs) this._resizeObs.disconnect();
      if (this._bc) this._bc.close();
    }

    _wireCamera() {
      const canvas = this.canvas;
      canvas.addEventListener('mousedown', (e) => {
        if (!this.enabled) return;
        this._drag = { x: e.clientX, y: e.clientY, shift: e.shiftKey, az: this._cam.azimuth, el: this._cam.elevation, px: this._cam.panX, py: this._cam.panY };
      });
      window.addEventListener('mousemove', (e) => {
        if (!this._drag) return;
        const dx = e.clientX - this._drag.x;
        const dy = e.clientY - this._drag.y;
        if (this._drag.shift) {
          this._cam.panX = this._drag.px + dx / 600;
          this._cam.panY = this._drag.py + dy / 600;
        } else {
          this._cam.azimuth = this._drag.az + dx * 0.4;
          this._cam.elevation = Math.max(-85, Math.min(85, this._drag.el - dy * 0.3));
        }
        this._scheduleRender();
      });
      window.addEventListener('mouseup', () => { this._drag = null; });
      canvas.addEventListener('wheel', (e) => {
        if (!this.enabled) return;
        e.preventDefault();
        const delta = e.deltaY > 0 ? 0.92 : 1.08;
        this._cam.zoom = Math.max(0.25, Math.min(4, this._cam.zoom * delta));
        this._scheduleRender();
      }, { passive: false });
    }

    _resize() {
      const parent = this.canvas.parentElement;
      const w = Math.max(1, parent ? parent.clientWidth : this.canvas.clientWidth);
      const h = Math.max(1, parent ? parent.clientHeight : this.canvas.clientHeight);
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      this.canvas.width = Math.floor(w * dpr);
      this.canvas.height = Math.floor(h * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this._scheduleRender();
    }

    async _pollOnce() {
      if (!this._shouldPoll() || this._fetchInFlight || this._wsOk) return;
      this._fetchInFlight = true;
      try {
        const data = await fetch('/api/rig-output/snapshot?rig=0', { cache: 'no-store' }).then((r) => r.json());
        this._applyPayload(data);
        this._scheduleRender();
      } catch { /* keep last frame */ }
      finally {
        this._fetchInFlight = false;
      }
    }

    _drawPlaceholder(msg) {
      const w = this.canvas.clientWidth;
      const h = this.canvas.clientHeight;
      const ctx = this.ctx;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = '#0a0c12';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(255,255,255,.35)';
      ctx.font = '13px Inter, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(msg, w / 2, h / 2);
    }

    _line(ctx, p1, p2, stroke, width) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
    }

    _drawStage(ctx, w, h, cam) {
      const proj = (x, yH, zD) => toScreen(rigProject3d(x, yH, zD, cam), w, h);
      const GN = 6;
      for (let i = 0; i <= GN; i++) {
        const t = i / GN;
        const edge = i === 0 || i === GN;
        const sc = edge ? 'rgba(90,100,200,0.45)' : 'rgba(60,70,160,0.2)';
        const lw = edge ? 1.2 : 0.6;
        this._line(ctx, proj(t, FL, 0), proj(t, FL, 1), sc, lw);
        this._line(ctx, proj(0, FL, t), proj(1, FL, t), sc, lw);
      }
      [[0, 0], [1, 0], [0, 1], [1, 1]].forEach(([x, zD]) => {
        this._line(ctx, proj(x, CEIL, zD), proj(x, FL, zD), 'rgba(90,100,200,0.25)', 0.8);
      });
      this._line(ctx, proj(0, FL, 0), proj(1, FL, 0), 'rgba(255,210,60,0.55)', 2);
      ctx.fillStyle = 'rgba(255,210,60,0.45)';
      ctx.font = '10px Inter, system-ui, sans-serif';
      ctx.textAlign = 'center';
      const front = proj(0.5, FL, 0.02);
      ctx.fillText('STAGE FRONT', front.x, front.y + 14);
    }

    _drawTrussWire(ctx, el, w, h, cam) {
      const cx = el.x;
      const cy = el.z ?? 0.5;
      const cz = el.y ?? 0.5;
      const hw = (el.width || 0.4) / 2;
      const hh = (el.height || 0.02) / 2;
      const proj = (x, yH, zD) => toScreen(rigProject3d(x, yH, zD, cam), w, h);
      const stroke = 'rgba(184,200,208,0.85)';
      if (el.type === 'truss_h') {
        const yT = cy - hh;
        const yB = cy + hh;
        const z0 = cz - hw;
        const z1 = cz + hw;
        this._line(ctx, proj(cx - hw, yT, z0), proj(cx + hw, yT, z0), stroke, 1.2);
        this._line(ctx, proj(cx - hw, yB, z0), proj(cx + hw, yB, z0), stroke, 1.2);
        this._line(ctx, proj(cx - hw, yT, z1), proj(cx - hw, yB, z1), stroke, 1);
        this._line(ctx, proj(cx + hw, yT, z1), proj(cx + hw, yB, z1), stroke, 1);
      } else if (el.type === 'truss_v') {
        const yT = cy - hh;
        const yB = cy + hh;
        this._line(ctx, proj(cx, yT, cz), proj(cx, yB, cz), stroke, 1.2);
      } else {
        const p = proj(cx, cy, cz);
        ctx.strokeStyle = stroke;
        ctx.strokeRect(p.x - 8, p.y - 4, 16, 8);
      }
    }

    _drawMoverBeam(ctx, fix, w, h, cam) {
      const pos = fixturePos(fix);
      const end = beamEnd(fix);
      const p0 = toScreen(rigProject3d(pos.x, pos.yH, pos.zD, cam), w, h);
      const p1 = toScreen(rigProject3d(end.x, end.yH, end.zD, cam), w, h);
      const bright = Math.max(fix.r || 0, fix.g || 0, fix.b || 0) / 255;
      const dim = (fix.dimmer || 0) / 255;
      const alpha = Math.min(0.55, 0.06 + bright * 0.45 + dim * 0.2);
      if (alpha < 0.05) return;
      const spread = 4 + p0.scale * 8;
      ctx.strokeStyle = rgbCss(fix.r, fix.g, fix.b, alpha);
      ctx.lineWidth = spread;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.stroke();
    }

    _drawFixtureNode(ctx, fix, idx, w, h, cam) {
      const pos = fixturePos(fix);
      const p = toScreen(rigProject3d(pos.x, pos.yH, pos.zD, cam), w, h);
      const bright = Math.max(fix.r || 0, fix.g || 0, fix.b || 0) / 255;
      const radius = 7 + p.scale * 10 + bright * 6;
      const border = NODE_COLORS[idx % NODE_COLORS.length];
      if (bright > 0.03 || (fix.dimmer || 0) > 0) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, radius * 1.6, 0, Math.PI * 2);
        ctx.fillStyle = rgbCss(fix.r, fix.g, fix.b, 0.12 + bright * 0.25);
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = rgbCss(fix.r, fix.g, fix.b, 0.35 + bright * 0.55);
      ctx.fill();
      ctx.strokeStyle = border;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.font = `600 ${Math.max(8, 7 + p.scale * 4)}px Inter, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(fix.is_mover ? '◎' : '●', p.x, p.y);
      ctx.fillStyle = 'rgba(255,255,255,0.88)';
      ctx.font = `${Math.max(8, 7 + p.scale * 3)}px Inter, system-ui, sans-serif`;
      ctx.fillText(fix.name, p.x, p.y - radius - 6);
      return p.depth;
    }

    _render() {
      if (!this.enabled) {
        this._drawPlaceholder('Enable live preview to see fixture output on the rig');
        return;
      }
      if (this._isPausedByExternal()) {
        const w = this.canvas.clientWidth;
        const h = this.canvas.clientHeight;
        if (this._fixtures.length === 0) {
          this._drawPlaceholder('Live preview is running in the pop-out window');
          return;
        }
        this._renderScene(w, h);
        const ctx = this.ctx;
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.font = '14px Inter, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Live preview running in pop-out window', w / 2, h / 2);
        ctx.fillStyle = 'rgba(255,255,255,0.45)';
        ctx.font = '11px Inter, system-ui, sans-serif';
        ctx.fillText('Close the external window to resume here', w / 2, h / 2 + 20);
        return;
      }
      const w = this.canvas.clientWidth;
      const h = this.canvas.clientHeight;
      this._renderScene(w, h);
    }

    _renderScene(w, h) {
      const ctx = this.ctx;
      ctx.clearRect(0, 0, w, h);
      const bg = ctx.createLinearGradient(0, 0, 0, h);
      bg.addColorStop(0, '#0a0c14');
      bg.addColorStop(1, '#121528');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);

      this._drawStage(ctx, w, h, this._cam);

      const cam = this._cam;
      const drawList = [];

      for (const el of this._rigElements) {
        const p = rigProject3d(el.x, el.z ?? 0.5, el.y ?? 0.5, cam);
        drawList.push({ kind: 'truss', el, depth: p.depth ?? 0 });
      }

      const fixtures = this._fixtures || [];
      fixtures.forEach((fix, idx) => {
        if (fix.cells && fix.cells.length > 0 && fix.cell_path && fix.cell_path.length >= 1) {
          const pathPts = [{ x: fix.rig_x ?? 0.5, y: fix.rig_y ?? 0.5, z: fix.rig_z ?? 0.5 }, ...fix.cell_path];
          fix.cells.forEach((cell, ci) => {
            const t = fix.cells.length > 1 ? ci / (fix.cells.length - 1) : 0.5;
            const pos = interpolatePath(pathPts, t);
            const p = rigProject3d(pos.x, pos.yH, pos.zD, cam);
            drawList.push({ kind: 'cell', fix: { ...fix, r: cell.r, g: cell.g, b: cell.b, dimmer: cell.dimmer, is_mover: false }, idx, depth: p.depth ?? 0 });
          });
          return;
        }
        const pos = fixturePos(fix);
        const p = rigProject3d(pos.x, pos.yH, pos.zD, cam);
        drawList.push({ kind: 'beam', fix, idx, depth: p.depth ?? 0 });
        drawList.push({ kind: 'fixture', fix, idx, depth: (p.depth ?? 0) + 0.001 });
      });

      drawList.sort((a, b) => b.depth - a.depth);

      for (const item of drawList) {
        if (item.kind === 'truss') this._drawTrussWire(ctx, item.el, w, h, cam);
        else if (item.kind === 'beam' && item.fix.is_mover) this._drawMoverBeam(ctx, item.fix, w, h, cam);
        else if (item.kind === 'fixture' || item.kind === 'cell') this._drawFixtureNode(ctx, item.fix, item.idx, w, h, cam);
      }

      ctx.fillStyle = 'rgba(255,255,255,0.28)';
      ctx.font = '10px Inter, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Drag = orbit · Shift+drag = pan · Scroll = zoom', w / 2, h - 10);
    }
  }

  global.RigOutputVisualizer = RigOutputVisualizer;
  global.RIG_OUTPUT_VIZ_LS = LS_ENABLE;
  global.RIG_OUTPUT_VIZ_EXTERNAL_LS = LS_EXTERNAL_ACTIVE;
})(typeof window !== 'undefined' ? window : globalThis);
