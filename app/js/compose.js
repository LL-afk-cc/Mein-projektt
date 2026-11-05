// Zusammensetzen des 360°-Panoramas aus Original-Fotos (reine Drehung, keine Neuzeichnung)
// plus nahtloser, unscharfer Auffüllung der nicht fotografierten Richtungen.
//
// Bilder: { width, height, data: Uint8ClampedArray (RGBA) }
// Ebenen-Parameter: { hfov, yaw, pitch, roll, cropL, cropR, cropT, cropB, feather, gain:[r,g,b] }
//   cropX: Anteil (0..0.45), der am jeweiligen Rand weggeschnitten wird
//   feather: Breite der weichen Randblende als Anteil der kürzeren Bildseite

import { rotationMatrix, transpose3, focalFromHfov, smoothstep, cameraPixelToDir } from './math.js';

export const PROV_FILL = 0;
export const PROV_ANCHOR = 1;
export const PROV_ISLAND = 2;

/** Ebenenart → Herkunftscode. */
export function provOf(kind) {
  return kind === 'anchor' || kind === 'shot' ? PROV_ANCHOR : PROV_ISLAND;
}

/**
 * Sortiert Ebenen nach Priorität: Rundumfotos (werden untereinander gewichtet überblendet),
 * dann Anker, dann Inseln in ihrer Reihenfolge.
 */
export function sortLayers(layers) {
  const rank = { shot: 0, anchor: 1, island: 2 };
  return layers.map((l, i) => [l, i]).sort((a, b) => rank[a[0].kind] - rank[b[0].kind] || a[1] - b[1]).map((x) => x[0]);
}

export const DEFAULT_PARAMS = Object.freeze({
  hfov: 65, yaw: 0, pitch: -8, roll: 0,
  cropL: 0, cropR: 0, cropT: 0, cropB: 0,
  feather: 0.06, gain: [1, 1, 1],
  blendPower: 48, // nur Rundumfotos: je höher, desto schmaler der Übergang zwischen zwei Fotos
});

/** Halbiert ein RGBA-Bild (2×2-Mittelwert). */
export function halveImage(img) {
  const w = Math.max(1, img.width >> 1), h = Math.max(1, img.height >> 1);
  const out = new Uint8ClampedArray(w * h * 4);
  const s = img.data, W = img.width, Hh = img.height;
  for (let y = 0; y < h; y++) {
    const y0 = Math.min(Hh - 1, 2 * y), y1 = Math.min(Hh - 1, 2 * y + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.min(W - 1, 2 * x), x1 = Math.min(W - 1, 2 * x + 1);
      const a = (y0 * W + x0) * 4, b = (y0 * W + x1) * 4, c = (y1 * W + x0) * 4, d = (y1 * W + x1) * 4;
      const o = (y * w + x) * 4;
      for (let k = 0; k < 4; k++) out[o + k] = (s[a + k] + s[b + k] + s[c + k] + s[d + k] + 2) >> 2;
    }
  }
  return { width: w, height: h, data: out };
}

/** Bild-Pyramide (Stufe 0 = Original), wird bei Bedarf erweitert. */
export class Pyramid {
  constructor(img) { this.levels = [img]; }
  get(level) {
    while (this.levels.length <= level) {
      const last = this.levels[this.levels.length - 1];
      if (last.width <= 8 || last.height <= 8) break;
      this.levels.push(halveImage(last));
    }
    return this.levels[Math.min(level, this.levels.length - 1)];
  }
}

/**
 * Bereitet eine Ebene für ein Panorama der Breite panoW vor.
 * Wählt die Pyramidenstufe so, dass beim Abtasten kein Aliasing entsteht.
 */
export function prepareLayer(pyramid, params, kind, panoW) {
  const p = { ...DEFAULT_PARAMS, ...params };
  const base = pyramid.get(0);
  const srcPxPerDeg = base.width / p.hfov;
  const panoPxPerDeg = panoW / 360;
  const ratio = srcPxPerDeg / panoPxPerDeg; // >1: Foto ist feiner als das Panorama
  const level = ratio > 1 ? Math.max(0, Math.floor(Math.log2(ratio))) : 0;
  const img = pyramid.get(level);
  const w = img.width, h = img.height;
  // Rundumfotos bringen ihre Drehmatrix (Sensor bzw. Feinausrichtung) direkt mit
  const R = p.R ? p.R : rotationMatrix(p.yaw, p.pitch, p.roll);
  const f = focalFromHfov(w, p.hfov);
  // Grobe Ausdehnung auf der Kugel (für schnelle Vorauswahl je Kachel)
  const halfDiag = Math.atan(Math.hypot(w / 2, h / 2) / f);
  const x0 = p.cropL * w, x1 = w - 1 - p.cropR * w;
  const y0 = p.cropT * h, y1 = h - 1 - p.cropB * h;
  const band = Math.max(1, p.feather * Math.min(w, h));
  return {
    kind, img, w, h, data: img.data,
    Rt: transpose3(R), f, cx: (w - 1) / 2, cy: (h - 1) / 2,
    x0, x1, y0, y1, band, gain: p.gain || [1, 1, 1], level,
    srcPxPerDeg, panoPxPerDeg,
    axis: [R[2], R[5], R[8]], radius: halfDiag, blendPower: p.blendPower,
  };
}

/**
 * Tastet eine Ebene in Weltrichtung (dx,dy,dz) ab. Schreibt RGB nach out[0..2] und den Kosinus
 * des Winkels zur Bildmitte nach out[3]; gibt die Deckkraft (Alpha) zurück.
 */
export function sampleLayer(L, dx, dy, dz, out) {
  const Rt = L.Rt;
  const cz = Rt[6] * dx + Rt[7] * dy + Rt[8] * dz;
  if (cz <= 1e-6) return 0;
  const cx = Rt[0] * dx + Rt[1] * dy + Rt[2] * dz;
  const cy = Rt[3] * dx + Rt[4] * dy + Rt[5] * dz;
  const x = L.cx + (L.f * cx) / cz;
  const y = L.cy - (L.f * cy) / cz;
  if (x < L.x0 || x > L.x1 || y < L.y0 || y > L.y1) return 0;
  const dmin = Math.min(x - L.x0, L.x1 - x, y - L.y0, L.y1 - y);
  const a = smoothstep(dmin / L.band);
  if (a <= 0) return 0;
  // bilinear
  const w = L.w, h = L.h, d = L.data;
  const xi = Math.min(w - 2, Math.max(0, Math.floor(x)));
  const yi = Math.min(h - 2, Math.max(0, Math.floor(y)));
  const fx = Math.min(1, Math.max(0, x - xi)), fy = Math.min(1, Math.max(0, y - yi));
  const p00 = (yi * w + xi) * 4, p01 = p00 + 4, p10 = p00 + w * 4, p11 = p10 + 4;
  const w00 = (1 - fx) * (1 - fy), w01 = fx * (1 - fy), w10 = (1 - fx) * fy, w11 = fx * fy;
  const g = L.gain;
  out[3] = cz; // Kosinus des Winkels zur Bildmitte (für Überblend-Gewichte)
  out[0] = (d[p00] * w00 + d[p01] * w01 + d[p10] * w10 + d[p11] * w11) * g[0];
  out[1] = (d[p00 + 1] * w00 + d[p01 + 1] * w01 + d[p10 + 1] * w10 + d[p11 + 1] * w11) * g[1];
  out[2] = (d[p00 + 2] * w00 + d[p01 + 2] * w01 + d[p10 + 2] * w10 + d[p11 + 2] * w11) * g[2];
  return a;
}

/** Vorberechnete Sinus/Kosinus-Tabellen für Länge (Spalten) und Breite (Zeilen). */
export function trigTables(W, H) {
  const sinLon = new Float64Array(W), cosLon = new Float64Array(W);
  const sinLat = new Float64Array(H), cosLat = new Float64Array(H);
  for (let u = 0; u < W; u++) {
    const lon = ((u + 0.5) / W) * 2 * Math.PI - Math.PI;
    sinLon[u] = Math.sin(lon);
    cosLon[u] = Math.cos(lon);
  }
  for (let v = 0; v < H; v++) {
    const lat = Math.PI / 2 - ((v + 0.5) / H) * Math.PI;
    sinLat[v] = Math.sin(lat);
    cosLat[v] = Math.cos(lat);
  }
  return { sinLon, cosLon, sinLat, cosLat };
}

// ---------------------------------------------------------------------------
// Pixel-Schattierung und Kachel-Vorauswahl

const TILE = 32;

/** Winkelradius einer Equirect-Kachel um ihre Mitte (aus Ecken und Kantenmitten). */
function tileCandidates(layers, T, W, H, u0, v0, u1, v1) {
  const cu = Math.min(W - 1, (u0 + u1) >> 1), cv = Math.min(H - 1, (v0 + v1) >> 1);
  const cd = [T.cosLat[cv] * T.sinLon[cu], T.sinLat[cv], T.cosLat[cv] * T.cosLon[cu]];
  let maxAng = 0;
  for (const [u, v] of [[u0, v0], [u1 - 1, v0], [u0, v1 - 1], [u1 - 1, v1 - 1], [cu, v0], [cu, v1 - 1], [u0, cv], [u1 - 1, cv]]) {
    const d = [T.cosLat[v] * T.sinLon[u], T.sinLat[v], T.cosLat[v] * T.cosLon[u]];
    const dot = Math.max(-1, Math.min(1, d[0] * cd[0] + d[1] * cd[1] + d[2] * cd[2]));
    maxAng = Math.max(maxAng, Math.acos(dot));
  }
  // Polkacheln überstreichen alle Längen – dann ist die Kachel „rund um den Pol“
  if (v0 === 0 || v1 >= H) maxAng = Math.max(maxAng, Math.PI / 2 - Math.abs(Math.asin(T.sinLat[v0 === 0 ? v1 - 1 : v0])) + 0.02);
  const out = [];
  for (const L of layers) {
    const dot = Math.max(-1, Math.min(1, L.axis[0] * cd[0] + L.axis[1] * cd[1] + L.axis[2] * cd[2]));
    if (Math.acos(dot) <= L.radius + maxAng + 0.01) out.push(L);
  }
  return out;
}

/**
 * Farbe einer Richtung aus den Ebenen-Kandidaten (Prioritätsreihenfolge).
 * Rundumfotos ('shot') werden gewichtet überblendet (Gewicht = Alpha · cos(Winkel zur Bildmitte)^p),
 * danach folgen Anker und Inseln als „darüberliegend“ (vorne zuerst).
 * res = [r, g, b, deckkraft, herkunft]
 */
function shade(cands, dx, dy, dz, s, res) {
  let acc = 0, r = 0, g = 0, b = 0, best = PROV_FILL, bestW = 0;
  let k = 0;
  // Gruppe der Rundumfotos
  let ws = 0, sr = 0, sg = 0, sb = 0, amax = 0;
  for (; k < cands.length && cands[k].kind === 'shot'; k++) {
    const L = cands[k];
    const a = sampleLayer(L, dx, dy, dz, s);
    if (a <= 0) continue;
    const w = a * Math.pow(Math.max(1e-4, s[3]), L.blendPower) + 1e-12;
    ws += w; sr += w * s[0]; sg += w * s[1]; sb += w * s[2];
    if (a > amax) amax = a;
  }
  if (amax > 0) {
    r = amax * (sr / ws); g = amax * (sg / ws); b = amax * (sb / ws);
    acc = amax; bestW = amax; best = PROV_ANCHOR;
  }
  for (; k < cands.length && acc < 0.9999; k++) {
    const L = cands[k];
    const a = sampleLayer(L, dx, dy, dz, s);
    if (a <= 0) continue;
    const wgt = (1 - acc) * a;
    r += wgt * s[0]; g += wgt * s[1]; b += wgt * s[2];
    acc += wgt;
    if (wgt > bestW) { bestW = wgt; best = provOf(L.kind); }
  }
  res[0] = r; res[1] = g; res[2] = b; res[3] = acc; res[4] = best;
}

/** Läuft kachelweise über ein W×H-Equirect und ruft fn(u, v, cands, dx, dy, dz) auf. */
function forEachTile(layers, W, H, T, fn, onTileRow) {
  for (let v0 = 0; v0 < H; v0 += TILE) {
    const v1 = Math.min(H, v0 + TILE);
    for (let u0 = 0; u0 < W; u0 += TILE) {
      const u1 = Math.min(W, u0 + TILE);
      const cands = tileCandidates(layers, T, W, H, u0, v0, u1, v1);
      for (let v = v0; v < v1; v++) {
        const cl = T.cosLat[v], dy = T.sinLat[v];
        for (let u = u0; u < u1; u++) fn(u, v, cands, cl * T.sinLon[u], dy, cl * T.cosLon[u]);
      }
    }
    if (onTileRow) onTileRow(v1 / H);
  }
}

/**
 * Bekannte (fotografierte) Farbe pro Pixel, vormultipliziert, plus Deckkraft.
 * Für die Auffüll-Berechnung in niedriger Auflösung.
 */
export function renderKnown(layers, W, H) {
  const prem = new Float32Array(W * H * 3);
  const alpha = new Float32Array(W * H);
  const T = trigTables(W, H);
  const s = [0, 0, 0, 0], res = [0, 0, 0, 0, 0];
  forEachTile(layers, W, H, T, (u, v, cands, dx, dy, dz) => {
    if (!cands.length) return;
    shade(cands, dx, dy, dz, s, res);
    const i = v * W + u;
    prem[i * 3] = res[0]; prem[i * 3 + 1] = res[1]; prem[i * 3 + 2] = res[2];
    alpha[i] = res[3];
  });
  return { prem, alpha, W, H };
}

/**
 * Pull-Push-Auffüllung (Gortler et al.): füllt Lücken mit den Farben der umgebenden
 * fotografierten Bereiche, horizontal umlaufend (360°-nahtlos).
 * @returns Float32Array (W*H*3) vollständig gefüllte Farben
 */
export function pullPushFill(prem, alpha, W, H) {
  // Stufe 0: normierte Farbe + Gewicht
  const levels = [];
  let col = new Float32Array(W * H * 3), wt = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const a = alpha[i];
    wt[i] = Math.min(1, a);
    if (a > 1e-6) {
      col[i * 3] = prem[i * 3] / a;
      col[i * 3 + 1] = prem[i * 3 + 1] / a;
      col[i * 3 + 2] = prem[i * 3 + 2] / a;
    }
  }
  levels.push({ W, H, col, wt });
  // Pull (nach unten)
  while (levels[levels.length - 1].W > 2 || levels[levels.length - 1].H > 1) {
    const L = levels[levels.length - 1];
    const nW = Math.max(1, Math.ceil(L.W / 2)), nH = Math.max(1, Math.ceil(L.H / 2));
    const nc = new Float32Array(nW * nH * 3), nw = new Float32Array(nW * nH);
    for (let y = 0; y < nH; y++) {
      for (let x = 0; x < nW; x++) {
        let sw = 0, sr = 0, sg = 0, sb = 0;
        for (let dy = 0; dy < 2; dy++) {
          const yy = Math.min(L.H - 1, 2 * y + dy);
          for (let dx = 0; dx < 2; dx++) {
            const xx = (2 * x + dx) % L.W;
            const j = yy * L.W + xx;
            const ww = L.wt[j];
            sw += ww; sr += ww * L.col[j * 3]; sg += ww * L.col[j * 3 + 1]; sb += ww * L.col[j * 3 + 2];
          }
        }
        const o = y * nW + x;
        if (sw > 1e-6) {
          nc[o * 3] = sr / sw; nc[o * 3 + 1] = sg / sw; nc[o * 3 + 2] = sb / sw;
        }
        nw[o] = Math.min(1, sw);
      }
    }
    levels.push({ W: nW, H: nH, col: nc, wt: nw });
    if (nW <= 2 && nH <= 1) break;
  }
  // Oberste Stufe: Leerstellen mit Gesamtmittel (oder neutralem Grau) füllen
  const top = levels[levels.length - 1];
  {
    let sw = 0, sr = 0, sg = 0, sb = 0;
    for (let i = 0; i < top.W * top.H; i++) {
      sw += top.wt[i]; sr += top.wt[i] * top.col[i * 3]; sg += top.wt[i] * top.col[i * 3 + 1]; sb += top.wt[i] * top.col[i * 3 + 2];
    }
    const m = sw > 1e-6 ? [sr / sw, sg / sw, sb / sw] : [128, 128, 128];
    for (let i = 0; i < top.W * top.H; i++) {
      const w = top.wt[i];
      for (let k = 0; k < 3; k++) top.col[i * 3 + k] = top.col[i * 3 + k] * w + m[k] * (1 - w);
      top.wt[i] = 1;
    }
  }
  // Push (nach oben): Lücken mit bilinear vergrößerter gröberer Stufe füllen
  for (let l = levels.length - 2; l >= 0; l--) {
    const F = levels[l], C = levels[l + 1];
    const sx = C.W / F.W, sy = C.H / F.H;
    for (let y = 0; y < F.H; y++) {
      const cy = Math.max(0, Math.min(C.H - 1, (y + 0.5) * sy - 0.5));
      const y0 = Math.floor(cy), y1 = Math.min(C.H - 1, y0 + 1), fy = cy - y0;
      for (let x = 0; x < F.W; x++) {
        const i = y * F.W + x;
        const w = F.wt[i];
        if (w >= 0.999) continue;
        let cx = (x + 0.5) * sx - 0.5;
        cx = ((cx % C.W) + C.W) % C.W;
        const x0 = Math.floor(cx), x1 = (x0 + 1) % C.W, fx = cx - x0;
        for (let k = 0; k < 3; k++) {
          const c =
            (C.col[(y0 * C.W + x0) * 3 + k] * (1 - fx) + C.col[(y0 * C.W + x1) * 3 + k] * fx) * (1 - fy) +
            (C.col[(y1 * C.W + x0) * 3 + k] * (1 - fx) + C.col[(y1 * C.W + x1) * 3 + k] * fx) * fy;
          F.col[i * 3 + k] = F.col[i * 3 + k] * w + c * (1 - w);
        }
        F.wt[i] = 1;
      }
    }
  }
  return levels[0].col;
}

/**
 * Glättet die Auffüllung: horizontale Box-Unschärfe, deren Radius zu den Polen hin wächst
 * (dort laufen alle Spalten in einem Punkt zusammen), plus vertikale Unschärfe.
 * Ergebnis ist am linken/rechten Rand und an den Polen nahtlos.
 */
export function sphericalBlur(rgb, W, H, baseR = 3, passes = 2) {
  let src = rgb, dst = new Float32Array(rgb.length);
  const pre = new Float64Array((W + 1) * 3);
  for (let p = 0; p < passes; p++) {
    // vertikal (an den Polen begrenzt)
    const r = baseR;
    for (let x = 0; x < W; x++) {
      for (let y = 0; y < H; y++) {
        let s0 = 0, s1 = 0, s2 = 0, n = 0;
        for (let yy = Math.max(0, y - r); yy <= Math.min(H - 1, y + r); yy++) {
          const i = (yy * W + x) * 3;
          s0 += src[i]; s1 += src[i + 1]; s2 += src[i + 2]; n++;
        }
        const o = (y * W + x) * 3;
        dst[o] = s0 / n; dst[o + 1] = s1 / n; dst[o + 2] = s2 / n;
      }
    }
    [src, dst] = [dst, src];
    // horizontal, umlaufend
    for (let y = 0; y < H; y++) {
      const lat = Math.PI / 2 - ((y + 0.5) / H) * Math.PI;
      const r = Math.min(Math.floor(W / 2), Math.round(baseR / Math.max(1e-3, Math.cos(lat))));
      pre[0] = pre[1] = pre[2] = 0;
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 3;
        pre[(x + 1) * 3] = pre[x * 3] + src[i];
        pre[(x + 1) * 3 + 1] = pre[x * 3 + 1] + src[i + 1];
        pre[(x + 1) * 3 + 2] = pre[x * 3 + 2] + src[i + 2];
      }
      const total = [pre[W * 3], pre[W * 3 + 1], pre[W * 3 + 2]];
      const n = 2 * r + 1;
      for (let x = 0; x < W; x++) {
        const o = (y * W + x) * 3;
        if (n >= W) {
          for (let k = 0; k < 3; k++) dst[o + k] = total[k] / W;
          continue;
        }
        const a = x - r, b = x + r + 1; // [a, b)
        for (let k = 0; k < 3; k++) {
          let s;
          if (a < 0) s = pre[b * 3 + k] + (total[k] - pre[(W + a) * 3 + k]);
          else if (b > W) s = (total[k] - pre[a * 3 + k]) + pre[(b - W) * 3 + k];
          else s = pre[b * 3 + k] - pre[a * 3 + k];
          dst[o + k] = s / n;
        }
      }
    }
    [src, dst] = [dst, src];
  }
  return src;
}

/** Berechnet die Auffüllung in niedriger Auflösung (fW×fH). */
export function computeFill(layers, fW = 1024, fH = 512) {
  const k = renderKnown(layers, fW, fH);
  const filled = pullPushFill(k.prem, k.alpha, fW, fH);
  const smooth = sphericalBlur(filled, fW, fH, Math.max(2, Math.round(fW / 256)), 2);
  return { rgb: smooth, W: fW, H: fH };
}

function sampleFill(fill, u, v, W, H, out) {
  // Panorama-Pixel (u,v) → Auffüll-Koordinaten, bilinear, horizontal umlaufend
  const fW = fill.W, fH = fill.H;
  let x = ((u + 0.5) / W) * fW - 0.5;
  let y = ((v + 0.5) / H) * fH - 0.5;
  x = ((x % fW) + fW) % fW;
  y = Math.max(0, Math.min(fH - 1, y));
  const x0 = Math.floor(x), x1 = (x0 + 1) % fW, fx = x - x0;
  const y0 = Math.floor(y), y1 = Math.min(fH - 1, y0 + 1), fy = y - y0;
  const c = fill.rgb;
  for (let k = 0; k < 3; k++) {
    out[k] =
      (c[(y0 * fW + x0) * 3 + k] * (1 - fx) + c[(y0 * fW + x1) * 3 + k] * fx) * (1 - fy) +
      (c[(y1 * fW + x0) * 3 + k] * (1 - fx) + c[(y1 * fW + x1) * 3 + k] * fx) * fy;
  }
}

/**
 * Rendert das fertige Panorama (W×H, RGBA) zeilenweise. Ebenen in Prioritätsreihenfolge
 * (siehe sortLayers). Wo eine Ebene voll deckend ist, werden dahinterliegende Ebenen und die
 * Auffüllung nicht mehr abgetastet – Original-Pixel werden also nie mit Auffüllung vermischt.
 * Der Anker liegt immer ganz vorne: Inseln können ihn nicht überdecken.
 * @returns {{data:Uint8ClampedArray, prov:Uint8Array, provW:number, provH:number, stats}}
 */
export function renderPanorama(layers, fill, W, H, opts = {}) {
  const data = opts.out || new Uint8ClampedArray(W * H * 4);
  const pScale = opts.provScale || Math.max(1, Math.floor(W / 2048));
  const provW = Math.floor(W / pScale), provH = Math.floor(H / pScale);
  const prov = new Uint8Array(provW * provH);
  const T = trigTables(W, H);
  const s = [0, 0, 0, 0], fc = [0, 0, 0], res = [0, 0, 0, 0, 0];
  const counts = [0, 0, 0];
  const t0 = Date.now();
  forEachTile(layers, W, H, T, (u, v, cands, dx, dy, dz) => {
    let r = 0, g = 0, b = 0, acc = 0, best = PROV_FILL;
    if (cands.length) {
      shade(cands, dx, dy, dz, s, res);
      r = res[0]; g = res[1]; b = res[2]; acc = res[3]; best = res[4];
    }
    if (acc < 0.9999) {
      sampleFill(fill, u, v, W, H, fc);
      const rest = 1 - acc;
      r += rest * fc[0]; g += rest * fc[1]; b += rest * fc[2];
    }
    if (acc < 0.5) best = PROV_FILL;
    const o = (v * W + u) * 4;
    data[o] = r; data[o + 1] = g; data[o + 2] = b; data[o + 3] = 255;
    counts[best]++;
    if (v % pScale === 0 && u % pScale === 0) {
      const pu = u / pScale, pv = v / pScale;
      if (pu < provW && pv < provH) prov[pv * provW + pu] = best;
    }
  }, (f) => opts.onProgress && opts.onProgress(f, Date.now() - t0));
  const total = W * H;
  return {
    data, prov, provW, provH,
    stats: {
      anchor: counts[PROV_ANCHOR] / total,
      island: counts[PROV_ISLAND] / total,
      fill: counts[PROV_FILL] / total,
    },
  };
}

/**
 * Perspektivische Ansicht (Lochkamera) aus einem Equirect – z. B. für virtuelle Testaufnahmen.
 * @param pano {width,height,data} Equirect-RGBA
 */
export function renderViewFromEquirect(pano, R, hfov, w, h, opts = {}) {
  const out = new Uint8ClampedArray(w * h * 4);
  const f = focalFromHfov(w, hfov);
  const cx = (w - 1) / 2, cy = (h - 1) / 2;
  const PW = pano.width, PH = pano.height, P = pano.data;
  const gain = opts.gain || [1, 1, 1];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const d = cameraPixelToDir(x, y, R, f, cx, cy);
      let u = ((Math.atan2(d[0], d[2]) + Math.PI) / (2 * Math.PI)) * PW - 0.5;
      let v = ((Math.PI / 2 - Math.asin(Math.max(-1, Math.min(1, d[1])))) / Math.PI) * PH - 0.5;
      u = ((u % PW) + PW) % PW;
      v = Math.max(0, Math.min(PH - 1.001, v));
      const u0 = Math.floor(u), u1 = (u0 + 1) % PW, fu = u - u0;
      const v0 = Math.floor(v), v1 = Math.min(PH - 1, v0 + 1), fv = v - v0;
      const o = (y * w + x) * 4;
      for (let k = 0; k < 3; k++) {
        const c = (P[(v0 * PW + u0) * 4 + k] * (1 - fu) + P[(v0 * PW + u1) * 4 + k] * fu) * (1 - fv) +
          (P[(v1 * PW + u0) * 4 + k] * (1 - fu) + P[(v1 * PW + u1) * 4 + k] * fu) * fv;
        out[o + k] = c * gain[k];
      }
      out[o + 3] = 255;
    }
  }
  return { width: w, height: h, data: out };
}

/** Herkunftsmaske als RGBA: Anker grün, Inseln gelbgrün, Auffüllung rot. */
export function provenanceRGBA(prov, w, h) {
  const out = new Uint8ClampedArray(w * h * 4);
  const pal = { [PROV_FILL]: [220, 40, 40], [PROV_ANCHOR]: [30, 190, 60], [PROV_ISLAND]: [170, 210, 40] };
  for (let i = 0; i < w * h; i++) {
    const c = pal[prov[i]];
    out[i * 4] = c[0]; out[i * 4 + 1] = c[1]; out[i * 4 + 2] = c[2]; out[i * 4 + 3] = 255;
  }
  return out;
}

/**
 * Nahtlosigkeits-Prüfung: vergleicht linke/rechte Randspalte mit typischen Nachbarspalten
 * und prüft, ob die oberste/unterste Zeile einheitlich ist (Pole).
 */
export function seamCheck(rgba, W, H) {
  const px = (x, y, k) => rgba[(y * W + x) * 4 + k];
  // Naht = Unterschied zwischen letzter und erster Spalte; Vergleich = Unterschied zwischen
  // den direkt benachbarten Spaltenpaaren links/rechts der Naht (gleicher Bildinhalt).
  let edge = 0, inner = 0, n = 0;
  for (let y = 0; y < H; y++) {
    for (let k = 0; k < 3; k++) {
      edge += Math.abs(px(0, y, k) - px(W - 1, y, k));
      inner += (Math.abs(px(0, y, k) - px(1, y, k)) + Math.abs(px(W - 2, y, k) - px(W - 1, y, k))) / 2;
    }
    n += 3;
  }
  edge /= n; inner /= n;
  const rowStd = (y) => {
    let s = 0, s2 = 0;
    for (let x = 0; x < W; x++) {
      const l = (px(x, y, 0) + px(x, y, 1) + px(x, y, 2)) / 3;
      s += l; s2 += l * l;
    }
    const m = s / W;
    return Math.sqrt(Math.max(0, s2 / W - m * m));
  };
  const topStd = rowStd(0), bottomStd = rowStd(H - 1);
  // Pol: Aufgefüllt muss er einheitlich sein (< 4). Liegt dort echter Bildinhalt (Rundumfoto vom
  // Boden), darf die Polzeile nicht unruhiger sein als der Ring ~2° daneben (sonst „Strudel“).
  const k = Math.max(1, Math.ceil(H / 90));
  const poleOk = (std, ringStd) => std < 4 || std <= 0.6 * ringStd;
  const ok = edge <= Math.max(2 * inner, 1) && poleOk(topStd, rowStd(k)) && poleOk(bottomStd, rowStd(H - 1 - k));
  return { edgeDiff: edge, innerDiff: inner, topStd, bottomStd, ok };
}

// ---------------------------------------------------------------------------
// Überdeckungsprüfung (rein geometrisch, ohne Bildvergleich)
//
// Hinweis zur Entwicklung: Eine automatische Ausrichtung von Nahaufnahmen per Bildvergleich
// wurde getestet und wieder entfernt. Bei den Testfotos (VW Golf 7) erzeugte sie trotz guter
// Kennzahl ein doppeltes Lenkrad, weil die Nahaufnahme von einem anderen Standpunkt stammt
// (Parallaxe) – das lässt sich mit einer reinen Drehung grundsätzlich nicht deckungsgleich machen.

/**
 * Für jede Insel: Anteil ihrer Fläche, der bereits von höher priorisierten Ebenen
 * (Anker oder frühere Inseln) bedeckt ist. Hohe Werte = Gefahr doppelter Objekte.
 * @returns Array parallel zu `layers` mit { covered, area } (covered = 0..1)
 */
export function footprintOverlaps(layers, W = 360) {
  const H = W / 2;
  const T = trigTables(W, H);
  const s = [0, 0, 0];
  const res = layers.map(() => ({ hit: 0, area: 0 }));
  for (let v = 0; v < H; v++) {
    const wgt = T.cosLat[v]; // Flächengewicht im Equirect
    for (let u = 0; u < W; u++) {
      const dx = T.cosLat[v] * T.sinLon[u], dy = T.sinLat[v], dz = T.cosLat[v] * T.cosLon[u];
      let taken = false;
      for (let k = 0; k < layers.length; k++) {
        if (sampleLayer(layers[k], dx, dy, dz, s) < 0.5) continue;
        res[k].area += wgt;
        if (taken) res[k].hit += wgt;
        taken = true;
      }
    }
  }
  return res.map((r) => ({ covered: r.area > 0 ? r.hit / r.area : 0, area: r.area }));
}
