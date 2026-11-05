// Aufnahmeplan für die Rundumaufnahme aus der Mitte (Handy hochkant).
// Hochkant hat die Hauptkamera typischerweise ~53° horizontales und ~67° vertikales Sichtfeld.
// Plan: 10 Fotos geradeaus (alle 36°), je 6 Fotos schräg oben/unten (±50°), 1× Dach, 1× Boden.
// Benachbarte Fotos überlappen sich um ~15–20°, damit die Feinausrichtung genug Fläche hat.

import { DEG } from './math.js';

export function capturePlan() {
  const t = [];
  const ring = (pitch, count, offset = 0) => {
    for (let k = 0; k < count; k++) {
      let yaw = offset + (360 / count) * k;
      if (yaw > 180) yaw -= 360;
      t.push({ yaw, pitch });
    }
  };
  ring(0, 10);
  ring(50, 6, 30);
  ring(-50, 6, 30);
  t.push({ yaw: 0, pitch: 89 });
  t.push({ yaw: 0, pitch: -89 });
  return t.map((x, i) => ({ ...x, index: i }));
}

/** Typisches Sichtfeld der Handy-Hauptkamera (≈26 mm KB-äquivalent) für ein Bild w×h. */
export function guessHfov(w, h) {
  const halfDiag = 39.75 * DEG; // atan(21.63 / 26)
  return (2 * Math.atan((w / Math.hypot(w, h)) * Math.tan(halfDiag))) / DEG;
}

export function dirOf(yaw, pitch) {
  const a = yaw * DEG, b = pitch * DEG;
  return [Math.cos(b) * Math.sin(a), Math.sin(b), Math.cos(b) * Math.cos(a)];
}
