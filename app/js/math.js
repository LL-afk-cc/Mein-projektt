// Kugel-Geometrie für equirektangulare Panoramen.
//
// Koordinatensystem (rechtshändig, Blick aus der Fahrzeugmitte):
//   +z = vorne (Mitte des Panoramas), +x = rechts, +y = oben.
// Equirect: Länge lon ∈ [-π, π) läuft von links nach rechts, lon = 0 ist die Bildmitte.
//           Breite lat ∈ [-π/2, π/2], oben = +π/2 (Zenit).

export const DEG = Math.PI / 180;

/** Pixelmitte (u, v) eines W×H-Equirects → Einheitsvektor [x, y, z]. */
export function equirectToDir(u, v, W, H) {
  const lon = ((u + 0.5) / W) * 2 * Math.PI - Math.PI;
  const lat = Math.PI / 2 - ((v + 0.5) / H) * Math.PI;
  const c = Math.cos(lat);
  return [c * Math.sin(lon), Math.sin(lat), c * Math.cos(lon)];
}

/** Richtung → kontinuierliche Pixelkoordinaten (u, v) im W×H-Equirect. */
export function dirToEquirect(x, y, z, W, H) {
  const lon = Math.atan2(x, z);
  const lat = Math.asin(Math.max(-1, Math.min(1, y / Math.hypot(x, y, z))));
  const u = ((lon + Math.PI) / (2 * Math.PI)) * W - 0.5;
  const v = ((Math.PI / 2 - lat) / Math.PI) * H - 0.5;
  return [u, v];
}

/**
 * Drehmatrix (zeilenweise, 9 Werte) für eine Kamera mit
 * Gier (yaw, + = nach rechts), Nick (pitch, + = nach oben) und Roll (+ = Bild im Uhrzeigersinn gekippt).
 * Kamera-lokal: +z Blickrichtung, +x rechts, +y oben. Welt = R · lokal.
 */
export function rotationMatrix(yawDeg, pitchDeg, rollDeg) {
  const a = yawDeg * DEG, b = pitchDeg * DEG, g = rollDeg * DEG;
  const ca = Math.cos(a), sa = Math.sin(a);
  const cb = Math.cos(b), sb = Math.sin(b);
  const cg = Math.cos(g), sg = Math.sin(g);
  // Ry(yaw)
  const Ry = [ca, 0, sa, 0, 1, 0, -sa, 0, ca];
  // Rx(pitch): dreht +z nach oben
  const Rx = [1, 0, 0, 0, cb, sb, 0, -sb, cb];
  // Rz(roll)
  const Rz = [cg, -sg, 0, sg, cg, 0, 0, 0, 1];
  return mul3(mul3(Ry, Rx), Rz);
}

export function mul3(A, B) {
  const C = new Array(9);
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      C[i * 3 + j] = A[i * 3] * B[j] + A[i * 3 + 1] * B[3 + j] + A[i * 3 + 2] * B[6 + j];
  return C;
}

export function transpose3(A) {
  return [A[0], A[3], A[6], A[1], A[4], A[7], A[2], A[5], A[8]];
}

export function applyMat(A, v) {
  return [
    A[0] * v[0] + A[1] * v[1] + A[2] * v[2],
    A[3] * v[0] + A[4] * v[1] + A[5] * v[2],
    A[6] * v[0] + A[7] * v[1] + A[8] * v[2],
  ];
}

/** Brennweite in Pixeln aus horizontalem Sichtfeld. */
export function focalFromHfov(width, hfovDeg) {
  return (width / 2) / Math.tan((hfovDeg * DEG) / 2);
}

/** Vertikales Sichtfeld aus horizontalem (Lochkamera). */
export function vfovFromHfov(hfovDeg, width, height) {
  return 2 * Math.atan(Math.tan((hfovDeg * DEG) / 2) * (height / width)) / DEG;
}

/**
 * Lochkamera-Projektion: Weltrichtung → Bildpixel (x nach rechts, y nach unten).
 * Gibt null zurück, wenn die Richtung hinter der Kamera liegt.
 */
export function projectToCamera(dir, Rt, f, cx, cy) {
  const c = applyMat(Rt, dir);
  if (c[2] <= 1e-9) return null;
  return [cx + (f * c[0]) / c[2], cy - (f * c[1]) / c[2]];
}

/** Bildpixel → Weltrichtung (Umkehrung von projectToCamera). */
export function cameraPixelToDir(px, py, R, f, cx, cy) {
  const v = [(px - cx) / f, -(py - cy) / f, 1];
  const n = Math.hypot(v[0], v[1], v[2]);
  return applyMat(R, [v[0] / n, v[1] / n, v[2] / n]);
}

export function smoothstep(t) {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return t * t * (3 - 2 * t);
}
