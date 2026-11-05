// Automatische Schätzungen ohne EXIF: welches Foto ist das Cockpit (Anker-Vorschlag)
// und wie stark ist es gekippt (Roll über annähernd senkrechte Kanten).
// Die Ergebnisse sind Vorschläge – die Feinjustierung erfolgt mit den Schiebereglern.

/** Verkleinert auf maxW Breite und liefert Graustufen + Sobel-Gradienten. */
export function gradients(img, maxW = 384) {
  const sc = Math.min(1, maxW / img.width);
  const w = Math.max(8, Math.round(img.width * sc)), h = Math.max(8, Math.round(img.height * sc));
  const gray = new Float32Array(w * h);
  const sat = new Float32Array(w * h);
  const lum = new Float32Array(w * h);
  const d = img.data, W = img.width, H = img.height;
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor((y * H) / h), y1 = Math.max(y0 + 1, Math.floor(((y + 1) * H) / h));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor((x * W) / w), x1 = Math.max(x0 + 1, Math.floor(((x + 1) * W) / w));
      let r = 0, g = 0, b = 0, n = 0;
      const sx = Math.max(1, (x1 - x0) >> 1), sy = Math.max(1, (y1 - y0) >> 1);
      for (let yy = y0; yy < y1; yy += sy)
        for (let xx = x0; xx < x1; xx += sx) {
          const p = (yy * W + xx) * 4;
          r += d[p]; g += d[p + 1]; b += d[p + 2]; n++;
        }
      r /= n; g /= n; b /= n;
      const i = y * w + x;
      gray[i] = 0.299 * r + 0.587 * g + 0.114 * b;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      sat[i] = mx > 0 ? (mx - mn) / mx : 0;
      lum[i] = mx;
    }
  }
  const gx = new Float32Array(w * h), gy = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const a = gray[i - w - 1], b = gray[i - w], c = gray[i - w + 1];
      const dd = gray[i - 1], f = gray[i + 1];
      const g = gray[i + w - 1], hh = gray[i + w], k = gray[i + w + 1];
      gx[i] = c + 2 * f + k - a - 2 * dd - g;
      gy[i] = g + 2 * hh + k - a - 2 * b - c;
    }
  return { w, h, gray, gx, gy, sat, lum };
}

/**
 * Schätzt den Roll-Winkel (Grad) aus annähernd senkrechten Kanten im mittleren Bildbereich.
 * Rückgabe = Wert für den Roll-Regler, damit Senkrechte im Panorama senkrecht stehen.
 */
export function estimateRoll(img, maxAbs = 12) {
  const G = gradients(img, 512);
  const bins = new Float64Array(2 * maxAbs * 4 + 1); // 0.25°-Schritte
  let total = 0;
  for (let y = Math.floor(G.h * 0.15); y < G.h * 0.85; y++)
    for (let x = Math.floor(G.w * 0.15); x < G.w * 0.85; x++) {
      const i = y * G.w + x;
      const gx = G.gx[i], gy = G.gy[i];
      const m = Math.hypot(gx, gy);
      if (m < 60 || Math.abs(gx) < 1e-6) continue;
      const deg = (Math.atan(gy / gx) * 180) / Math.PI; // senkrechte Kante → ~0°
      if (Math.abs(deg) > maxAbs) continue;
      bins[Math.round((deg + maxAbs) * 4)] += m;
      total += m;
    }
  if (total <= 0) return { roll: 0, confidence: 0 };
  // glätten und Maximum suchen
  const sm = new Float64Array(bins.length);
  for (let i = 0; i < bins.length; i++)
    for (let k = -4; k <= 4; k++) {
      const j = i + k;
      if (j >= 0 && j < bins.length) sm[i] += bins[j] * (5 - Math.abs(k));
    }
  let best = 0;
  for (let i = 1; i < sm.length; i++) if (sm[i] > sm[best]) best = i;
  const mean = sm.reduce((a, b) => a + b, 0) / sm.length;
  const roll = best / 4 - maxAbs;
  return { roll: Math.round(roll * 4) / 4, confidence: Math.min(1, (sm[best] / Math.max(1e-9, mean) - 1) / 4) };
}

/**
 * Punktzahl, wie sehr ein Foto nach „Cockpit-Gesamtansicht“ aussieht.
 * Gemessen an den Beispielfotos (VW Golf 7): Das Cockpit-Foto hat den größten Anteil
 * heller, farbiger Pixel (Navi-Bildschirm, ~3 % gegenüber <0,3 % bei Tür-/Fondfotos),
 * ist überwiegend dunkel (Armaturenbrett) und zeigt wenig hellgraue Studiowand/Dachhimmel.
 */
export function anchorScore(img) {
  const G = gradients(img, 256);
  const N = G.w * G.h;
  let screen = 0, dark = 0, wall = 0;
  for (let i = 0; i < N; i++) {
    if (G.lum[i] > 170 && G.sat[i] > 0.1) screen++;
    if (G.lum[i] < 70) dark++;
    if (G.lum[i] > 165 && G.sat[i] < 0.1) wall++;
  }
  return Math.min(screen / N, 0.06) * 30 + dark / N - wall / N;
}

/** Index des wahrscheinlichsten Cockpit-Fotos. */
export function suggestAnchor(images) {
  let best = -1, bestS = -Infinity;
  const scores = images.map((im) => anchorScore(im));
  scores.forEach((s, i) => { if (s > bestS) { bestS = s; best = i; } });
  return { index: best, scores };
}
