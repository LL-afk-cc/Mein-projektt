// Auto360 Innenraum – Oberfläche (Handy-Web-App, alles läuft lokal auf dem Gerät).

import { PanoViewer } from './viewer.js';
import { store } from './store.js';
import { buildViewerHtml } from './viewer-export.js';
import { DEFAULT_PARAMS } from './compose.js';
import { SphereCapture } from './capture.js';
import { rotationMatrix, transpose3, mul3 } from './math.js';

const $ = (s) => document.querySelector(s);
const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids) if (k != null) e.append(k);
  return e;
};
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const fmtPct = (x) => (x * 100).toLocaleString('de-DE', { maximumFractionDigits: 1 }) + ' %';
const fmtNum = (x, d = 1) => Number(x).toLocaleString('de-DE', { maximumFractionDigits: d, minimumFractionDigits: d });
const fmtTime = (ms) => {
  if (ms == null || !isFinite(ms)) return '';
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`;
};

// Richtungen für Insel-Fotos (Blick aus der Mitte, 0° = nach vorne)
const DIRECTIONS = [
  ['vorne', 'vorne', 0], ['vorne-links', 'vorne links', -45], ['links', 'links', -90],
  ['hinten-links', 'hinten links', -135], ['hinten', 'hinten', 180], ['hinten-rechts', 'hinten rechts', 135],
  ['rechts', 'rechts', 90], ['vorne-rechts', 'vorne rechts', 45],
];
const ROLES = [
  ['anchor', 'Anker (Cockpit)'], ['island', 'Insel (ungefähre Lage)'], ['off', 'Nicht verwenden'],
];
const SLIDERS = [
  { k: 'hfov', label: 'Sichtfeld (Brennweite)', min: 20, max: 120, step: 0.5, unit: '°' },
  { k: 'yaw', label: 'Drehen links/rechts (Gier)', min: -180, max: 180, step: 0.5, unit: '°' },
  { k: 'pitch', label: 'Hoch/runter (Nick)', min: -70, max: 70, step: 0.5, unit: '°' },
  { k: 'roll', label: 'Kippen (Roll)', min: -25, max: 25, step: 0.25, unit: '°' },
  { group: 'Rand beschneiden (z. B. Türrahmen weg)' },
  { k: 'cropL', label: 'Links', min: 0, max: 45, step: 0.5, unit: ' %', pct: true },
  { k: 'cropR', label: 'Rechts', min: 0, max: 45, step: 0.5, unit: ' %', pct: true },
  { k: 'cropT', label: 'Oben', min: 0, max: 45, step: 0.5, unit: ' %', pct: true },
  { k: 'cropB', label: 'Unten', min: 0, max: 45, step: 0.5, unit: ' %', pct: true },
  { k: 'feather', label: 'Weiche Kante', min: 1, max: 30, step: 0.5, unit: ' %', pct: true },
];

const state = {
  photos: [],
  selected: null,
  title: '',
  res: 8192,
  quality: 96,
  result: null,
  building: false,
  // Rundumaufnahme: gemeinsame Einstellungen aller Rundumfotos
  rundum: { hfov: null, yaw: 0, pitch: 0, roll: 0, blendPower: 48, aligned: false, align: null },
};
const DEFAULT_RUNDUM = () => ({ hfov: null, yaw: 0, pitch: 0, roll: 0, blendPower: 48, aligned: false, align: null });
const isRundum = () => state.photos.some((p) => p.isShot);
const shots = () => state.photos.filter((p) => p.isShot);
const RUNDUM_SLIDERS = [
  { k: 'yaw', label: 'Blickrichtung „vorne“ drehen', min: -180, max: 180, step: 0.5, unit: '°' },
  { k: 'pitch', label: 'Horizont hoch/runter', min: -15, max: 15, step: 0.1, unit: '°' },
  { k: 'roll', label: 'Horizont kippen', min: -15, max: 15, step: 0.1, unit: '°' },
  { k: 'hfov', label: 'Kamera-Sichtfeld', min: 30, max: 100, step: 0.1, unit: '°' },
  { k: 'blendPower', label: 'Übergänge (weich ↔ scharf)', min: 4, max: 128, step: 1, unit: '' },
];

// ---------------------------------------------------------------------------
// Worker mit Wiederherstellung (bei Abbruch oder Speicherfehler neu starten)

let worker = null;
let reqSeq = 0;
const pending = new Map();

function startWorker() {
  worker = new Worker('js/worker.js', { type: 'module' });
  worker.onmessage = (e) => {
    const m = e.data;
    const p = pending.get(m.reqId);
    if (!p) return;
    if (m.type === 'progress') return p.onProgress && p.onProgress(m);
    pending.delete(m.reqId);
    if (m.type === 'result') p.resolve(m.result);
    else p.reject(new Error(m.message));
  };
  worker.onerror = (e) => {
    const msg = 'Die Berechnung ist abgestürzt (vermutlich zu wenig Arbeitsspeicher). ' + (e.message || '');
    for (const p of pending.values()) p.reject(new Error(msg));
    pending.clear();
    restartWorker();
  };
}

function call(type, payload, onProgress) {
  const reqId = ++reqSeq;
  return new Promise((resolve, reject) => {
    pending.set(reqId, { resolve, reject, onProgress });
    worker.postMessage({ type, reqId, payload });
  });
}

function restartWorker() {
  if (worker) worker.terminate();
  for (const p of pending.values()) p.reject(new Error('abgebrochen'));
  pending.clear();
  startWorker();
  for (const ph of state.photos) {
    ph.ready = false;
    loadIntoWorker(ph);
  }
}

async function loadIntoWorker(ph) {
  try {
    const info = await call('addImage', { id: ph.id, blob: ph.blob, shot: !!ph.isShot });
    Object.assign(ph, { ready: true, width: info.width, height: info.height, score: info.score, rollEst: info.roll });
    return info;
  } catch (err) {
    ph.error = String(err.message || err);
    setStatus('Foto konnte nicht gelesen werden: ' + ph.name);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Speicher

let saveTimer = null;
function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 400);
}
async function saveNow() {
  for (const ph of state.photos) {
    await store.putPhoto({
      id: ph.id, name: ph.name, blob: ph.blob, thumb: ph.thumb, role: ph.role, dir: ph.dir,
      params: ph.params, order: ph.order,
      isShot: !!ph.isShot, sensorR: ph.sensorR || null, R: ph.R || null, gain: ph.gain || null, hfovGuess: ph.hfovGuess || null,
    });
  }
  await store.set('project', { title: state.title, res: state.res, quality: state.quality, selected: state.selected, rundum: state.rundum });
}

// ---------------------------------------------------------------------------
// Fotos

async function makeThumb(blob) {
  try {
    const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image', resizeWidth: 360, resizeQuality: 'medium' });
    const c = document.createElement('canvas');
    c.width = bmp.width; c.height = bmp.height;
    c.getContext('2d').drawImage(bmp, 0, 0);
    bmp.close();
    return c.toDataURL('image/jpeg', 0.8);
  } catch {
    return '';
  }
}

async function addFiles(files) {
  const list = [...files].filter((f) => f.type.startsWith('image/') || /\.(jpe?g|png|webp|heic)$/i.test(f.name));
  if (!list.length) return;
  setStatus(`${list.length} Foto(s) werden geladen …`);
  const added = [];
  for (const f of list) {
    const ph = {
      id: uid(), name: f.name || 'Foto', blob: f, thumb: await makeThumb(f),
      role: 'off', dir: 'hinten', params: { ...DEFAULT_PARAMS }, order: state.photos.length, ready: false,
    };
    state.photos.push(ph);
    added.push(ph);
    renderPhotos();
  }
  await Promise.all(added.map(loadIntoWorker));
  autoAnchor();
  renderPhotos();
  saveNow();
  setStatus(`${state.photos.length} Foto(s) bereit.`);
  schedulePreview(true);
}

function autoAnchor() {
  if (state.photos.some((p) => p.role === 'anchor')) return;
  const ready = state.photos.filter((p) => p.ready);
  if (!ready.length) return;
  const best = ready.reduce((a, b) => (b.score > a.score ? b : a));
  setRole(best, 'anchor');
  best.suggested = true;
}

function setRole(ph, role) {
  if (role === 'anchor') {
    for (const o of state.photos) if (o !== ph && o.role === 'anchor') o.role = 'off';
    if (ph.role !== 'anchor') {
      const r = ph.rollEst && ph.rollEst.confidence >= 0.1 ? ph.rollEst.roll : 0;
      ph.params = { ...DEFAULT_PARAMS, yaw: 0, pitch: -8, hfov: 68, roll: r, feather: 0.04 };
    }
  } else if (role === 'island' && ph.role !== 'island') {
    const d = DIRECTIONS.find((x) => x[0] === ph.dir) || DIRECTIONS[4];
    ph.params = { ...DEFAULT_PARAMS, yaw: d[2], pitch: -10, hfov: 70, feather: 0.12 };
  }
  ph.role = role;
  if (role !== 'off') state.selected = ph.id;
}

const anchor = () => state.photos.find((p) => p.role === 'anchor');

function renderPhotos() {
  const box = $('#photos');
  box.replaceChildren();
  for (const ph of state.photos) {
    const roles = ph.isShot ? [['shot', 'Rundumfoto'], ['off', 'Nicht verwenden']] : ROLES;
    const roleSel = el('select', { 'aria-label': 'Verwendung', onchange: (e) => {
        if (ph.isShot) { ph.role = e.target.value; state.rundum.aligned = false; } else setRole(ph, e.target.value);
        renderPhotos(); renderEditor(); saveSoon(); schedulePreview(true);
      } },
      ...roles.map(([v, t]) => el('option', { value: v, selected: ph.role === v }, t)));
    const dirSel = ph.role === 'island'
      ? el('select', { 'aria-label': 'Richtung aus der Mitte', onchange: (e) => {
          ph.dir = e.target.value;
          const d = DIRECTIONS.find((x) => x[0] === ph.dir);
          ph.params = { ...ph.params, yaw: d[2] };
          saveSoon(); schedulePreview(true); renderEditor();
        } }, ...DIRECTIONS.map(([v, t]) => el('option', { value: v, selected: ph.dir === v }, 'Blick ' + t)))
      : null;
    const card = el('div', { class: 'photo' + (ph.role === 'anchor' ? ' anchor' : '') },
      el('img', { src: ph.thumb || '', alt: ph.name, loading: 'lazy' }),
      el('div', { class: 'meta' },
        el('div', { class: 'name', title: ph.name },
          ph.role === 'anchor' && ph.suggested ? el('span', { class: 'badge' }, 'Vorschlag') : null,
          ph.role === 'anchor' && ph.suggested ? ' ' : null,
          ph.ready ? ph.name : ph.error ? 'Fehler: ' + ph.name : 'wird geladen …'),
        roleSel, dirSel,
        el('button', { class: 'del', onclick: () => removePhoto(ph) }, 'Entfernen')));
    box.append(card);
  }
  const a = anchor();
  if (isRundum()) {
    const n = shots().filter((p) => p.role === 'shot').length;
    const singles = state.photos.filter((p) => !p.isShot).length;
    $('#anchor-hint').textContent = `Rundumaufnahme: ${n} Fotos.` + (singles ? ` ${singles} Einzelfoto(s) werden dafür nicht verwendet.` : '') +
      (state.rundum.aligned ? ' Ausgerichtet – weiter mit Schritt 2 oder 3.' : ' Noch nicht ausgerichtet – Schritt 2 „Ausrichten“.');
    return;
  }
  $('#anchor-hint').textContent = !state.photos.length
    ? 'Tipp: Alle Innenraumfotos eines Fahrzeugs auf einmal auswählen. Das Cockpit-Gesamtfoto wird automatisch als Anker vorgeschlagen.'
    : a ? `Anker: „${a.name}“. Weiter mit Schritt 2 „Ausrichten“.` : 'Bitte ein Foto als Anker (Cockpit) wählen.';
}

async function removePhoto(ph) {
  state.photos = state.photos.filter((p) => p !== ph);
  call('removeImage', { id: ph.id }).catch(() => {});
  await store.deletePhoto(ph.id);
  if (state.selected === ph.id) state.selected = null;
  renderPhotos();
  renderEditor();
  schedulePreview(true);
}

async function newVehicle() {
  if (state.photos.length && !confirm('Alle Fotos und Einstellungen dieses Fahrzeugs entfernen?')) return;
  for (const ph of state.photos) call('removeImage', { id: ph.id }).catch(() => {});
  state.photos = [];
  state.selected = null;
  state.result = null;
  state.rundum = DEFAULT_RUNDUM();
  state.title = '';
  $('#inp-title').value = '';
  await store.clearPhotos();
  await store.del('result');
  await saveNow();
  renderPhotos();
  renderEditor();
  showResult(null);
  previewViewer.hasImage = false;
  setStatus('Neues Fahrzeug – bitte Fotos auswählen.');
}

// ---------------------------------------------------------------------------
// Ausrichten

/** Gesamtkorrektur der Rundumaufnahme: neue Blickrichtung „vorne“ = alte Richtung (yaw, pitch, roll). */
function rundumG() {
  const r = state.rundum;
  return transpose3(rotationMatrix(r.yaw, r.pitch, r.roll));
}

function activeLayers() {
  if (isRundum()) {
    const G = rundumG();
    const r = state.rundum;
    const hfov = r.hfov || shots()[0]?.hfovGuess || 53;
    return shots()
      .filter((p) => p.ready && p.role === 'shot')
      .map((p) => ({
        id: p.id, kind: 'shot',
        params: { ...DEFAULT_PARAMS, R: mul3(G, (r.aligned && p.R) || p.sensorR), hfov, gain: (r.aligned && p.gain) || [1, 1, 1], blendPower: r.blendPower, feather: 0.02 },
      }));
  }
  return state.photos
    .filter((p) => p.ready && p.role !== 'off')
    .map((p) => ({ id: p.id, kind: p.role, params: p.params }));
}

function selectedPhoto() {
  const used = state.photos.filter((p) => p.role !== 'off');
  return used.find((p) => p.id === state.selected) || used.find((p) => p.role === 'anchor') || used[0] || null;
}

function renderEditor() {
  const rund = isRundum();
  $('#single-editor').hidden = rund;
  $('#rundum-editor').hidden = !rund;
  if (rund) return renderRundumEditor();
  const used = state.photos.filter((p) => p.role !== 'off');
  const sel = $('#sel-layer');
  const cur = selectedPhoto();
  sel.replaceChildren(...used.map((p) => el('option', { value: p.id, selected: cur && p.id === cur.id },
    `${ROLES.find((r) => r[0] === p.role)[1]} – ${p.name}`)));
  const box = $('#sliders');
  box.replaceChildren();
  $('#btn-auto-roll').disabled = !cur;
  $('#btn-reset-layer').disabled = !cur;
  renderScore(cur);
  if (!cur) {
    box.append(el('p', { class: 'hint' }, 'Erst unter „Fotos“ einen Anker wählen.'));
    return;
  }
  for (const s of SLIDERS) {
    if (s.group) { box.append(el('div', { class: 'group-title' }, s.group)); continue; }
    const get = () => (s.pct ? cur.params[s.k] * 100 : cur.params[s.k]);
    const val = el('span', { class: 'val' });
    const range = el('input', { type: 'range', min: s.min, max: s.max, step: s.step, value: get(), 'aria-label': s.label });
    const show = () => { val.textContent = fmtNum(get(), s.step < 1 ? (s.step < 0.5 ? 2 : 1) : 0) + s.unit; };
    const set = (v, final) => {
      v = Math.max(s.min, Math.min(s.max, Number(v)));
      cur.params = { ...cur.params, [s.k]: s.pct ? v / 100 : v };
      range.value = v;
      show();
      schedulePreview(final);
      saveSoon();
      if (['yaw', 'pitch'].includes(s.k)) previewViewer.lookAt(cur.params.yaw, cur.params.pitch);
    };
    range.addEventListener('input', () => set(range.value, false));
    range.addEventListener('change', () => set(range.value, true));
    const fine = s.k === 'roll' ? 0.25 : 0.5;
    show();
    box.append(el('div', { class: 'slider' },
      el('label', {}, s.label), val,
      el('div', { class: 'ctl' },
        el('button', { 'aria-label': s.label + ' verringern', onclick: () => set(get() - fine, true) }, '−'),
        range,
        el('button', { 'aria-label': s.label + ' erhöhen', onclick: () => set(get() + fine, true) }, '+'))));
  }
}

function sliderRow(s, get, setVal) {
  const val = el('span', { class: 'val' });
  const range = el('input', { type: 'range', min: s.min, max: s.max, step: s.step, value: get(), 'aria-label': s.label });
  const show = () => { val.textContent = fmtNum(get(), s.step < 1 ? (s.step < 0.5 ? (s.step < 0.25 ? 1 : 2) : 1) : 0) + s.unit; };
  const set = (v, final) => {
    v = Math.max(s.min, Math.min(s.max, Number(v)));
    setVal(v, final);
    range.value = v;
    show();
  };
  range.addEventListener('input', () => set(range.value, false));
  range.addEventListener('change', () => set(range.value, true));
  const fine = s.step < 0.5 ? s.step : 0.5;
  show();
  return el('div', { class: 'slider' },
    el('label', {}, s.label), val,
    el('div', { class: 'ctl' },
      el('button', { 'aria-label': s.label + ' verringern', onclick: () => set(get() - fine, true) }, '−'),
      range,
      el('button', { 'aria-label': s.label + ' erhöhen', onclick: () => set(get() + fine, true) }, '+')));
}

function renderRundumEditor() {
  const r = state.rundum;
  if (!r.hfov) r.hfov = shots()[0]?.hfovGuess || 53;
  const box = $('#rundum-sliders');
  box.replaceChildren(...RUNDUM_SLIDERS.map((s) => sliderRow(s, () => r[s.k], (v, final) => {
    r[s.k] = v;
    schedulePreview(final);
    saveSoon();
  })));
  renderAlignSummary();
}

function renderAlignSummary() {
  const r = state.rundum, box = $('#align-summary');
  box.className = 'score';
  if (!r.aligned || !r.align) {
    box.classList.add('mid');
    box.textContent = 'Noch nicht ausgerichtet: Die Fotos liegen nur nach Bewegungssensor (wenige Grad ungenau, dadurch doppelte Kanten). „Automatisch ausrichten“ tippen.';
    return;
  }
  const a = r.align;
  const cls = a.usable === false ? 'bad' : a.score >= 0.85 && !a.weak.length ? 'good' : a.score >= 0.7 ? 'mid' : 'bad';
  box.classList.add(cls);
  box.replaceChildren(
    el('div', {}, `Ausgerichtet in ${fmtTime(a.ms)}: Übereinstimmung der Überlappungen ${fmtNum(a.score, 2)} (1 = perfekt), Kamera-Sichtfeld ${fmtNum(a.hfov, 1)}°` + (a.fovOk ? '' : ' (nicht sicher bestimmt – ggf. Regler „Kamera-Sichtfeld“ prüfen)') + '.'),
    a.weak.length ? el('div', {}, 'Schlecht passende Nachbarn (Bewegung, Parallaxe oder strukturlose Fläche): ' + a.weak.join(', ') + '. Dort im Viewer auf doppelte Kanten achten; ggf. das Foto unter „Fotos“ auf „Nicht verwenden“ stellen.') : null,
    a.usable === false ? el('div', {}, 'Der Bildvergleich hat nicht funktioniert (Fotos zu verwackelt, zu dunkel oder ohne Überlappung). Es werden nur die Sensorwerte verwendet – an den Übergängen sind doppelte Kanten wahrscheinlich. Am besten neu aufnehmen.') : null,
    a.usable !== false && a.kept ? el('div', {}, `${a.kept} Foto(s) passten im Bildvergleich nicht und behalten ihre Sensor-Lage.`) : null,
  );
}

async function alignRundum() {
  const list = shots().filter((p) => p.ready && p.role === 'shot');
  if (list.length < 2) { setStatus('Zu wenige Rundumfotos zum Ausrichten.'); return false; }
  const btn = $('#btn-align-shots');
  btn.disabled = true;
  const prog = $('#align-progress');
  prog.hidden = false;
  const show = (m) => {
    prog.querySelector('.progress-label').textContent = m.label || '';
    prog.querySelector('.fill').style.width = (Math.min(0.99, m.frac) * 100).toFixed(1) + '%';
    prog.querySelector('.progress-meta').textContent = `${Math.floor(Math.min(0.99, m.frac) * 100)} %` + (m.etaMs != null ? ` · noch ca. ${fmtTime(m.etaMs)}` : '');
  };
  show({ label: 'Starte Ausrichtung …', frac: 0 });
  try {
    const hfov = state.rundum.hfov || list[0].hfovGuess || 53;
    const r = await call('align', { shots: list.map((p) => ({ id: p.id, R: p.sensorR })), hfov }, show);
    const byId = Object.fromEntries(list.map((p) => [p.id, p]));
    // Absicherung: Ist der Bildvergleich insgesamt unbrauchbar (z. B. verwackelt, zu dunkel), bleiben
    // die Sensorwerte. Einzelne Fotos, die > 10° vom Sensor wegrutschen, behalten ebenfalls ihren Sensorwert.
    const usable = (r.score ?? 0) >= 0.5;
    let kept = 0;
    r.ids.forEach((id, k) => {
      const ok = usable && r.sensorDeviation[k] <= 10;
      byId[id].R = ok ? r.Rs[k] : byId[id].sensorR;
      byId[id].gain = usable ? r.gains[k] : [1, 1, 1];
      if (!ok) kept++;
    });
    const name = (k) => byId[r.ids[k]].name.replace('Rundum ', '#');
    state.rundum.hfov = r.hfov;
    state.rundum.aligned = true;
    state.rundum.align = {
      score: r.score ?? 0, hfov: usable ? r.hfov : (list[0].hfovGuess || r.hfov), fovOk: usable && !!(r.fov && r.fov.ok), ms: r.ms,
      weak: r.pairs.filter((p) => p.ncc != null && p.ncc < 0.6).map((p) => `${name(p.i)}–${name(p.j)} (${fmtNum(p.ncc, 2)})`),
      maxDev: Math.max(0, ...r.sensorDeviation), pairs: r.pairs.length,
      usable, kept,
    };
    if (!usable) state.rundum.hfov = list[0].hfovGuess || r.hfov;
    setStatus(usable ? `Ausgerichtet: Übereinstimmung ${fmtNum(r.score ?? 0, 2)}, Sichtfeld ${fmtNum(r.hfov, 1)}°.`
      : `Ausgerichtet nur nach Sensor: Bildvergleich unbrauchbar (Übereinstimmung ${fmtNum(r.score ?? 0, 2)}).`);
    await saveNow();
    renderEditor();
    renderPhotos();
    schedulePreview(true);
    return true;
  } catch (err) {
    if (err.message !== 'abgebrochen') setStatus('Ausrichten fehlgeschlagen: ' + err.message);
    return false;
  } finally {
    btn.disabled = false;
    prog.hidden = true;
  }
}

// ---------------------------------------------------------------------------
// Rundumaufnahme (Kamera + Bewegungssensor)

let capture = null;
async function addShot(shot) {
  const n = shots().length + 1;
  const ph = {
    id: uid(), name: `Rundum ${String(n).padStart(2, '0')}`, blob: shot.blob, thumb: await makeThumb(shot.blob),
    role: 'shot', isShot: true, sensorR: shot.R, R: null, gain: null, hfovGuess: shot.hfovGuess,
    params: { ...DEFAULT_PARAMS }, order: state.photos.length, ready: false,
  };
  state.photos.push(ph);
  if (!state.rundum.hfov) state.rundum.hfov = shot.hfovGuess;
  state.rundum.aligned = false;
  await loadIntoWorker(ph);
  await store.putPhoto({
    id: ph.id, name: ph.name, blob: ph.blob, thumb: ph.thumb, role: ph.role, params: ph.params, order: ph.order,
    isShot: true, sensorR: ph.sensorR, R: null, gain: null, hfovGuess: ph.hfovGuess,
  });
  return ph;
}

async function startCapture() {
  if (shots().length) {
    if (!confirm('Vorhandene Rundumfotos dieses Fahrzeugs löschen und neu aufnehmen?')) return;
    for (const ph of shots()) { call('removeImage', { id: ph.id }).catch(() => {}); await store.deletePhoto(ph.id); }
    state.photos = state.photos.filter((p) => !p.isShot);
    state.rundum = DEFAULT_RUNDUM();
  }
  capture.open();
}

async function onCaptureClosed(count) {
  renderPhotos();
  await saveNow();
  if (count >= 2) {
    go('ausrichten');
    await alignRundum();
  } else if (count === 1) {
    setStatus('Nur ein Foto aufgenommen – für ein Rundumbild bitte alle Richtungen aufnehmen.');
  }
}

// Hinweisbox: Rolle des Fotos + Überdeckungswarnung (aus der letzten Vorschau)
const OVERLAP_WARN = 0.1;
function renderScore(ph) {
  const box = $('#layer-score');
  box.className = 'score';
  if (!ph) { box.textContent = ''; return; }
  if (ph.role === 'anchor') {
    box.textContent = 'Anker: Diese Pixel bleiben Original und liegen immer ganz vorne. Ausrichtung so wählen, dass die Mittelkonsole senkrecht steht und das Lenkrad links vor dir liegt.';
    return;
  }
  const ov = lastOverlaps.find((o) => o.id === ph.id);
  if (!ov) { box.textContent = 'Insel: Lage aus der Mitte nur ungefähr (anderer Aufnahmestandpunkt). Überdeckung wird nach der Vorschau geprüft.'; return; }
  if (ov.covered >= OVERLAP_WARN) {
    box.classList.add(ov.covered >= 0.3 ? 'bad' : 'mid');
    box.textContent = `Achtung: ${fmtPct(ov.covered)} dieser Insel liegen über dem Anker oder einer anderen Insel. Dort können Objekte doppelt erscheinen (z. B. zwei Kopfstützen). Gier drehen oder Rand beschneiden.`;
  } else {
    box.classList.add('good');
    box.textContent = `Keine nennenswerte Überdeckung (${fmtPct(ov.covered)}). Lage aus der Mitte ist trotzdem nur ungefähr.`;
  }
}

async function autoRoll() {
  const ph = selectedPhoto();
  if (!ph) return;
  const r = ph.rollEst;
  if (!r || r.confidence < 0.05) {
    setStatus('Keine eindeutigen senkrechten Kanten gefunden – Neigung bitte per Regler einstellen.');
    return;
  }
  ph.params = { ...ph.params, roll: r.roll };
  setStatus(`Neigung geschätzt: ${fmtNum(r.roll, 2)}° (Sicherheit ${fmtPct(r.confidence)}).`);
  renderEditor();
  schedulePreview(true);
  saveSoon();
}

function resetLayer() {
  const ph = selectedPhoto();
  if (!ph) return;
  const role = ph.role;
  ph.role = 'off';
  setRole(ph, role);
  renderEditor();
  schedulePreview(true);
  saveSoon();
}

// Vorschau: schnell (1024) beim Ziehen, scharf (2048) nach dem Loslassen
let previewTimer = null, previewBusy = false, previewAgain = null;
let lastOverlaps = [];
function schedulePreview(hi) {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => runPreview(hi ? 2048 : 1024), hi ? 120 : 60);
}
async function runPreview(W) {
  if (previewBusy) { previewAgain = Math.max(previewAgain || 0, W); return; }
  const layers = activeLayers();
  if (!layers.some((l) => l.kind === 'anchor' || l.kind === 'shot')) return;
  previewBusy = true;
  $('#preview-busy').hidden = false;
  try {
    const r = await call('preview', { layers, W });
    previewViewer.setImage(r.bitmap);
    previewViewer.setMask(r.mask);
    lastOverlaps = r.overlaps || [];
    renderScore(selectedPhoto());
    renderOverlapHint();
    r.bitmap.close && r.bitmap.close();
    r.mask.close && r.mask.close();
  } catch (err) {
    if (err.message !== 'abgebrochen') setStatus('Vorschau fehlgeschlagen: ' + err.message);
  }
  previewBusy = false;
  $('#preview-busy').hidden = true;
  if (previewAgain) { const w = previewAgain; previewAgain = null; runPreview(w); }
}

function renderOverlapHint() {
  const names = Object.fromEntries(state.photos.map((p) => [p.id, p.name]));
  const bad = lastOverlaps.filter((o) => o.kind === 'island' && o.covered >= OVERLAP_WARN);
  const box = $('#overlap-hint');
  box.hidden = !bad.length;
  box.textContent = bad.length
    ? 'Mögliche Doppelungen: ' + bad.map((o) => `„${names[o.id]}“ (${fmtPct(o.covered)} überdeckt)`).join(', ') + '. Unter „Ausrichten“ prüfen.'
    : '';
}

// ---------------------------------------------------------------------------
// Erstellen

let wakeLock = null;
async function build() {
  if (isRundum() && !state.rundum.aligned) {
    setStatus('Rundumfotos werden zuerst ausgerichtet …');
    go('ausrichten');
    const ok = await alignRundum();
    go('erstellen');
    if (!ok) return;
  }
  const layers = activeLayers();
  if (!layers.some((l) => l.kind === 'anchor' || l.kind === 'shot')) {
    setStatus('Bitte zuerst einen Anker wählen oder eine Rundumaufnahme machen (Schritt 1).');
    return go('fotos');
  }
  state.building = true;
  $('#btn-build').disabled = true;
  $('#progress').hidden = false;
  $('#report').hidden = true;
  setProgress({ label: 'Starte …', frac: 0 });
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch {}
  const W = state.res;
  try {
    const r = await call('build', {
      layers, W, quality: state.quality, title: state.title, viewerMax: Math.min(resultViewer.maxTex, 8192),
    }, setProgress);
    const jpegBlob = new Blob([r.jpeg], { type: 'image/jpeg' });
    const report = makeReport(r, layers);
    state.result = { jpegBlob, maskBlob: r.maskPng, report, title: state.title, W: r.W, H: r.H };
    resultViewer.setImage(r.display);
    resultViewer.setMask(r.maskBitmap);
    setProgress({ label: `Fertig in ${fmtTime(r.totalMs)}.`, frac: 1, done: true });
    showResult(state.result);
    await store.set('result', { jpegBlob, maskBlob: r.maskPng, report, title: state.title, W: r.W, H: r.H });
    setStatus('360°-Ansicht fertig.');
  } catch (err) {
    const msg = err.message === 'abgebrochen' ? 'Abgebrochen.' : 'Fehler: ' + err.message + (W > 4096 ? ' – Tipp: Auflösung 4096 × 2048 wählen.' : '');
    setProgress({ label: msg, frac: 0, done: true });
    setStatus(msg);
  } finally {
    state.building = false;
    $('#btn-build').disabled = false;
    $('#btn-cancel').hidden = true;
    try { await wakeLock?.release(); } catch {}
    wakeLock = null;
  }
}

function setProgress(p) {
  $('#btn-cancel').hidden = !!p.done;
  $('#prog-label').textContent = p.label || '';
  const f = p.done ? p.frac : Math.min(p.frac, 0.99);
  $('#prog-fill').style.width = (f * 100).toFixed(1) + '%';
  $('#prog-pct').textContent = p.done && p.frac >= 1 ? '100 %' : p.done ? '' : Math.floor(f * 100) + ' %';
  $('#prog-eta').textContent = p.done ? '' : p.etaMs != null ? 'noch ca. ' + fmtTime(p.etaMs) : 'Restzeit wird ermittelt …';
}

function cancelBuild() {
  if (!state.building) return;
  restartWorker();
}

function makeReport(r, layers) {
  const names = Object.fromEntries(state.photos.map((p) => [p.id, p.name]));
  const kinds = { anchor: 'Anker', island: 'Insel', shot: 'Rundumfoto' };
  const resLines = r.layerInfo.map((L) => {
    const f = L.srcPxPerDeg / L.panoPxPerDeg;
    const what = f >= 1
      ? `Foto ${fmtNum(L.srcPxPerDeg)} px/° ≥ Panorama ${fmtNum(L.panoPxPerDeg)} px/° → Originalauflösung (nicht hochskaliert)`
      : `Foto ${fmtNum(L.srcPxPerDeg)} px/° < Panorama ${fmtNum(L.panoPxPerDeg)} px/° → um Faktor ${fmtNum(1 / f, 2)} HOCHSKALIERT`;
    return `${kinds[L.kind]}: ${what}`;
  });
  return {
    W: r.W, H: r.H,
    coverage: r.stats,
    seam: r.seam,
    timings: r.timings, totalMs: r.totalMs,
    resLines: isRundum() ? summarizeShotRes(resLines) : resLines,
    rundum: isRundum() ? { ...state.rundum.align, count: layers.length } : null,
    photos: layers.map((l) => `${kinds[l.kind]}: ${names[l.id]}`),
    date: new Date().toISOString(),
  };
}

function summarizeShotRes(lines) {
  // alle Rundumfotos haben dieselbe Kamera – eine Zeile genügt
  return lines.length ? [lines[0].replace('Rundumfoto:', `Rundumfotos (${lines.length}):`)] : [];
}

function renderReport(rep) {
  const box = $('#report');
  if (!rep) { box.hidden = true; return; }
  const c = rep.coverage;
  box.replaceChildren(
    el('h3', {}, `Ergebnis ${rep.W} × ${rep.H}`),
    rep.rundum
      ? el('ul', {},
          el('li', {}, `Originalfotos aus der Mitte (${rep.rundum.count} Rundumfotos): ${fmtPct(c.anchor)} der Kugel`),
          el('li', {}, `Aufgefüllt (nicht fotografiert, unscharf): ${fmtPct(c.fill)}`),
          rep.rundum.score != null ? el('li', {}, `Ausrichtung: Übereinstimmung ${fmtNum(rep.rundum.score, 2)}, Kamera-Sichtfeld ${fmtNum(rep.rundum.hfov, 1)}°` + (rep.rundum.weak && rep.rundum.weak.length ? `, schwach: ${rep.rundum.weak.join(', ')}` : '')) : null)
      : el('ul', {},
          el('li', {}, `Original Anker (Cockpit): ${fmtPct(c.anchor)} der Kugel`),
          el('li', {}, `Original Inseln (ungefähre Lage): ${fmtPct(c.island)}`),
          el('li', {}, `Aufgefüllt (nicht fotografiert, unscharf): ${fmtPct(c.fill)}`)),
    el('div', {}, el('b', {}, 'Auflösung je Foto')),
    el('ul', {}, ...rep.resLines.map((t) => el('li', {}, t)),
      el('li', {}, 'Aufgefüllte Bereiche: aus 1024 × 512 berechnet und weich vergrößert (keine echte Auflösung).')),
    el('div', { class: rep.seam.ok ? 'ok' : 'warn' },
      rep.seam.ok ? '✓ 360°-Naht und Pole geprüft: nahtlos.' :
        `⚠ Nahtprüfung auffällig (Rand ${fmtNum(rep.seam.edgeDiff, 2)}, Pole ${fmtNum(rep.seam.topStd, 1)}/${fmtNum(rep.seam.bottomStd, 1)}).`),
    el('div', { class: 'hint' }, `Rechenzeit ${fmtTime(rep.totalMs)} (Auffüllen ${fmtTime(rep.timings.fill)}, Panorama ${fmtTime(rep.timings.render)}, JPEG ${fmtTime(rep.timings.jpeg)}).`),
  );
  box.hidden = false;
}

function showResult(res) {
  $('#no-result').hidden = !!res;
  $('#result-area').hidden = !res;
  renderReport(res && res.report);
  $('#img-2d').hidden = true;
}

// ---------------------------------------------------------------------------
// Export

const safeName = () => (state.result?.title || state.title || 'innenraum').replace(/[^\wäöüÄÖÜß\- ]+/g, '').trim().replace(/\s+/g, '_') || 'innenraum';

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

async function downloadHtml() {
  if (!state.result) return;
  setStatus('Viewer-Datei wird erstellt …');
  const src = await (await fetch('js/viewer.js')).text();
  const html = await buildViewerHtml({ jpegBlob: state.result.jpegBlob, maskBlob: state.result.maskBlob, title: state.result.title || state.title, viewerSource: src });
  download(new Blob([html], { type: 'text/html' }), `${safeName()}_360_viewer.html`);
  setStatus('Viewer-Datei gespeichert (öffnet offline im Browser).');
}

async function share() {
  if (!state.result) return;
  const file = new File([state.result.jpegBlob], `${safeName()}_360.jpg`, { type: 'image/jpeg' });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: state.result.title || '360°-Innenraum' });
    } else {
      download(file, file.name);
      setStatus('Teilen wird hier nicht unterstützt – Datei wurde gespeichert.');
    }
  } catch (err) {
    if (err.name !== 'AbortError') setStatus('Teilen fehlgeschlagen: ' + err.message);
  }
}

// ---------------------------------------------------------------------------
// Navigation & Start

function go(page) {
  document.querySelectorAll('.page').forEach((p) => { p.hidden = p.dataset.page !== page; });
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.go === page));
  if (page === 'ausrichten') {
    renderEditor();
    previewViewer.invalidate();
    if (!previewViewer.hasImage) schedulePreview(true);
    const s = selectedPhoto();
    if (isRundum()) previewViewer.lookAt(0, -5);
    else if (s) previewViewer.lookAt(s.params.yaw, s.params.pitch);
  }
  if (page === 'ansehen') resultViewer.invalidate();
  window.scrollTo(0, 0);
}

function setStatus(t) { $('#status').textContent = t; }

function toggleChip(btn, fn) {
  btn.addEventListener('click', async () => {
    const on = btn.getAttribute('aria-pressed') !== 'true';
    const ok = await fn(on);
    btn.setAttribute('aria-pressed', String(ok === false ? false : on));
  });
}

let previewViewer, resultViewer;

async function init() {
  try {
    previewViewer = new PanoViewer($('#cv-preview'), { pitch: -8, fov: 75 });
    resultViewer = new PanoViewer($('#cv-result'), { pitch: -5, fov: 80 });
  } catch (err) {
    setStatus('WebGL nicht verfügbar – 360°-Viewer kann nicht angezeigt werden. Export funktioniert trotzdem.');
    const dummy = { lookAt() {}, invalidate() {}, setImage() {}, setMask() {}, setMaskOpacity() {}, enableGyro: async () => false, maxTex: 4096 };
    previewViewer = previewViewer || { ...dummy };
    resultViewer = { ...dummy };
  }
  startWorker();

  document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => go(b.dataset.go)));
  $('#inp-files').addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });
  $('#inp-camera').addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });
  const drop = $('#drop');
  ['dragenter', 'dragover'].forEach((t) => document.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((t) => document.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  document.addEventListener('drop', (e) => addFiles(e.dataTransfer.files));
  $('#btn-new').addEventListener('click', newVehicle);
  capture = new SphereCapture($('#capture'), { onShot: addShot, onClose: onCaptureClosed, onStatus: setStatus });
  $('#btn-capture').addEventListener('click', startCapture);
  $('#btn-align-shots').addEventListener('click', alignRundum);
  $('#btn-reset-rundum').addEventListener('click', () => {
    const r = state.rundum;
    Object.assign(r, { yaw: 0, pitch: 0, roll: 0, blendPower: 48 });
    renderEditor(); schedulePreview(true); saveSoon();
  });

  $('#sel-layer').addEventListener('change', (e) => {
    state.selected = e.target.value;
    renderEditor();
    const s = selectedPhoto();
    if (s) previewViewer.lookAt(s.params.yaw, s.params.pitch);
  });
  $('#btn-auto-roll').addEventListener('click', autoRoll);
  $('#btn-reset-layer').addEventListener('click', resetLayer);
  toggleChip($('#pv-mask'), (on) => previewViewer.setMaskOpacity(on ? 0.45 : 0));
  $('#pv-look').addEventListener('click', () => { const s = selectedPhoto(); if (s) previewViewer.lookAt(s.params.yaw, s.params.pitch, 75); });

  $('#inp-title').addEventListener('input', (e) => { state.title = e.target.value; saveSoon(); });
  $('#sel-res').addEventListener('change', (e) => { state.res = Number(e.target.value); saveSoon(); });
  $('#inp-quality').addEventListener('input', (e) => { state.quality = Number(e.target.value); $('#q-val').textContent = e.target.value; saveSoon(); });
  $('#btn-build').addEventListener('click', build);
  $('#btn-cancel').addEventListener('click', cancelBuild);

  toggleChip($('#rv-rotate'), (on) => { resultViewer.autoRotate = on; });
  toggleChip($('#rv-mask'), (on) => { resultViewer.setMaskOpacity(on ? 0.45 : 0); $('#legend').hidden = !on; });
  toggleChip($('#rv-gyro'), async (on) => {
    const ok = await resultViewer.enableGyro(on);
    if (on && !ok) setStatus('Bewegungssensor nicht verfügbar oder nicht erlaubt.');
    return ok;
  });
  $('#rv-fs').addEventListener('click', () => {
    const host = $('#cv-result').parentElement;
    host.classList.add('fullscreen-host');
    if (!document.fullscreenElement) (host.requestFullscreen || host.webkitRequestFullscreen)?.call(host);
    else document.exitFullscreen();
  });
  document.addEventListener('fullscreenchange', () => resultViewer.invalidate());
  $('#btn-dl-jpg').addEventListener('click', () => state.result && download(state.result.jpegBlob, `${safeName()}_360.jpg`));
  $('#btn-dl-mask').addEventListener('click', () => state.result && download(state.result.maskBlob, `${safeName()}_herkunft.png`));
  $('#btn-dl-html').addEventListener('click', downloadHtml);
  $('#btn-share').addEventListener('click', share);
  $('#btn-show-2d').addEventListener('click', () => {
    const img = $('#img-2d');
    if (!img.hidden) { img.hidden = true; return; }
    if (img.dataset.url) URL.revokeObjectURL(img.dataset.url);
    img.dataset.url = URL.createObjectURL(state.result.jpegBlob);
    img.src = img.dataset.url;
    img.hidden = false;
  });

  // Wiederaufnahme
  setStatus('Lade gespeichertes Projekt …');
  const proj = (await store.get('project')) || {};
  state.title = proj.title || '';
  state.res = proj.res || 8192;
  state.quality = proj.quality || 96;
  state.rundum = { ...DEFAULT_RUNDUM(), ...(proj.rundum || {}) };
  $('#inp-title').value = state.title;
  $('#sel-res').value = String(state.res);
  $('#inp-quality').value = String(state.quality);
  $('#q-val').textContent = String(state.quality);
  const saved = (await store.allPhotos()).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  state.photos = saved.map((p) => ({ ...p, params: { ...DEFAULT_PARAMS, ...p.params }, ready: false }));
  state.selected = proj.selected || null;
  renderPhotos();
  await Promise.all(state.photos.map(loadIntoWorker));
  renderPhotos();
  const res = await store.get('result');
  if (res && res.jpegBlob) {
    state.result = res;
    try {
      const max = Math.min(resultViewer.maxTex || 4096, 8192);
      const bmp = await createImageBitmap(res.jpegBlob, res.W > max ? { resizeWidth: max, resizeHeight: max / 2, resizeQuality: 'high' } : {});
      resultViewer.setImage(bmp);
      if (res.maskBlob) resultViewer.setMask(await createImageBitmap(res.maskBlob));
    } catch {}
    showResult(res);
  }
  setStatus(state.photos.length ? `Projekt geladen (${state.photos.length} Fotos).` : 'Bereit. Bitte Fotos auswählen.');
  store.persist();
  if (state.photos.length) schedulePreview(true);

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  // Test-Schnittstelle (wird von tests/e2e.mjs benutzt)
  window.__auto360 = {
    state, call, go, previewViewer, resultViewer, alignRundum,
    addShots: async (list) => { for (const sh of list) await addShot(sh); await saveNow(); renderPhotos(); },
  };
}

init();
