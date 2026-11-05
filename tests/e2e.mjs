// Ende-zu-Ende-Test im echten Browser (Chromium, Android-Handy-Emulation) mit den Beispielfotos.
// Aufruf:  node tests/e2e.mjs [URL] [Ausgabeordner] [Auflösung]
// Voraussetzung: App läuft unter URL (z. B. python -m http.server 8765 im Ordner app/).

import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
// Playwright über require laden (nutzt auch global installierte Pakete via NODE_PATH)
const { chromium, devices } = createRequire(import.meta.url)('playwright');
const URL_ = process.argv[2] || 'http://127.0.0.1:8765/';
const OUT = process.argv[3] || path.join(here, 'out');
const RES = Number(process.argv[4] || 8192);
fs.mkdirSync(OUT, { recursive: true });
const photos = fs.readdirSync(path.join(here, '..', 'testdaten')).filter((f) => f.endsWith('.jpg')).sort()
  .map((f) => path.join(here, '..', 'testdaten', f));

const log = (...a) => console.log('[e2e]', ...a);
const fail = (m) => { console.error('[e2e] FEHLER:', m); process.exitCode = 1; };

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ ...devices['Pixel 7'], acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
const dialogs = [];
page.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss(); });
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(URL_);
await page.waitForFunction(() => window.__auto360);
// sauberer Start
await page.evaluate(() => new Promise((r) => { const q = indexedDB.deleteDatabase('auto360'); q.onsuccess = q.onerror = q.onblocked = () => r(); }));
await page.reload();
await page.waitForFunction(() => window.__auto360);

let t = Date.now();
await page.setInputFiles('#inp-files', photos);
await page.waitForFunction((n) => document.querySelector('#status').textContent.includes(`${n} Foto(s) bereit`), photos.length, { timeout: 120000 });
log('Fotos geladen in', Date.now() - t, 'ms');
await page.screenshot({ path: path.join(OUT, '01_fotos.png'), fullPage: true });

const roles = await page.evaluate(() => window.__auto360.state.photos.map((p) => [p.name, p.role, +p.score.toFixed(3)]));
log('Rollen/Punkte:', JSON.stringify(roles));
const anchorName = roles.find((r) => r[1] === 'anchor')?.[0];
if (anchorName !== '05_cockpit.jpg') fail('Anker-Vorschlag falsch: ' + anchorName); else log('Anker-Vorschlag korrekt: 05_cockpit.jpg');

// Fond links als Insel (Blick hinten), Beifahrertür als Insel (Blick rechts)
const card = (name) => page.locator('.photo', { hasText: name });
await card('03_fond_links').locator('select').first().selectOption('island');
await card('02_beifahrertuer').locator('select').first().selectOption('island');
await card('02_beifahrertuer').locator('select').nth(1).selectOption('rechts');

await page.click('nav.tabs button[data-go="ausrichten"]');
const pickLayer = async (txt) => {
  const v = await page.$eval('#sel-layer', (s, t) => [...s.options].find((o) => o.text.startsWith(t))?.value, txt);
  await page.selectOption('#sel-layer', v);
};
const previewIdle = () => page.waitForFunction(() => document.querySelector('#preview-busy').hidden, null, { timeout: 60000 });
// Neigung des Ankers automatisch schätzen
await pickLayer('Anker');
await page.click('#btn-auto-roll');
log('Neigung:', await page.textContent('#status'));
// Insel „Blick rechts“ absichtlich Richtung Anker drehen → Überdeckungswarnung muss erscheinen
await pickLayer('Insel (ungefähre Lage) – 02');
t = Date.now();
await page.$eval('#sliders input[aria-label^="Drehen"]', (r) => { r.value = '35'; r.dispatchEvent(new Event('change')); });
await page.waitForTimeout(300);
await previewIdle();
log(`Vorschau nach Regleränderung: ${Date.now() - t} ms`);
const warn = await page.textContent('#layer-score');
log('Hinweis bei Gier 35°:', warn);
if (!/Achtung/.test(warn)) fail('Überdeckungswarnung fehlt');
// zurück auf „rechts“ (90°)
await page.$eval('#sliders input[aria-label^="Drehen"]', (r) => { r.value = '90'; r.dispatchEvent(new Event('change')); });
await page.waitForTimeout(300);
await previewIdle();
log('Hinweis bei Gier 90°:', await page.textContent('#layer-score'));
await pickLayer('Anker');
await page.waitForTimeout(400);
await page.screenshot({ path: path.join(OUT, '02_ausrichten.png'), fullPage: true });

// Vorschau-Viewer darf nicht leer sein
const pvStats = await page.evaluate(() => {
  const c = document.querySelector('#cv-preview');
  const g = c.getContext('webgl', { preserveDrawingBuffer: true });
  const px = new Uint8Array(4 * 64);
  g.readPixels(Math.floor(c.width / 2) - 4, Math.floor(c.height / 2) - 4, 8, 8, g.RGBA, g.UNSIGNED_BYTE, px);
  let s = 0; for (let i = 0; i < px.length; i += 4) s += px[i] + px[i + 1] + px[i + 2];
  return { w: c.width, h: c.height, mean: s / 192 };
});
log('Vorschau-Canvas:', JSON.stringify(pvStats));
if (!(pvStats.mean > 2)) fail('Vorschau-Viewer ist schwarz/leer');

// Erstellen
await page.click('nav.tabs button[data-go="erstellen"]');
await page.fill('#inp-title', 'VW Golf 7 Variant');
await page.selectOption('#sel-res', String(RES));
const progressLog = [];
await page.exposeFunction('__prog', (s) => progressLog.push(s));
await page.evaluate(() => {
  const o = new MutationObserver(() => window.__prog(document.querySelector('#prog-label').textContent + ' | ' + document.querySelector('#prog-pct').textContent + ' | ' + document.querySelector('#prog-eta').textContent));
  o.observe(document.querySelector('#progress'), { subtree: true, childList: true, characterData: true });
});
t = Date.now();
await page.click('#btn-build');
await page.waitForFunction(() => !document.querySelector('#report').hidden || /Fehler/.test(document.querySelector('#prog-label').textContent), null, { timeout: 900000 });
const buildMs = Date.now() - t;
log(`Erstellen ${RES}: ${buildMs} ms`);
log('Rückfragen:', JSON.stringify(dialogs));
const uniq = [...new Set(progressLog)];
log('Fortschritt (Auszug):', JSON.stringify(uniq.filter((_, i) => i % Math.ceil(uniq.length / 10) === 0 || i === uniq.length - 1)));
const hundredEarly = uniq.slice(0, -1).some((s) => s.includes('| 100 %'));
if (hundredEarly) fail('„100 %“ wurde angezeigt, bevor die Berechnung fertig war'); else log('Fortschritt ehrlich: 100 % erst am Ende.');
const report = await page.evaluate(() => window.__auto360.state.result?.report);
if (!report) fail('Kein Ergebnis: ' + (await page.textContent('#prog-label')));
log('Bericht:', JSON.stringify(report));
await page.screenshot({ path: path.join(OUT, '03_erstellen.png'), fullPage: true });

// Ansehen
await page.click('nav.tabs button[data-go="ansehen"]');
await page.waitForTimeout(800);
await page.screenshot({ path: path.join(OUT, '04_ansehen.png'), fullPage: true });
await page.click('#rv-mask');
await page.waitForTimeout(400);
await page.screenshot({ path: path.join(OUT, '05_herkunft.png') });
await page.click('#rv-mask');

// Downloads
const dl = async (sel, name) => {
  const [d] = await Promise.all([page.waitForEvent('download'), page.click(sel)]);
  const p = path.join(OUT, name);
  await d.saveAs(p);
  log('Download', name, d.suggestedFilename(), fs.statSync(p).size, 'Bytes');
  return p;
};
await dl('#btn-dl-jpg', 'panorama.jpg');
await dl('#btn-dl-mask', 'herkunft.png');
const htmlPath = await dl('#btn-dl-html', 'viewer.html');

// Offline-Viewer-Datei öffnen (file://, ohne Server)
const vp = await ctx.newPage();
vp.on('pageerror', (e) => errors.push('viewer.html: ' + e));
await vp.goto('file://' + htmlPath);
await vp.waitForFunction(() => window.__viewer && window.__viewer.hasImage, null, { timeout: 60000 });
await vp.waitForTimeout(500);
await vp.screenshot({ path: path.join(OUT, '06_viewer_html.png') });
const vStats = await vp.evaluate(() => ({ tex: window.__viewer.textureSize, max: window.__viewer.maxTex }));
log('Offline-Viewer Textur:', JSON.stringify(vStats));

// Wiederaufnahme nach Neuladen
await page.reload();
await page.waitForFunction(() => /Projekt geladen/.test(document.querySelector('#status').textContent), null, { timeout: 120000 });
const restored = await page.evaluate(() => ({
  photos: window.__auto360.state.photos.length,
  roles: window.__auto360.state.photos.map((p) => p.role),
  result: !!window.__auto360.state.result,
}));
log('Nach Neuladen:', JSON.stringify(restored));
if (restored.photos !== photos.length || !restored.result) fail('Wiederaufnahme unvollständig');

if (errors.length) fail('Browser-Fehler:\n' + errors.join('\n')); else log('Keine Browser-Fehler.');
await browser.close();
