// Komponententests ohne Browser:  node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  equirectToDir, dirToEquirect, rotationMatrix, transpose3, mul3, applyMat,
  projectToCamera, cameraPixelToDir, focalFromHfov,
} from '../app/js/math.js';
import {
  Pyramid, prepareLayer, sampleLayer, renderPanorama, computeFill, pullPushFill, seamCheck,
  sortLayers, footprintOverlaps, provenanceRGBA, PROV_ANCHOR, PROV_FILL, PROV_ISLAND, DEFAULT_PARAMS,
} from '../app/js/compose.js';
import { encodeJpeg, gpanoXmp } from '../app/js/jpeg.js';
import { estimateRoll, suggestAnchor } from '../app/js/estimate.js';

const close = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b}`);

/** Testbild mit Schachbrett + Farbverlauf (gut erkennbare Struktur). */
function testImage(w, h, seed = 0) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 4;
      const c = ((x >> 4) + (y >> 4) + seed) & 1;
      d[p] = c ? 220 : 30 + (x * 150) / w;
      d[p + 1] = c ? 200 : 40 + (y * 150) / h;
      d[p + 2] = (x * y + seed * 50) & 255;
      d[p + 3] = 255;
    }
  return { width: w, height: h, data: d };
}

test('Equirect ↔ Richtung ist umkehrbar und Bildmitte = vorne', () => {
  const W = 512, H = 256;
  for (const [u, v] of [[0, 0], [255.5, 127.5], [511, 255], [100, 30], [400, 200]]) {
    const d = equirectToDir(u, v, W, H);
    close(Math.hypot(...d), 1, 1e-12, 'Länge');
    const [u2, v2] = dirToEquirect(...d, W, H);
    close(u2, u, 1e-9, 'u');
    close(v2, v, 1e-9, 'v');
  }
  const c = equirectToDir(W / 2 - 0.5, H / 2 - 0.5, W, H);
  close(c[2], 1, 1e-4, 'Mitte zeigt nach +z (vorne)');
  const top = equirectToDir(10, 0, W, H);
  assert.ok(top[1] > 0.99, 'oberste Zeile = Zenit');
});

test('Drehmatrix ist orthonormal, Gier/Nick zeigen in erwartete Richtung', () => {
  const R = rotationMatrix(37, -12, 5);
  const I = mul3(R, transpose3(R));
  for (let i = 0; i < 9; i++) close(I[i], i % 4 === 0 ? 1 : 0, 1e-12, 'R·Rᵀ=I');
  const right = applyMat(rotationMatrix(90, 0, 0), [0, 0, 1]);
  close(right[0], 1, 1e-12, 'Gier +90° = rechts');
  const up = applyMat(rotationMatrix(0, 30, 0), [0, 0, 1]);
  close(up[1], Math.sin(Math.PI / 6), 1e-12, 'Nick + = oben');
});

test('Kamera-Projektion und Rückprojektion sind konsistent', () => {
  const R = rotationMatrix(-20, -8, 3);
  const f = focalFromHfov(2048, 68);
  for (const [x, y] of [[0, 0], [1024, 768], [2047, 1535], [300, 1200]]) {
    const d = cameraPixelToDir(x, y, R, f, 1023.5, 767.5);
    const p = projectToCamera(d, transpose3(R), f, 1023.5, 767.5);
    close(p[0], x, 1e-6, 'x');
    close(p[1], y, 1e-6, 'y');
  }
});

test('Anker-Pixel werden exakt aus dem Foto übernommen (nur Umrechnung, keine Neuzeichnung)', () => {
  const img = testImage(400, 300);
  const pyr = new Pyramid(img);
  const params = { ...DEFAULT_PARAMS, hfov: 60, yaw: 10, pitch: -5, roll: 2, feather: 0.05 };
  const W = 1024, H = 512;
  const A = prepareLayer(pyr, params, 'anchor', W);
  // Insel, die den Anker komplett überlappt – darf ihn NICHT verändern
  const I = prepareLayer(new Pyramid(testImage(400, 300, 1)), { ...params, hfov: 90 }, 'island', W);
  const layers = sortLayers([I, A]);
  assert.equal(layers[0].kind, 'anchor', 'Anker hat Vorrang');
  const fill = computeFill(layers, 256, 128);
  const out = renderPanorama(layers, fill, W, H, { provScale: 1 });
  let checked = 0;
  const s = [0, 0, 0];
  for (let v = 0; v < H; v += 3)
    for (let u = 0; u < W; u += 3) {
      const d = equirectToDir(u, v, W, H);
      const a = sampleLayer(A, d[0], d[1], d[2], s);
      if (a < 1) continue;
      const o = (v * W + u) * 4;
      for (let k = 0; k < 3; k++) close(out.data[o + k], Math.round(s[k]), 1, 'Anker-Pixel');
      assert.equal(out.prov[v * W + u], PROV_ANCHOR);
      checked++;
    }
  assert.ok(checked > 500, 'genug Anker-Pixel geprüft: ' + checked);
});

test('Pull-Push füllt alle Lücken und läuft am 360°-Rand um', () => {
  const W = 64, H = 32;
  const prem = new Float32Array(W * H * 3), alpha = new Float32Array(W * H);
  // roter Fleck am linken Rand (Spalten 0..2), blauer Fleck in der Mitte (Spalten 30..33)
  for (let y = 10; y < 20; y++) {
    for (let x = 0; x < 3; x++) { const i = y * W + x; alpha[i] = 1; prem[i * 3] = 200; }
    for (let x = 30; x < 34; x++) { const i = y * W + x; alpha[i] = 1; prem[i * 3 + 2] = 200; }
  }
  const f = pullPushFill(prem, alpha, W, H);
  for (let i = 0; i < W * H * 3; i++) assert.ok(Number.isFinite(f[i]), 'keine Lücke');
  // Stetigkeit über die 360°-Naht: Sprung zwischen letzter und erster Spalte darf nicht
  // größer sein als zwischen benachbarten Spalten (in unbekannten und bekannten Zeilen).
  for (const y of [2, 28]) { // komplett unbekannte Zeilen (in Zeile 15 grenzt bekanntes Rot gewollt hart an)
    let seam = 0, nb = 0;
    for (let k = 0; k < 3; k++) {
      seam += Math.abs(f[(y * W + W - 1) * 3 + k] - f[(y * W) * 3 + k]);
      nb = Math.max(nb, Math.abs(f[(y * W + 1) * 3 + k] - f[(y * W) * 3 + k]), Math.abs(f[(y * W + W - 2) * 3 + k] - f[(y * W + W - 1) * 3 + k]));
    }
    assert.ok(seam <= 3 * nb + 3, `Zeile ${y}: Naht ${seam.toFixed(1)} vs Nachbarn ${nb.toFixed(1)}`);
  }
});

test('Fertiges Panorama: nahtlos links/rechts und einheitliche Pole', () => {
  const W = 1024, H = 512;
  const A = prepareLayer(new Pyramid(testImage(400, 300)), { ...DEFAULT_PARAMS, hfov: 70, yaw: 175 }, 'anchor', W);
  const fill = computeFill([A], 256, 128);
  const out = renderPanorama([A], fill, W, H);
  const sc = seamCheck(out.data, W, H);
  assert.ok(sc.ok, 'Nahtprüfung: ' + JSON.stringify(sc));
  assert.ok(sc.topStd < 1 && sc.bottomStd < 1, 'Pole einheitlich');
  assert.ok(out.stats.anchor > 0.01 && out.stats.fill > 0.5);
});

test('Herkunftsmaske: Anker grün, Insel gelbgrün, Auffüllung rot', () => {
  const m = provenanceRGBA(new Uint8Array([PROV_FILL, PROV_ANCHOR, PROV_ISLAND]), 3, 1);
  assert.deepEqual([...m.slice(0, 3)], [220, 40, 40]);
  assert.deepEqual([...m.slice(4, 7)], [30, 190, 60]);
  assert.deepEqual([...m.slice(8, 11)], [170, 210, 40]);
});

test('Überdeckungsprüfung erkennt Inseln, die über dem Anker liegen', () => {
  const W = 360;
  const mk = (kind, yaw) => prepareLayer(new Pyramid(testImage(200, 150)), { ...DEFAULT_PARAMS, hfov: 60, yaw }, kind, W);
  const ov = footprintOverlaps(sortLayers([mk('island', 30), mk('anchor', 0), mk('island', 180)]), W);
  assert.equal(ov[0].covered, 0, 'Anker selbst');
  assert.ok(ov[1].covered > 0.4, 'Insel bei 30° überdeckt: ' + ov[1].covered);
  assert.equal(ov[2].covered, 0, 'Insel hinten frei');
});

test('JPEG-Encoder: gültige Struktur, 4:4:4, GPano-XMP', () => {
  const img = testImage(37, 21);
  const jpg = encodeJpeg(img, { quality: 96, xmp: gpanoXmp(37, 21) });
  assert.equal(jpg[0], 0xff); assert.equal(jpg[1], 0xd8);
  assert.equal(jpg[jpg.length - 2], 0xff); assert.equal(jpg[jpg.length - 1], 0xd9);
  // Marker durchlaufen bis SOS
  let p = 2, sof = null, xmp = '';
  while (p < jpg.length) {
    assert.equal(jpg[p], 0xff, 'Marker erwartet');
    const m = jpg[p + 1], len = (jpg[p + 2] << 8) | jpg[p + 3];
    if (m === 0xc0) sof = jpg.slice(p + 4, p + 2 + len);
    if (m === 0xe1) xmp = new TextDecoder().decode(jpg.slice(p + 4, p + 2 + len));
    if (m === 0xda) break;
    p += 2 + len;
  }
  assert.ok(sof, 'SOF0 vorhanden');
  assert.equal((sof[1] << 8) | sof[2], 21);
  assert.equal((sof[3] << 8) | sof[4], 37);
  assert.deepEqual([sof[7], sof[10], sof[13]], [0x11, 0x11, 0x11], '4:4:4');
  assert.match(xmp, /GPano:ProjectionType="equirectangular"/);
  assert.match(xmp, /GPano:FullPanoWidthPixels="37"/);
});

test('Roll-Schätzung erkennt gekippte senkrechte Kanten', () => {
  for (const roll of [-6, 0, 4]) {
    const w = 640, h = 480, d = new Uint8ClampedArray(w * h * 4);
    const t = Math.tan((roll * Math.PI) / 180);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        // senkrechte Streifen, oben nach rechts geneigt bei positivem Roll
        const xs = x + (y - h / 2) * t;
        const c = 125 + 105 * Math.sin((2 * Math.PI * xs) / 80); // weiche Kanten wie im Foto
        const p = (y * w + x) * 4;
        d[p] = d[p + 1] = d[p + 2] = c; d[p + 3] = 255;
      }
    const r = estimateRoll({ width: w, height: h, data: d });
    close(r.roll, roll, 0.75, 'Roll');
  }
});

test('Anker-Vorschlag bevorzugt dunkles Bild mit hellem, farbigem Bildschirm', () => {
  const mk = (screen) => {
    const w = 256, h = 192, d = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      const x = i % w, y = Math.floor(i / w);
      const inScreen = screen && x > 150 && x < 220 && y > 60 && y < 110;
      const v = inScreen ? [240, 200, 150] : screen ? [25, 25, 28] : [190, 190, 192];
      d.set([...v, 255], i * 4);
    }
    return { width: w, height: h, data: d };
  };
  assert.equal(suggestAnchor([mk(false), mk(true), mk(false)]).index, 1);
});

// ---------------------------------------------------------------------------
// Rundumaufnahme: Ausrichtung virtueller Aufnahmen einer bekannten Szene

import { alignShots, anchorToSensor, rotDiffDeg, axisRot } from '../app/js/align.js';
import { capturePlan, guessHfov } from '../app/js/capture-plan.js';
import { renderViewFromEquirect } from '../app/js/compose.js';

/** Prozedurale Innenraum-ähnliche Szene: Verläufe + viele Rechtecke/Linien (reproduzierbar). */
function proceduralScene(W, H, seed = 3) {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const d = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      d[o] = 60 + (y / H) * 120; d[o + 1] = 60 + (x / W) * 80; d[o + 2] = 90; d[o + 3] = 255;
    }
  for (let k = 0; k < 900; k++) {
    const w = 4 + rnd() * 60, h = 4 + rnd() * 40, x0 = rnd() * W, y0 = rnd() * H;
    const c = [rnd() * 255, rnd() * 255, rnd() * 255];
    for (let y = Math.floor(y0); y < Math.min(H, y0 + h); y++)
      for (let x = Math.floor(x0); x < x0 + w; x++) {
        const o = (y * W + (x % W)) * 4;
        d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2];
      }
  }
  return { width: W, height: H, data: d };
}

test('Rundumaufnahme: Feinausrichtung findet Lage und Sichtfeld trotz Sensorfehlern', () => {
  const scene = proceduralScene(1024, 512);
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const w = 240, h = 320, hfovTrue = guessHfov(w, h);
  const truth = [], sensor = [], pyrs = [];
  for (const t of capturePlan()) {
    const R = rotationMatrix(t.yaw + rnd() * 5, t.pitch + rnd() * 3, rnd() * 2);
    truth.push(R);
    pyrs.push(new Pyramid(renderViewFromEquirect(scene, R, hfovTrue, w, h, { gain: [1 + rnd() * 0.1, 1 + rnd() * 0.1, 1 + rnd() * 0.1] })));
    sensor.push(truth.length === 1 ? R : mul3(axisRot(1, rnd() * 3.5), mul3(axisRot(0, rnd() * 2), R)));
  }
  const err = (Rs) => {
    const e = anchorToSensor(Rs, truth).map((R, i) => rotDiffDeg(R, truth[i]));
    return { mean: e.reduce((a, b) => a + b) / e.length, max: Math.max(...e) };
  };
  const before = err(sensor);
  const r = alignShots(pyrs, sensor, hfovTrue * 1.08);
  const after = err(r.Rs);
  assert.ok(before.mean > 1.2, 'Testaufbau: Sensorfehler groß genug ' + before.mean);
  assert.ok(after.mean < 0.4, `Fehler nach Ausrichtung: mittel ${after.mean.toFixed(2)}° (vorher ${before.mean.toFixed(2)}°)`);
  assert.ok(after.max < 1.0, `Fehler nach Ausrichtung: max ${after.max.toFixed(2)}°`);
  close(r.hfov, hfovTrue, hfovTrue * 0.015, 'Sichtfeld');
  assert.ok(r.score > 0.9, 'Übereinstimmung ' + r.score);
  // Helligkeitsangleich: Gewinne liegen nahe dem Kehrwert der simulierten Belichtung (grob)
  for (const g of r.gains) for (const c of g) assert.ok(c > 0.8 && c < 1.25, 'Gain ' + c);
});

test('Rundumfotos werden gewichtet überblendet und decken die Kugel vollständig', () => {
  const scene = proceduralScene(512, 256, 5);
  const w = 200, h = 266, hf = guessHfov(w, h);
  const layers = capturePlan().map((t) => {
    const R = rotationMatrix(t.yaw, t.pitch, 0);
    return prepareLayer(new Pyramid(renderViewFromEquirect(scene, R, hf, w, h)), { ...DEFAULT_PARAMS, R, hfov: hf, feather: 0.02 }, 'shot', 512);
  });
  const out = renderPanorama(sortLayers(layers), computeFill(layers, 128, 64), 512, 256);
  assert.ok(out.stats.fill < 0.01, 'Auffüllung ' + out.stats.fill);
  let se = 0;
  for (let i = 0; i < 512 * 256 * 4; i += 4) for (let k = 0; k < 3; k++) se += (out.data[i + k] - scene.data[i + k]) ** 2;
  const psnr = 10 * Math.log10((255 * 255) / (se / (512 * 256 * 3)));
  assert.ok(psnr > 24, 'PSNR zur Szene ' + psnr.toFixed(1));
});
