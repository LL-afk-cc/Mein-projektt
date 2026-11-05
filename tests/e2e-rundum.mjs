// Browser-Gesamttest der Rundumaufnahme (Chromium, Pixel-7-Emulation).
// Aufruf (Server im Projektordner, NICHT in app/, weil testdaten/ gebraucht wird):
//   python3 -m http.server 8766        →   node tests/e2e-rundum.mjs http://127.0.0.1:8766/app/ tests/out
//
// Teil A: Aufnahme-Oberfläche mit Chromium-Testkamera und simuliertem Bewegungssensor
//         (prüft Zielführung, Auto-Auslösen, gespeicherte Sensor-Richtungen, Verhalten bei unbrauchbaren Bildern).
// Teil B: virtuelle Aufnahmen einer Szene aus den Beispielfotos mit Sensorfehlern
//         (prüft Feinausrichtung, Erstellen, Export im Browser).

import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const { chromium, devices } = createRequire(import.meta.url)('playwright');
const URL_ = process.argv[2] || 'http://127.0.0.1:8766/app/';
const OUT = process.argv[3] || path.join(here, 'out');
fs.mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log('[rundum]', ...a);
const fail = (m) => { console.error('[rundum] FEHLER:', m); process.exitCode = 1; };

const browser = await chromium.launch({
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const ctx = await browser.newContext({ ...devices['Pixel 7'], permissions: ['camera', 'accelerometer', 'gyroscope', 'magnetometer'], acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('dialog', (d) => d.accept());

await page.goto(URL_);
await page.waitForFunction(() => window.__auto360);
await page.evaluate(() => new Promise((r) => { const q = indexedDB.deleteDatabase('auto360'); q.onsuccess = q.onerror = q.onblocked = () => r(); }));
await page.reload();
await page.waitForFunction(() => window.__auto360);

// ------------------------------------------------------------- Teil A
// Simulierter Bewegungssensor: 30 Hz, bewegt sich sanft zum jeweiligen Ziel
await page.evaluate(() => {
  window.__orient = { alpha: 0, beta: 90, gamma: 0 };
  window.__goal = { alpha: 0, beta: 90, gamma: 0 };
  setInterval(() => {
    const o = window.__orient, g = window.__goal;
    for (const k of ['alpha', 'beta', 'gamma']) {
      let d = g[k] - o[k];
      if (k === 'alpha') d = ((d + 540) % 360) - 180;
      o[k] += Math.sign(d) * Math.min(Math.abs(d), 6); // max 6° je Schritt (≈180°/s)
    }
    window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', { alpha: (o.alpha + 360) % 360, beta: o.beta, gamma: o.gamma, absolute: false }));
  }, 33);
});
await page.click('#btn-capture');
await page.waitForFunction(() => !document.querySelector('#capture').hidden);
await page.waitForFunction(() => document.querySelector('#capture video').videoWidth > 0, null, { timeout: 15000 });
const vid = await page.evaluate(() => [document.querySelector('#capture video').videoWidth, document.querySelector('#capture video').videoHeight]);
log('Testkamera:', vid.join('×'));
await page.waitForTimeout(400);
await page.screenshot({ path: path.join(OUT, 'r1_aufnahme_start.png') });
await page.click('#capture .cap-shutter'); // erstes Foto = „vorne“
await page.waitForFunction(() => document.querySelector('#capture .cap-count').textContent.startsWith('1 /'), null, { timeout: 10000 });

const plan = await page.evaluate(async () => (await import('./js/capture-plan.js')).capturePlan());
let t = Date.now();
for (const tg of plan.slice(1)) {
  // Gier → alpha (alpha wächst bei Linksdrehung), Nick → beta (90 = geradeaus)
  const beta = Math.max(1, Math.min(179, 90 + tg.pitch));
  await page.evaluate(([a, b]) => { window.__goal = { alpha: a, beta: b, gamma: 0 }; }, [(-tg.yaw + 360) % 360, beta]);
  const n0 = tg.index;
  try {
    await page.waitForFunction((n) => parseInt(document.querySelector('#capture .cap-count').textContent) > n, n0, { timeout: 8000 });
  } catch {
    fail(`Ziel ${tg.index} (Gier ${tg.yaw}°, Nick ${tg.pitch}°) wurde nicht automatisch ausgelöst`);
    break;
  }
  if (tg.index === 5) await page.screenshot({ path: path.join(OUT, 'r2_aufnahme_mitte.png') });
}
log(`Auto-Auslösen für ${plan.length - 1} Ziele: ${Date.now() - t} ms`);
const countText = await page.textContent('#capture .cap-count');
log('Zähler:', countText);
if (!countText.startsWith(`${plan.length} /`)) fail('Nicht alle Richtungen aufgenommen');

// gespeicherte Sensor-Richtungen gegen die simulierten Ziele prüfen
const dirs = await page.evaluate(() => window.__auto360.state.photos.filter((p) => p.isShot).map((p) => {
  const R = p.sensorR;
  return [Math.atan2(R[2], R[8]) * 180 / Math.PI, Math.asin(R[5]) * 180 / Math.PI];
}));
let maxDev = 0;
dirs.forEach(([yaw, pitch], k) => {
  const tg = plan[k];
  const dy = Math.abs(((yaw - tg.yaw + 540) % 360) - 180) * Math.cos(tg.pitch * Math.PI / 180);
  maxDev = Math.max(maxDev, Math.hypot(Math.abs(tg.pitch) > 80 ? 0 : dy, pitch - tg.pitch));
});
log(`Gespeicherte Richtungen: ${dirs.length} Fotos, max. Abweichung vom Ziel ${maxDev.toFixed(2)}°`);
if (maxDev > 3.6) fail('Gespeicherte Sensor-Richtung weicht zu stark vom Ziel ab');

// Fertig → automatische Ausrichtung startet. Die Testkamera zeigt in jeder Richtung dasselbe
// bewegte Testbild – Ausrichtung kann nicht gelingen; die App muss das ehrlich anzeigen, nicht abstürzen.
await page.click('#capture .cap-done');
t = Date.now();
await page.waitForFunction(() => document.querySelector('#align-progress').hidden === false, null, { timeout: 10000 }).catch(() => {});
await page.waitForFunction(() => document.querySelector('#align-progress').hidden && /Ausgerichtet|fehlgeschlagen/.test(document.querySelector('#status').textContent), null, { timeout: 300000 });
log(`Ausrichtung Testkamera-Bilder: ${Date.now() - t} ms → ${await page.textContent('#status')}`);
log('Zusammenfassung:', (await page.textContent('#align-summary')).slice(0, 220));
const fallback = await page.evaluate(() => {
  const sh = window.__auto360.state.photos.filter((p) => p.isShot);
  return { usable: window.__auto360.state.rundum.align.usable, same: sh.every((p) => p.R.every((v, i) => v === p.sensorR[i])) };
});
log('Absicherung bei unbrauchbaren Bildern:', JSON.stringify(fallback));
if (fallback.usable !== false || !fallback.same) fail('Bei unbrauchbarem Bildvergleich müssen die Sensorwerte erhalten bleiben');
await page.screenshot({ path: path.join(OUT, 'r3_testkamera_ausgerichtet.png'), fullPage: true });

// ------------------------------------------------------------- Teil B
// Szene aus den Beispielfotos (als Textur auf die Kugel gelegt), daraus 24 virtuelle Handyfotos
// mit Sensorfehlern (bis ~4°) und unterschiedlicher Belichtung.
await page.click('nav.tabs button[data-go="fotos"]');
await page.click('#btn-new'); // Bestätigung wird automatisch akzeptiert
await page.waitForFunction(() => window.__auto360.state.photos.length === 0);
const synth = await page.evaluate(async () => {
  const C = await import('./js/compose.js');
  const M = await import('./js/math.js');
  const A = await import('./js/align.js');
  const P = await import('./js/capture-plan.js');
  const names = ['01_fahrertuer', '02_beifahrertuer', '03_fond_links', '04_fond_rechts', '05_cockpit', '06_lenkrad'];
  const W = 2048, H = 1024;
  const cv = new OffscreenCanvas(W, H), g = cv.getContext('2d');
  g.fillStyle = '#777'; g.fillRect(0, 0, W, H);
  const imgs = await Promise.all(names.map(async (n) => createImageBitmap(await (await fetch(`../testdaten/${n}.jpg`)).blob())));
  // 2 Reihen à 6 Kacheln (jede Kachel ~60° breit), zweite Reihe gespiegelt, Pole mit Streifen
  for (let row = 0; row < 2; row++)
    for (let k = 0; k < 6; k++) {
      const im = imgs[(k + row * 3) % 6];
      g.save();
      if (row === 1) { g.translate((k + 1) * W / 6, 0); g.scale(-1, 1); g.drawImage(im, 0, H / 2, W / 6, H / 2); }
      else g.drawImage(im, k * W / 6, 0, W / 6, H / 2);
      g.restore();
    }
  const scene = { width: W, height: H, data: g.getImageData(0, 0, W, H).data };
  let seed = 5; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const w = 720, h = 960, hf = P.guessHfov(w, h);
  const shots = [], truth = [];
  for (const t of P.capturePlan()) {
    const R = M.rotationMatrix(t.yaw + rnd() * 5, t.pitch + rnd() * 3, rnd() * 2);
    truth.push(R);
    const img = C.renderViewFromEquirect(scene, R, hf, w, h, { gain: [1 + rnd() * 0.1, 1 + rnd() * 0.1, 1 + rnd() * 0.1] });
    const c = new OffscreenCanvas(w, h);
    c.getContext('2d').putImageData(new ImageData(img.data, w, h), 0, 0);
    const blob = await c.convertToBlob({ type: 'image/jpeg', quality: 0.92 });
    const sensor = truth.length === 1 ? R : M.mul3(A.axisRot(1, rnd() * 4), M.mul3(A.axisRot(0, rnd() * 2), M.mul3(A.axisRot(2, rnd() * 2), R)));
    shots.push({ blob, R: sensor, width: w, height: h, hfovGuess: hf * 1.08 });
  }
  window.__truth = truth;
  window.__hfTrue = hf;
  await window.__auto360.addShots(shots);
  return { n: shots.length, hf };
});
log(`Teil B: ${synth.n} virtuelle Aufnahmen, wahres Sichtfeld ${synth.hf.toFixed(2)}°, Start-Schätzung +8 %`);
await page.click('nav.tabs button[data-go="ausrichten"]');
t = Date.now();
await page.click('#btn-align-shots');
await page.waitForFunction(() => /Ausgerichtet|fehlgeschlagen/.test(document.querySelector('#status').textContent) && document.querySelector('#align-progress').hidden, null, { timeout: 600000 });
const alignMs = Date.now() - t;
const res = await page.evaluate(async () => {
  const A = await import('./js/align.js');
  const sh = window.__auto360.state.photos.filter((p) => p.isShot);
  const Rs = A.anchorToSensor(sh.map((p) => p.R), window.__truth);
  const e = Rs.map((R, i) => A.rotDiffDeg(R, window.__truth[i]));
  const s = A.anchorToSensor(sh.map((p) => p.sensorR), window.__truth).map((R, i) => A.rotDiffDeg(R, window.__truth[i]));
  return { mean: e.reduce((a, b) => a + b) / e.length, max: Math.max(...e), sMean: s.reduce((a, b) => a + b) / s.length, hfov: window.__auto360.state.rundum.hfov, align: window.__auto360.state.rundum.align };
});
log(`Ausrichtung im Browser: ${alignMs} ms; Fehler Sensor ${res.sMean.toFixed(2)}° → nachher mittel ${res.mean.toFixed(2)}° / max ${res.max.toFixed(2)}°; Sichtfeld ${res.hfov.toFixed(2)}° (wahr ${synth.hf.toFixed(2)}°); Übereinstimmung ${res.align.score.toFixed(3)}`);
if (res.mean > 0.5 || res.max > 1.2) fail('Ausrichtung zu ungenau');
if (Math.abs(res.hfov - synth.hf) > synth.hf * 0.02) fail('Sichtfeld falsch geschätzt');
await page.waitForTimeout(300);
await page.waitForFunction(() => document.querySelector('#preview-busy').hidden, null, { timeout: 60000 });
await page.screenshot({ path: path.join(OUT, 'r4_ausrichten.png'), fullPage: true });

// Erstellen 8192
await page.click('nav.tabs button[data-go="erstellen"]');
await page.fill('#inp-title', 'Rundum Test');
await page.selectOption('#sel-res', '8192');
t = Date.now();
await page.click('#btn-build');
await page.waitForFunction(() => !document.querySelector('#report').hidden || /Fehler/.test(document.querySelector('#prog-label').textContent), null, { timeout: 900000 });
const rep = await page.evaluate(() => window.__auto360.state.result?.report);
if (!rep) fail('Kein Ergebnis: ' + (await page.textContent('#prog-label')));
else log(`Erstellen 8192: ${Date.now() - t} ms; Original ${(rep.coverage.anchor * 100).toFixed(2)} %, aufgefüllt ${(rep.coverage.fill * 100).toFixed(2)} %, Naht ${JSON.stringify(rep.seam)}`);
await page.screenshot({ path: path.join(OUT, 'r5_bericht.png'), fullPage: true });
await page.click('nav.tabs button[data-go="ansehen"]');
await page.waitForTimeout(600);
await page.screenshot({ path: path.join(OUT, 'r6_ansehen.png') });
const [d] = await Promise.all([page.waitForEvent('download'), page.click('#btn-dl-jpg')]);
await d.saveAs(path.join(OUT, 'rundum_panorama.jpg'));
log('Download:', d.suggestedFilename(), fs.statSync(path.join(OUT, 'rundum_panorama.jpg')).size, 'Bytes');

if (errors.length) fail('Browser-Fehler:\n' + errors.join('\n')); else log('Keine Browser-Fehler.');
await browser.close();
