// Geführte Rundumaufnahme aus der Fahrzeugmitte.
// Live-Kamerabild + Bewegungssensor: Zielkreise zeigen, wohin das Handy gedreht werden soll.
// Steht das Handy ruhig auf einem Ziel, wird automatisch ausgelöst. Jedes Foto bekommt die
// Kamerarichtung vom Sensor mit (später per Bildvergleich verfeinert).

import { deviceCameraR, screenAngle } from './viewer.js';
import { capturePlan, guessHfov, dirOf } from './capture-plan.js';
import { rotationMatrix, mul3, DEG } from './math.js';

const AIM_DEG = 3.5;      // so nah muss die Bildmitte am Ziel sein
const STEADY_DEG_S = 5;   // max. Drehgeschwindigkeit für Auto-Auslösen
const HOLD_MS = 450;      // so lange ruhig halten

export class SphereCapture {
  /**
   * @param {HTMLElement} root Overlay-Element (enthält video, canvas, Bedienelemente)
   * @param {{onShot:(shot)=>Promise<void>, onClose:(count)=>void, onStatus:(t)=>void}} cb
   */
  constructor(root, cb) {
    this.root = root;
    this.cb = cb;
    this.video = root.querySelector('video');
    this.overlay = root.querySelector('.cap-overlay');
    this.map = root.querySelector('.cap-map');
    this.hint = root.querySelector('.cap-hint');
    this.count = root.querySelector('.cap-count');
    this.plan = capturePlan();
    this.done = new Set();
    this.yaw0 = null;
    this.R = null;
    this.lastR = null;
    this.lastT = 0;
    this.speed = 999;
    this.holdSince = 0;
    this.busy = false;
    this.auto = true;
    this._onOrient = this._onOrient.bind(this);
    this._frame = this._frame.bind(this);
    root.querySelector('.cap-shutter').addEventListener('click', () => this.shoot(true));
    root.querySelector('.cap-done').addEventListener('click', () => this.close());
    root.querySelector('.cap-cancel').addEventListener('click', () => this.close());
    const autoBtn = root.querySelector('.cap-auto');
    autoBtn.addEventListener('click', () => {
      this.auto = !this.auto;
      autoBtn.setAttribute('aria-pressed', String(this.auto));
    });
  }

  async open() {
    this.root.hidden = false;
    this.done.clear();
    this.yaw0 = null;
    this.shots = 0;
    this._setHint('Kamera wird gestartet …');
    // Bewegungssensor
    if (typeof DeviceOrientationEvent === 'undefined') return this._fail('Dieses Gerät hat keinen Bewegungssensor. Die Rundumaufnahme braucht ein Handy.');
    // iOS und neuere Chromium-Versionen fragen nach Erlaubnis. Eine Ablehnung ist nicht immer
    // endgültig (manche Browser liefern trotzdem Daten) – die Zeitüberwachung unten meldet sich,
    // wenn tatsächlich keine Sensordaten ankommen.
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
      try { this.permission = await DeviceOrientationEvent.requestPermission(); } catch { this.permission = 'error'; }
    }
    window.addEventListener('deviceorientation', this._onOrient);
    // Kamera
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1440 } },
      });
    } catch (err) {
      return this._fail('Kamera nicht verfügbar oder nicht erlaubt (' + (err.name || err.message) + ').');
    }
    this.video.srcObject = this.stream;
    this.video.setAttribute('playsinline', '');
    this.video.muted = true;
    try { await this.video.play(); } catch {}
    try { this.wake = await navigator.wakeLock?.request('screen'); } catch {}
    try { await screen.orientation?.lock?.('portrait'); } catch {}
    this.running = true;
    this.sensorSeen = false;
    setTimeout(() => {
      if (this.running && !this.sensorSeen) this._setHint(this.permission && this.permission !== 'granted'
        ? 'Zugriff auf den Bewegungssensor wurde nicht erlaubt. Bitte in den Browser-Einstellungen „Bewegungssensoren“ für diese Seite erlauben.'
        : 'Keine Daten vom Bewegungssensor. Bitte das Handy kurz bewegen. Falls das nicht hilft: Diese Funktion braucht ein Handy mit Lagesensor.');
    }, 2500);
    this._setHint('Handy HOCHKANT, Kamera mittig zwischen den Vordersitzen auf Kopfhöhe. Auf die Mitte des Armaturenbretts richten und den Auslöser drücken. Beim Drehen die Kamera möglichst an derselben Stelle lassen.');
    requestAnimationFrame(this._frame);
    this._updateCount();
  }

  _fail(msg) {
    this._setHint(msg);
    this.cb.onStatus && this.cb.onStatus(msg);
    this.failed = true;
  }

  _setHint(t) { this.hint.textContent = t; }

  _updateCount() {
    this.count.textContent = `${this.done.size} / ${this.plan.length}`;
  }

  _onOrient(e) {
    if (e.alpha == null) return;
    this.sensorSeen = true;
    const raw = deviceCameraR(e.alpha, e.beta, e.gamma, screenAngle());
    const now = performance.now();
    if (this.lastR) {
      const dt = Math.max(1, now - this.lastT) / 1000;
      const ang = angleBetween(this.lastR, raw);
      this.speed = 0.7 * this.speed + 0.3 * (ang / dt);
    }
    this.lastR = raw;
    this.lastT = now;
    this.raw = raw;
  }

  /** Kamera-Drehung relativ zur Startrichtung („vorne“ = erstes Foto). */
  relR() {
    if (!this.raw) return null;
    if (this.yaw0 == null) return this.raw;
    return mul3(rotationMatrix(-this.yaw0, 0, 0), this.raw);
  }

  nextTarget() {
    return this.plan.find((t) => !this.done.has(t.index)) || null;
  }

  /** Ziel, auf das die Kamera gerade zeigt (innerhalb AIM_DEG), sonst null. */
  aimedTarget(R) {
    const f = [R[2], R[5], R[8]];
    let best = null, bestA = AIM_DEG;
    for (const t of this.plan) {
      if (this.done.has(t.index)) continue;
      const d = dirOf(t.yaw, t.pitch);
      const a = Math.acos(Math.max(-1, Math.min(1, f[0] * d[0] + f[1] * d[1] + f[2] * d[2]))) / DEG;
      if (a < bestA) { bestA = a; best = t; }
    }
    return best;
  }

  async shoot(manual) {
    if (this.busy || !this.running || !this.raw) return;
    const vw = this.video.videoWidth, vh = this.video.videoHeight;
    if (!vw || !vh) return;
    let target = null;
    if (this.yaw0 == null) {
      // erstes Foto legt „vorne“ fest
      this.yaw0 = Math.atan2(this.raw[2], this.raw[8]) / DEG;
      target = this.plan[0];
    } else {
      target = this.aimedTarget(this.relR());
      if (!target && !manual) return;
    }
    this.busy = true;
    const R = this.relR();
    const c = document.createElement('canvas');
    c.width = vw; c.height = vh;
    c.getContext('2d').drawImage(this.video, 0, 0, vw, vh);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.92));
    if (target) this.done.add(target.index);
    this.shots++;
    this._flash();
    try {
      await this.cb.onShot({ blob, R, width: vw, height: vh, hfovGuess: guessHfov(vw, vh), target: target ? target.index : null, speed: this.speed });
    } catch (err) {
      this._setHint('Foto konnte nicht gespeichert werden: ' + err.message);
    }
    this.busy = false;
    this.holdSince = 0;
    this._updateCount();
    const nx = this.nextTarget();
    if (!nx) this._setHint('Alle Richtungen aufgenommen. Tippe auf „Fertig“.');
  }

  _flash() {
    this.root.classList.add('flash');
    setTimeout(() => this.root.classList.remove('flash'), 120);
    try { navigator.vibrate?.(30); } catch {}
  }

  _frame() {
    if (!this.running) return;
    this._draw();
    // Auto-Auslösen
    if (this.auto && this.yaw0 != null && !this.busy && this.raw) {
      const t = this.aimedTarget(this.relR());
      if (t && this.speed < STEADY_DEG_S) {
        if (!this.holdSince) this.holdSince = performance.now();
        if (performance.now() - this.holdSince > HOLD_MS) this.shoot(false);
      } else this.holdSince = 0;
    }
    requestAnimationFrame(this._frame);
  }

  _draw() {
    const cv = this.overlay, ctx = cv.getContext('2d');
    const W = cv.clientWidth, H = cv.clientHeight, dpr = Math.min(2, window.devicePixelRatio || 1);
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const R = this.relR();
    // Fadenkreuz
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(W / 2, H / 2, 10, 0, 2 * Math.PI);
    ctx.moveTo(W / 2 - 22, H / 2); ctx.lineTo(W / 2 - 12, H / 2);
    ctx.moveTo(W / 2 + 12, H / 2); ctx.lineTo(W / 2 + 22, H / 2);
    ctx.stroke();
    if (!R || this.yaw0 == null) { this._drawMap(null); return; }
    // Projektion wie im Video (object-fit: cover)
    const vw = this.video.videoWidth || W, vh = this.video.videoHeight || H;
    const scale = Math.max(W / vw, H / vh);
    const f = (vw / 2) / Math.tan((guessHfov(vw, vh) * DEG) / 2) * scale;
    const next = this.nextTarget();
    const holdFrac = this.holdSince ? Math.min(1, (performance.now() - this.holdSince) / HOLD_MS) : 0;
    const aimed = this.aimedTarget(R);
    for (const t of this.plan) {
      if (this.done.has(t.index)) continue;
      const d = dirOf(t.yaw, t.pitch);
      // Kamera-Koordinaten c = Rᵀ d
      const cx = R[0] * d[0] + R[3] * d[1] + R[6] * d[2];
      const cy = R[1] * d[0] + R[4] * d[1] + R[7] * d[2];
      const cz = R[2] * d[0] + R[5] * d[1] + R[8] * d[2];
      const isNext = next && t.index === next.index;
      if (cz > 0.15) {
        const x = W / 2 + (f * cx) / cz, y = H / 2 - (f * cy) / cz;
        const r = f * Math.tan(AIM_DEG * DEG);
        ctx.lineWidth = isNext ? 4 : 2;
        ctx.strokeStyle = isNext ? '#2fd15a' : 'rgba(255,255,255,0.75)';
        ctx.beginPath();
        ctx.arc(x, y, Math.max(14, r), 0, 2 * Math.PI);
        ctx.stroke();
        if (aimed && aimed.index === t.index && holdFrac > 0) {
          ctx.strokeStyle = '#ffd43b';
          ctx.lineWidth = 6;
          ctx.beginPath();
          ctx.arc(x, y, Math.max(14, r) + 6, -Math.PI / 2, -Math.PI / 2 + holdFrac * 2 * Math.PI);
          ctx.stroke();
        }
      }
      if (isNext && !(cz > 0.15 && Math.abs(cx / cz) < (W / 2) / f && Math.abs(cy / cz) < (H / 2) / f)) {
        // Pfeil am Rand in Richtung des nächsten Ziels
        let ax = cx, ay = -cy;
        if (cz <= 0.15 && Math.hypot(ax, ay) < 1e-3) ax = 1;
        const n = Math.hypot(ax, ay) || 1;
        ax /= n; ay /= n;
        const rr = Math.min(W, H) * 0.38;
        const px = W / 2 + ax * rr, py = H / 2 + ay * rr;
        ctx.fillStyle = '#2fd15a';
        ctx.beginPath();
        ctx.moveTo(px + ax * 22, py + ay * 22);
        ctx.lineTo(px - ay * 14, py + ax * 14);
        ctx.lineTo(px + ay * 14, py - ax * 14);
        ctx.closePath();
        ctx.fill();
      }
    }
    if (!this.busy) {
      if (!next) this._setHint('Alle Richtungen aufgenommen. Tippe auf „Fertig“.');
      else if (aimed) this._setHint(this.speed < STEADY_DEG_S ? 'Ruhig halten …' : 'Langsamer – ruhig halten.');
      else this._setHint(next.pitch > 80 ? 'Jetzt nach OBEN zum Dach drehen (grüner Pfeil).' : next.pitch < -80 ? 'Jetzt nach UNTEN zum Boden drehen (grüner Pfeil).' : 'Zum grünen Kreis drehen. Kamera an derselben Stelle lassen, nur drehen.');
    }
    this._drawMap(R);
  }

  _drawMap(R) {
    const c = this.map, ctx = c.getContext('2d');
    const w = c.width, h = c.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
    const pos = (yaw, pitch) => [((yaw + 180) / 360) * w, ((90 - pitch) / 180) * h];
    for (const t of this.plan) {
      const [x, y] = pos(t.yaw, t.pitch);
      ctx.fillStyle = this.done.has(t.index) ? '#2fd15a' : 'rgba(255,255,255,0.8)';
      ctx.beginPath();
      ctx.arc(x, y, 3.5, 0, 2 * Math.PI);
      ctx.fill();
    }
    if (R && this.yaw0 != null) {
      const yaw = Math.atan2(R[2], R[8]) / DEG, pitch = Math.asin(Math.max(-1, Math.min(1, R[5]))) / DEG;
      const [x, y] = pos(yaw, pitch);
      ctx.strokeStyle = '#ffd43b';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, 2 * Math.PI);
      ctx.stroke();
    }
  }

  close() {
    this.running = false;
    window.removeEventListener('deviceorientation', this._onOrient);
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    this.stream = null;
    try { this.wake?.release(); } catch {}
    try { screen.orientation?.unlock?.(); } catch {}
    this.root.hidden = true;
    this.cb.onClose && this.cb.onClose(this.shots || 0);
  }
}

function angleBetween(A, B) {
  let tr = 0;
  for (let i = 0; i < 3; i++) for (let k = 0; k < 3; k++) tr += A[k * 3 + i] * B[k * 3 + i];
  return Math.acos(Math.max(-1, Math.min(1, (tr - 1) / 2))) / DEG;
}
