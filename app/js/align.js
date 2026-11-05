// Feinausrichtung einer Rundumaufnahme aus der Mitte.
//
// Alle Fotos stammen (annähernd) vom selben Standpunkt, unterscheiden sich also nur durch eine
// Drehung. Der Bewegungssensor liefert diese Drehung auf wenige Grad genau. Hier wird sie so
// nachgeregelt, dass sich überlappende Fotos bestmöglich decken:
//   - Für jedes überlappende Paar wird eine Tangentialebene in der Mitte zwischen beiden Fotos
//     abgetastet und die Ähnlichkeit (normierte Kreuzkorrelation der Helligkeit) gemessen.
//   - Jedes Foto (außer dem ersten = „vorne“) wird um kleine Drehungen um die drei Weltachsen
//     variiert (Koordinatenabstieg, grob → fein). Ein gemeinsames Sichtfeld wird mitgeschätzt.
//   - Danach Helligkeitsangleich (Belichtung/Weißabgleich) über die Überlappungen.

import { prepareLayer, sampleLayer, DEFAULT_PARAMS } from './compose.js';
import { mul3 } from './math.js';

const D = Math.PI / 180;

/** Drehung um eine Weltachse (0=x, 1=y, 2=z) um deg Grad. */
export function axisRot(axis, deg) {
  const c = Math.cos(deg * D), s = Math.sin(deg * D);
  if (axis === 0) return [1, 0, 0, 0, c, -s, 0, s, c];
  if (axis === 1) return [c, 0, s, 0, 1, 0, -s, 0, c];
  return [c, -s, 0, s, c, 0, 0, 0, 1];
}

/** Winkel (Grad) zwischen zwei Drehmatrizen. */
export function rotDiffDeg(A, B) {
  // tr(Aᵀ B)
  let tr = 0;
  for (let i = 0; i < 3; i++) for (let k = 0; k < 3; k++) tr += A[k * 3 + i] * B[k * 3 + i];
  return Math.acos(Math.max(-1, Math.min(1, (tr - 1) / 2))) / D;
}

/** Vertikales Sichtfeld aus horizontalem. */
const vfovOf = (hfov, w, h) => (2 * Math.atan(Math.tan((hfov * D) / 2) * (h / w))) / D;

const axisOf = (R) => [R[2], R[5], R[8]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => { const n = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / n, a[1] / n, a[2] / n]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** Überlappende Paare: Bildachsen näher als ~ das kleinere Sichtfeld. */
export function findPairs(Rs, hfov, vfov) {
  const lim = Math.cos(Math.min(hfov, vfov) * 0.95 * D);
  const pairs = [];
  for (let i = 0; i < Rs.length; i++)
    for (let j = i + 1; j < Rs.length; j++)
      if (dot(axisOf(Rs[i]), axisOf(Rs[j])) > lim) pairs.push([i, j]);
  return pairs;
}

/** Abtastrichtungen einer N×N-Tangentialebene um center mit halber Ausdehnung halfDeg. */
function patchDirs(center, halfDeg, N) {
  const n = norm(center);
  const ref = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const e1 = norm(cross(ref, n)), e2 = cross(n, e1);
  const t = Math.tan(halfDeg * D);
  const out = new Float64Array(N * N * 3);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const a = ((x + 0.5) / N * 2 - 1) * t, b = ((y + 0.5) / N * 2 - 1) * t;
      const d = norm([n[0] + a * e1[0] + b * e2[0], n[1] + a * e1[1] + b * e2[1], n[2] + a * e1[2] + b * e2[2]]);
      const o = (y * N + x) * 3;
      out[o] = d[0]; out[o + 1] = d[1]; out[o + 2] = d[2];
    }
  return out;
}

/** Graubild + Deckung + mittlere Farbe einer Ebene auf den Patch-Richtungen (mit 3×3-Weichzeichnung). */
function samplePatch(L, dirs, N, blur = true) {
  const g = new Float32Array(N * N), a = new Uint8Array(N * N);
  const s = [0, 0, 0, 0];
  const rgb = new Float32Array(N * N * 3);
  for (let i = 0; i < N * N; i++) {
    const al = sampleLayer(L, dirs[i * 3], dirs[i * 3 + 1], dirs[i * 3 + 2], s);
    if (al > 0.5) {
      a[i] = 1;
      g[i] = 0.299 * s[0] + 0.587 * s[1] + 0.114 * s[2];
      rgb[i * 3] = s[0]; rgb[i * 3 + 1] = s[1]; rgb[i * 3 + 2] = s[2];
    }
  }
  if (!blur) return { g, a, rgb };
  // 3×3-Box-Weichzeichnung: macht die Bewertung glatter (größerer Einzugsbereich)
  const b = new Float32Array(N * N);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      if (!a[i]) continue;
      let sum = 0, n = 0;
      for (let yy = Math.max(0, y - 1); yy <= Math.min(N - 1, y + 1); yy++)
        for (let xx = Math.max(0, x - 1); xx <= Math.min(N - 1, x + 1); xx++) {
          const j = yy * N + xx;
          if (a[j]) { sum += g[j]; n++; }
        }
      b[i] = sum / n;
    }
  return { g: b, a, rgb };
}

function nccOf(P, Q, minFrac) {
  const n0 = P.a.length;
  let n = 0, sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
  for (let i = 0; i < n0; i++) {
    if (!P.a[i] || !Q.a[i]) continue;
    const x = P.g[i], y = Q.g[i];
    n++; sa += x; sb += y; saa += x * x; sbb += y * y; sab += x * y;
  }
  if (n < n0 * minFrac) return { ncc: null, n };
  const va = saa / n - (sa / n) ** 2, vb = sbb / n - (sb / n) ** 2;
  if (va < 1 || vb < 1) return { ncc: 0, n }; // strukturlos (z. B. einfarbiger Dachhimmel)
  return { ncc: (sab / n - (sa / n) * (sb / n)) / Math.sqrt(va * vb), n };
}

/**
 * Eine Ausrichtungs-Runde (Koordinatenabstieg über die Stufen) bei gegebenem Sichtfeld.
 * Foto 0 bleibt fest. Gibt { Rs, hfov, gains, pairs, score } zurück.
 */
function runStages(pyrs, Rs0, hfov0, opts = {}) {
  const n = pyrs.length;
  let Rs = Rs0.map((R) => R.slice());
  let hfov = hfov0;
  const base = pyrs[0].get(0);
  const vfov0 = vfovOf(hfov0, base.width, base.height);
  const pairs = findPairs(Rs, hfov0, vfov0);
  const minFrac = 0.12;
  const stages = opts.stages || [
    { N: 48, steps: [3, 1.5] },
    { N: 96, steps: [0.8, 0.4] },
    { N: 160, steps: [0.2, 0.1] },
  ];
  const progress = opts.onProgress || (() => {});
  const before = new Array(pairs.length).fill(null);
  let work = 0;
  const totalWork = stages.reduce((a, st) => a + st.steps.length, 0);
  const label = opts.label || 'Fotos ausrichten';

  for (let si = 0; si < stages.length; si++) {
    const { N, steps, blur = true } = stages[si];
    const halfDeg = Math.min(hfov, vfovOf(hfov, base.width, base.height)) * 0.5;
    const panoW = (360 * N) / (2 * halfDeg); // passende Pyramidenstufe
    // Patch je Paar: Mitte zwischen den beiden Bildachsen
    const P = pairs.map(([i, j]) => patchDirs(
      norm([axisOf(Rs[i])[0] + axisOf(Rs[j])[0], axisOf(Rs[i])[1] + axisOf(Rs[j])[1], axisOf(Rs[i])[2] + axisOf(Rs[j])[2]]), halfDeg, N));
    const layerOf = (k, R, fov) => prepareLayer(pyrs[k], { ...DEFAULT_PARAMS, R, hfov: fov, feather: 0.001 }, 'shot', panoW);
    // Zwischenspeicher der abgetasteten Patches: cache[pairIdx][seite]
    let layers = Rs.map((R, k) => layerOf(k, R, hfov));
    const cache = pairs.map(() => [null, null]);
    const patchOf = (pi, side, L) => samplePatch(L, P[pi], N, blur);
    const getCached = (pi, side) => {
      if (!cache[pi][side]) cache[pi][side] = patchOf(pi, side, layers[pairs[pi][side]]);
      return cache[pi][side];
    };
    const pairsOf = Rs.map((_, k) => pairs.map((p, pi) => [p, pi]).filter(([p]) => p[0] === k || p[1] === k).map(([, pi]) => pi));
    const scoreImage = (k, L) => {
      let sum = 0, cnt = 0;
      for (const pi of pairsOf[k]) {
        const side = pairs[pi][0] === k ? 0 : 1;
        const mine = patchOf(pi, side, L);
        const other = getCached(pi, 1 - side);
        const r = side === 0 ? nccOf(mine, other, minFrac) : nccOf(other, mine, minFrac);
        if (r.ncc != null) { sum += r.ncc; cnt++; }
      }
      return cnt ? sum : -1e9;
    };
    const total = () => {
      let sum = 0;
      for (let pi = 0; pi < pairs.length; pi++) {
        const r = nccOf(getCached(pi, 0), getCached(pi, 1), minFrac);
        if (r.ncc != null) sum += r.ncc;
      }
      return sum;
    };
    if (si === 0) {
      pairs.forEach((_, pi) => { before[pi] = nccOf(getCached(pi, 0), getCached(pi, 1), minFrac).ncc; });
    }

    for (const st of steps) {
      progress(work / totalWork, `${label} (Stufe ${si + 1}/${stages.length}, Schritt ${st}°) …`);
      let improved = true, sweeps = 0;
      while (improved && sweeps++ < 4) {
        improved = false;
        for (let k = 1; k < n; k++) {
          if (!pairsOf[k].length) continue;
          let best = scoreImage(k, layers[k]);
          for (let ax = 0; ax < 3; ax++) {
            for (const sg of [-1, 1]) {
              const R = mul3(axisRot(ax, sg * st), Rs[k]);
              const L = layerOf(k, R, hfov);
              const sc = scoreImage(k, L);
              if (sc > best + 1e-7) {
                best = sc; Rs[k] = R; layers[k] = L; improved = true;
                for (const pi of pairsOf[k]) cache[pi][pairs[pi][0] === k ? 0 : 1] = null;
              }
            }
          }
        }
        // gemeinsames Sichtfeld
        if (!opts.fixFov) {
          const cur = total();
          for (const sg of [-1, 1]) {
            const f2 = hfov * (1 + sg * st * 0.012);
            const saveL = layers, saveC = cache.map((c) => c.slice());
            layers = Rs.map((R, k) => layerOf(k, R, f2));
            for (const c of cache) { c[0] = null; c[1] = null; }
            const sc = total();
            if (sc > cur + 1e-3) { hfov = f2; improved = true; break; }
            layers = saveL;
            saveC.forEach((c, i) => { cache[i][0] = c[0]; cache[i][1] = c[1]; });
          }
        }
      }
      work++;
    }

    if (si === stages.length - 1) {
      // Ergebnis je Paar + mittlere Farben für den Helligkeitsangleich
      const result = pairs.map((p, pi) => {
        const A = getCached(pi, 0), B = getCached(pi, 1);
        const r = nccOf(A, B, minFrac);
        const ma = [0, 0, 0], mb = [0, 0, 0];
        let cnt = 0;
        for (let q = 0; q < A.a.length; q++) {
          if (!A.a[q] || !B.a[q]) continue;
          cnt++;
          for (let c = 0; c < 3; c++) { ma[c] += A.rgb[q * 3 + c]; mb[c] += B.rgb[q * 3 + c]; }
        }
        return { i: p[0], j: p[1], before: before[pi], after: r.ncc, n: cnt, ma: ma.map((x) => x / Math.max(1, cnt)), mb: mb.map((x) => x / Math.max(1, cnt)) };
      });
      const gains = solveGains(n, result.filter((r) => r.n > 50));
      const valid = result.filter((r) => r.after != null);
      // Mittel über ALLE Paare (fehlende Überlappung zählt 0) – vergleichbar zwischen Sichtfeld-Kandidaten
      const score = valid.length ? result.reduce((a, r) => a + (r.after ?? 0), 0) / result.length : null;
      return { Rs, hfov, gains, pairs: result.map(({ ma, mb, ...r }) => r), score };
    }
  }
  return null;
}

const COARSE = [{ N: 48, steps: [3, 1.5] }];
const MEDIUM = [{ N: 96, steps: [0.8, 0.4] }];
// Feinstufe ohne Weichzeichnung: die Korrelation wird nahe am Optimum sonst zu flach
const FINE = [{ N: 160, steps: [0.2, 0.1, 0.05], blur: false }];

/** Scheitel einer Parabel durch drei Punkte (x gleichabständig); fällt sonst auf das Maximum zurück. */
function parabolaPeak(xs, ys) {
  let b = 0;
  for (let i = 1; i < ys.length; i++) if (ys[i] > ys[b]) b = i;
  if (b === 0 || b === ys.length - 1) return xs[b];
  const [y0, y1, y2] = [ys[b - 1], ys[b], ys[b + 1]];
  const den = y0 - 2 * y1 + y2;
  if (den >= 0) return xs[b];
  const off = Math.max(-1, Math.min(1, (0.5 * (y0 - y2)) / den));
  return xs[b] + off * (xs[b + 1] - xs[b]);
}

/** Orthogonaler Anteil (Polarzerlegung) einer 3×3-Matrix per Newton-Iteration. */
function polarRotation(M) {
  let X = M.slice();
  for (let it = 0; it < 30; it++) {
    const [a, b, c, d, e, f, g, h, i] = X;
    const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
    if (Math.abs(det) < 1e-12) break;
    // (X⁻¹)ᵀ = Kofaktormatrix / det
    const cof = [e * i - f * h, -(d * i - f * g), d * h - e * g, -(b * i - c * h), a * i - c * g, -(a * h - b * g), b * f - c * e, -(a * f - c * d), a * e - b * d];
    X = X.map((v, k) => 0.5 * (v + cof[k] / det));
  }
  return X;
}

/**
 * Gesamtlage: Die Feinausrichtung legt nur die Fotos ZUEINANDER fest. Die gemeinsame Drehung
 * wird so gewählt, dass sie im Mittel am besten zu ALLEN Sensorwerten passt (zufällige
 * Sensorfehler mitteln sich heraus; insbesondere der Horizont aus der Schwerkraft).
 */
export function anchorToSensor(Rs, sensorRs) {
  const M = new Array(9).fill(0);
  for (let k = 0; k < Rs.length; k++) {
    const S = sensorRs[k], R = Rs[k];
    // M += S · Rᵀ
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++)
        M[i * 3 + j] += S[i * 3] * R[j * 3] + S[i * 3 + 1] * R[j * 3 + 1] + S[i * 3 + 2] * R[j * 3 + 2];
  }
  const G = polarRotation(M);
  return Rs.map((R) => mul3(G, R));
}

// ---------------------------------------------------------------------------
// Paarweise Vollsuche + Drehungs-Mittelung (robuste Startwerte für die Feinausrichtung)

/** Drehung um eine beliebige Einheitsachse (Rodrigues), Winkel in Grad. */
function rotAbout(a, deg) {
  const t = deg * D, c = Math.cos(t), s = Math.sin(t), C = 1 - c;
  const [x, y, z] = a;
  return [c + x * x * C, x * y * C - z * s, x * z * C + y * s, y * x * C + z * s, c + y * y * C, y * z * C - x * s, z * x * C - y * s, z * y * C + x * s, c + z * z * C];
}

/**
 * Misst für ein Paar (i fest, j beweglich) die Korrektur Q, sodass Q·R_j am besten zu R_i passt.
 * Vollsuche über Verschiebungen in der Tangentialebene (±span) und Verdrehung, dann verfeinert.
 */
/** Schnelle Grauwert-Abtastung (bilinear) einer Ebene; -1 = außerhalb. */
function grayAt(L, dx, dy, dz) {
  const Rt = L.Rt;
  const cz = Rt[6] * dx + Rt[7] * dy + Rt[8] * dz;
  if (cz <= 1e-6) return -1;
  const x = L.cx + (L.f * (Rt[0] * dx + Rt[1] * dy + Rt[2] * dz)) / cz;
  const y = L.cy - (L.f * (Rt[3] * dx + Rt[4] * dy + Rt[5] * dz)) / cz;
  if (x < 0 || y < 0 || x > L.w - 1.001 || y > L.h - 1.001) return -1;
  const xi = x | 0, yi = y | 0, fx = x - xi, fy = y - yi, w = L.w, d = L.data;
  const p = (yi * w + xi) * 4, q = p + w * 4;
  const g = (o) => 0.299 * d[o] + 0.587 * d[o + 1] + 0.114 * d[o + 2];
  return (g(p) * (1 - fx) + g(p + 4) * fx) * (1 - fy) + (g(q) * (1 - fx) + g(q + 4) * fx) * fy;
}

/** Referenzpunkte: nur Richtungen, in denen Foto i Bildinhalt hat. */
function makeRef(L, dirs) {
  const n = dirs.length / 3;
  const pts = [], gs = [];
  for (let k = 0; k < n; k++) {
    const g = grayAt(L, dirs[k * 3], dirs[k * 3 + 1], dirs[k * 3 + 2]);
    if (g >= 0) { pts.push(dirs[k * 3], dirs[k * 3 + 1], dirs[k * 3 + 2]); gs.push(g); }
  }
  return { dirs: new Float64Array(pts), g: new Float32Array(gs), total: n };
}

/** Normierte Kreuzkorrelation Referenz ↔ Ebene L (nur Überlappung); null bei zu wenig Überlappung. */
function nccRef(ref, L, minFrac = 0.12) {
  const d = ref.dirs, G = ref.g;
  let n = 0, sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
  for (let k = 0, m = G.length; k < m; k++) {
    const y = grayAt(L, d[k * 3], d[k * 3 + 1], d[k * 3 + 2]);
    if (y < 0) continue;
    const x = G[k];
    n++; sa += x; sb += y; saa += x * x; sbb += y * y; sab += x * y;
  }
  if (n < ref.total * minFrac) return null;
  const va = saa / n - (sa / n) ** 2, vb = sbb / n - (sb / n) ** 2;
  if (va < 1 || vb < 1) return 0;
  return (sab / n - (sa / n) * (sb / n)) / Math.sqrt(va * vb);
}

/**
 * Misst für ein Paar (i fest, j beweglich) die Korrektur Q, sodass Q·R_j am besten zu R_i passt.
 * Vollsuche über Verschiebungen in der Tangentialebene (±span) und Verdrehung, dann verfeinert.
 * Grobe Stufen nutzen eine gröbere Pyramidenstufe (= Weichzeichnung, größerer Einzugsbereich).
 */
function measurePair(pyrs, Ri, Rj, i, j, hfov, N, span) {
  const base = pyrs[0].get(0);
  const halfDeg = Math.min(hfov, vfovOf(hfov, base.width, base.height)) * 0.5;
  const center = norm([Ri[2] + Rj[2], Ri[5] + Rj[5], Ri[8] + Rj[8]]);
  const ref = Math.abs(center[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const e1 = norm(cross(ref, center)), e2 = cross(center, e1);
  let Q = [1, 0, 0, 0, 1, 0, 0, 0, 1], score = -2;
  // Verdrehung großzügig absuchen: Ein Gier-Fehler des Sensors ist für Fotos nach oben/unten
  // (Dach, Boden) eine reine Verdrehung um die Bildmitte.
  const range = (a, st) => { const r = []; for (let x = -a; x <= a + 1e-9; x += st) r.push(x); return r; };
  // (Rastergröße, Schärfefaktor der Pyramidenstufe, Schrittweite, Suchbereich, Verdrehungen)
  const levels = [
    [N, 0.5, 1.5, span, range(6, 1.5)],
    [N * 2, 0.5, 0.5, 1.5, range(1.5, 0.5)],
    [N * 3, 1, 0.1, 0.4, range(0.3, 0.1)],
  ];
  for (const [n, sharp, st, sp, rolls] of levels) {
    const dirs = patchDirs(center, halfDeg, n);
    const panoW = ((360 * n) / (2 * halfDeg)) * sharp;
    const mk = (k, R) => prepareLayer(pyrs[k], { ...DEFAULT_PARAMS, R, hfov, feather: 0.001 }, 'shot', panoW);
    const A = makeRef(mk(i, Ri), dirs);
    const around = Q;
    let best = -2, bestQ = around;
    for (const rr of rolls)
      for (let a = -sp; a <= sp + 1e-9; a += st)
        for (let b = -sp; b <= sp + 1e-9; b += st) {
          const Qc = mul3(mul3(mul3(rotAbout(e1, a), rotAbout(e2, b)), rotAbout(center, rr)), around);
          const r = nccRef(A, mk(j, mul3(Qc, Rj)));
          if (r != null && r > best) { best = r; bestQ = Qc; }
        }
    Q = bestQ; score = best;
  }
  return { score, Q, i, j };
}

/** Drehungs-Mittelung: R_j ≈ Q_ij·R_j0, also relative Drehung M_ij = R_iᵀ·Q_ij·R_j0. */
function averageRotations(Rs0, meas, iters = 300) {
  const n = Rs0.length;
  const rel = meas.map((m) => {
    const RjQ = mul3(m.Q, Rs0[m.j]);
    const RiT = [Rs0[m.i][0], Rs0[m.i][3], Rs0[m.i][6], Rs0[m.i][1], Rs0[m.i][4], Rs0[m.i][7], Rs0[m.i][2], Rs0[m.i][5], Rs0[m.i][8]];
    return { i: m.i, j: m.j, M: mul3(RiT, RjQ), w: Math.max(0, m.score) ** 2 * (m.weight ?? 1) };
  });
  const Rs = Rs0.map((R) => R.slice());
  const T = (A) => [A[0], A[3], A[6], A[1], A[4], A[7], A[2], A[5], A[8]];
  for (let it = 0; it < iters; it++) {
    for (let k = 1; k < n; k++) {
      const S = new Array(9).fill(0);
      let wsum = 0;
      for (const r of rel) {
        let E = null;
        if (r.j === k) E = mul3(Rs[r.i], r.M);
        else if (r.i === k) E = mul3(Rs[r.j], T(r.M));
        if (!E) continue;
        for (let q = 0; q < 9; q++) S[q] += r.w * E[q];
        wsum += r.w;
      }
      if (wsum > 0) Rs[k] = polarRotation(S);
    }
  }
  return Rs;
}

/** Restfehler eines Paares (Grad) gegenüber den gemittelten Drehungen. */
function pairResidual(Rs0, Rs, m) {
  const T = (A) => [A[0], A[3], A[6], A[1], A[4], A[7], A[2], A[5], A[8]];
  const meas = mul3(T(Rs0[m.i]), mul3(m.Q, Rs0[m.j]));
  return rotDiffDeg(meas, mul3(T(Rs[m.i]), Rs[m.j]));
}

/**
 * Robuste Startwerte: alle Paare messen (Vollsuche), unsichere verwerfen, Drehungen robust mitteln.
 */
export { averageRotations };

export function initialAlignment(pyrs, Rs, hfov, opts = {}) {
  const base = pyrs[0].get(0);
  const pairs = findPairs(Rs, hfov, vfovOf(hfov, base.width, base.height));
  const progress = opts.onProgress || (() => {});
  const meas = [];
  pairs.forEach(([i, j], k) => {
    progress(k / pairs.length, `Fotopaare vergleichen (${k + 1}/${pairs.length}) …`);
    meas.push(measurePair(pyrs, Rs[i], Rs[j], i, j, hfov, opts.N || 48, opts.span || 7));
  });
  const good = meas.filter((m) => m.score >= (opts.minScore ?? 0.5));
  // Robuste Mittelung (IRLS mit Cauchy-Gewichten): Paare, deren Messung nicht zum Gesamtbild
  // passt (z. B. strukturarmer Dachhimmel), verlieren schrittweise an Gewicht.
  // Test (synthetisch, 24 Fotos): hartes Verwerfen 0,75° mittlerer Fehler, robust 0,2°.
  const sigma = opts.sigma ?? 0.35;
  for (const m of good) m.weight = 1;
  let out = averageRotations(Rs, good);
  for (let round = 0; round < 8; round++) {
    for (const m of good) {
      const r = pairResidual(Rs, out, m);
      m.residual = r;
      m.weight = 1 / (1 + (r / sigma) ** 2);
    }
    out = averageRotations(Rs, good, 200);
  }
  return { Rs: out, meas, used: good.filter((m) => m.weight > 0.3).length };
}

/**
 * Sichtfeld über den Ringschluss: Die Fotos geradeaus (|Nick| < 25°) bilden einen Ring. Misst man
 * die relativen Drehungen benachbarter Fotos und verkettet sie einmal herum, muss bei richtigem
 * Sichtfeld wieder genau die Ausgangslage herauskommen. Bei falschem Sichtfeld bleibt ein
 * Gier-Rest (Lücke/Überlappung). Dessen Nullstelle wird per Sekantenverfahren gesucht.
 */
export function estimateFovByClosure(pyrs, sensorRs, hfov0, opts = {}) {
  const progress = opts.onProgress || (() => {});
  const ring = sensorRs
    .map((R, k) => ({ k, pitch: Math.asin(Math.max(-1, Math.min(1, R[5]))) / D, yaw: Math.atan2(R[2], R[8]) / D }))
    .filter((x) => Math.abs(x.pitch) < 25)
    .sort((a, b) => a.yaw - b.yaw);
  if (ring.length < 6) return { hfov: hfov0, ok: false, reason: 'zu wenige Fotos geradeaus' };
  // Lücken > Sichtfeld → Ring nicht geschlossen
  for (let q = 0; q < ring.length; q++) {
    const a = ring[q].yaw, b = ring[(q + 1) % ring.length].yaw + (q === ring.length - 1 ? 360 : 0);
    if (b - a > hfov0 * 0.95) return { hfov: hfov0, ok: false, reason: 'Ring geradeaus hat eine Lücke' };
  }
  const T = (A) => [A[0], A[3], A[6], A[1], A[4], A[7], A[2], A[5], A[8]];
  let evals = 0;
  const closure = (h) => {
    let P = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    for (let q = 0; q < ring.length; q++) {
      const i = ring[q].k, j = ring[(q + 1) % ring.length].k;
      progress(Math.min(0.99, (evals * ring.length + q) / (4 * ring.length)), `Kamera-Sichtfeld bestimmen (Durchgang ${evals + 1}) …`);
      const m = measurePair(pyrs, sensorRs[i], sensorRs[j], i, j, h, 48, 7);
      P = mul3(P, mul3(T(sensorRs[i]), mul3(m.Q, sensorRs[j])));
    }
    evals++;
    // Gier-Anteil der Restdrehung (kleiner Winkel, Hochachse des ersten Fotos)
    return Math.atan2(P[2] - P[6], P[0] + P[8]) / D;
  };
  let h0 = hfov0, h1 = hfov0 * 1.06;
  let e0 = closure(h0), e1 = closure(h1);
  for (let it = 0; it < 2 && Math.abs(e1 - e0) > 1e-6; it++) {
    const h2 = Math.max(hfov0 * 0.7, Math.min(hfov0 * 1.4, h1 - (e1 * (h1 - h0)) / (e1 - e0)));
    const e2 = closure(h2);
    h0 = h1; e0 = e1; h1 = h2; e1 = e2;
  }
  return { hfov: h1, ok: Math.abs(e1) < 1, closureDeg: e1 };
}

/**
 * Feinausrichtung einer Rundumaufnahme.
 * 1. Sichtfeld-Suche: mehrere Kandidaten, je mit grober Ausrichtung; Parabel durch die besten.
 * 2. Mittlere und feine Ausrichtung beim gefundenen Sichtfeld.
 * 3. Gesamtlage an alle Sensorwerte anpassen.
 * @param pyrs  Pyramiden der Fotos (gleiche Kamera, gleiche Größe)
 * @param sensorRs Drehmatrizen vom Bewegungssensor
 * @param hfov0 geschätztes Sichtfeld (horizontal, Grad)
 * @param opts  { onProgress(f, text), fixFov }
 * @returns { Rs, hfov, gains, pairs:[{i,j,before,after}], score, fovScan }
 */
export function alignShots(pyrs, sensorRs, hfov0, opts = {}) {
  const progress = opts.onProgress || (() => {});
  const sub = (a, b) => (f, t) => progress(a + (b - a) * f, t);
  let hfov = hfov0, fov = { ok: false, reason: 'fest vorgegeben' };
  if (!opts.fixFov) {
    fov = estimateFovByClosure(pyrs, sensorRs, hfov0, { onProgress: sub(0, 0.35) });
    hfov = fov.hfov;
  }
  const init = initialAlignment(pyrs, sensorRs, hfov, { onProgress: sub(0.35, 0.95) });
  const Rs = anchorToSensor(init.Rs, sensorRs);
  progress(0.96, 'Helligkeit angleichen …');
  const stats = pairStats(pyrs, Rs, hfov);
  const gains = solveGains(pyrs.length, stats.filter((r) => r.n > 50));
  const valid = stats.filter((r) => r.ncc != null);
  progress(1, 'Ausrichtung fertig.');
  return {
    Rs, hfov, gains, fov,
    pairs: stats.map(({ ma, mb, ...r }) => r),
    pairsUsed: init.used,
    score: valid.length ? valid.reduce((a, r) => a + r.ncc, 0) / valid.length : null,
    sensorDeviation: Rs.map((R, k) => rotDiffDeg(R, sensorRs[k])),
  };
}

/** Übereinstimmung und mittlere Farben je überlappendem Paar bei den endgültigen Drehungen. */
export function pairStats(pyrs, Rs, hfov, N = 96) {
  const base = pyrs[0].get(0);
  const halfDeg = Math.min(hfov, vfovOf(hfov, base.width, base.height)) * 0.5;
  return findPairs(Rs, hfov, vfovOf(hfov, base.width, base.height)).map(([i, j]) => {
    const dirs = patchDirs(norm([Rs[i][2] + Rs[j][2], Rs[i][5] + Rs[j][5], Rs[i][8] + Rs[j][8]]), halfDeg, N);
    const panoW = (360 * N) / (2 * halfDeg);
    const mk = (k) => prepareLayer(pyrs[k], { ...DEFAULT_PARAMS, R: Rs[k], hfov, feather: 0.001 }, 'shot', panoW);
    const A = samplePatch(mk(i), dirs, N, false), B = samplePatch(mk(j), dirs, N, false);
    const r = nccOf(A, B, 0.12);
    const ma = [0, 0, 0], mb = [0, 0, 0];
    let n = 0;
    for (let q = 0; q < A.a.length; q++) {
      if (!A.a[q] || !B.a[q]) continue;
      n++;
      for (let c = 0; c < 3; c++) { ma[c] += A.rgb[q * 3 + c]; mb[c] += B.rgb[q * 3 + c]; }
    }
    return { i, j, ncc: r.ncc, n, ma: ma.map((x) => x / Math.max(1, n)), mb: mb.map((x) => x / Math.max(1, n)) };
  });
}

/**
 * Helligkeitsangleich (je Farbkanal): minimiert Σ (g_i·m_ij − g_j·m_ji)² / σN² + Σ (1 − g_i)² / σg²
 * (wie bei Brown & Lowe, „Automatic Panoramic Image Stitching“).
 */
export function solveGains(n, pairStats, sigmaN = 10, sigmaG = 0.1) {
  const gains = Array.from({ length: n }, () => [1, 1, 1]);
  for (let c = 0; c < 3; c++) {
    const g = new Float64Array(n).fill(1);
    for (let it = 0; it < 200; it++) {
      for (let i = 0; i < n; i++) {
        let num = 1e-9, den = 1e-9;
        for (const p of pairStats) {
          let mi, mj, j;
          if (p.i === i) { mi = p.ma[c]; mj = p.mb[c]; j = p.j; }
          else if (p.j === i) { mi = p.mb[c]; mj = p.ma[c]; j = p.i; }
          else continue;
          const w = p.n;
          num += w * ((mi * g[j] * mj) / (sigmaN * sigmaN) + 1 / (sigmaG * sigmaG));
          den += w * ((mi * mi) / (sigmaN * sigmaN) + 1 / (sigmaG * sigmaG));
        }
        if (den <= 1e-6) { g[i] = 1; continue; }
        g[i] = num / den;
      }
    }
    for (let i = 0; i < n; i++) gains[i][c] = Math.max(0.5, Math.min(2, g[i]));
  }
  return gains;
}
