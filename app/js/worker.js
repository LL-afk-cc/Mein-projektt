// Rechen-Worker: Fotos dekodieren, Vorschau, automatische Ausrichtung, Endergebnis + JPEG.
// Läuft getrennt von der Oberfläche, damit das Handy während der Berechnung bedienbar bleibt.

import {
  Pyramid, prepareLayer, sortLayers, computeFill, renderPanorama, provenanceRGBA,
  seamCheck, footprintOverlaps,
} from './compose.js';
import { estimateRoll, anchorScore } from './estimate.js';
import { encodeJpeg, gpanoXmp } from './jpeg.js';

const MAX_SIDE = 4096;
const images = new Map(); // id → Pyramid

const post = (msg, transfer) => self.postMessage(msg, transfer || []);

async function decode(blob) {
  const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  const s = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * s), h = Math.round(bmp.height * s);
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const id = ctx.getImageData(0, 0, w, h);
  return { width: w, height: h, data: id.data };
}

function buildLayers(specs, W) {
  const layers = [];
  for (const s of specs) {
    const pyr = images.get(s.id);
    if (!pyr) throw new Error('Foto fehlt im Rechenspeicher: ' + s.id);
    const L = prepareLayer(pyr, s.params, s.kind, W);
    L.id = s.id;
    layers.push(L);
  }
  return sortLayers(layers);
}

async function toBitmap(rgba, w, h) {
  const c = new OffscreenCanvas(w, h);
  c.getContext('2d').putImageData(new ImageData(rgba, w, h), 0, 0);
  return c.transferToImageBitmap();
}

async function downscaleBitmap(rgba, W, H, maxW) {
  const full = new OffscreenCanvas(W, H);
  full.getContext('2d').putImageData(new ImageData(rgba, W, H), 0, 0);
  if (W <= maxW) return full.transferToImageBitmap();
  const w = maxW, h = Math.round((H * maxW) / W);
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(full, 0, 0, w, h);
  return c.transferToImageBitmap();
}

const handlers = {
  async addImage({ id, blob }) {
    const img = await decode(blob);
    images.set(id, new Pyramid(img));
    const roll = estimateRoll(img);
    return { id, width: img.width, height: img.height, score: anchorScore(img), roll };
  },

  async removeImage({ id }) {
    images.delete(id);
    return { id };
  },

  async preview({ layers: specs, W = 2048 }) {
    const H = W / 2;
    const layers = buildLayers(specs, W);
    const fill = computeFill(layers, 512, 256);
    const r = renderPanorama(layers, fill, W, H, { provScale: 4 });
    const bitmap = await toBitmap(r.data, W, H);
    const mask = await toBitmap(provenanceRGBA(r.prov, r.provW, r.provH), r.provW, r.provH);
    // Überdeckung je Ebene (in Reihenfolge der sortierten Ebenen, mit Foto-ID)
    const ov = footprintOverlaps(layers);
    const overlaps = layers.map((L, i) => ({ id: L.id, kind: L.kind, covered: ov[i].covered }));
    return { bitmap, mask, stats: r.stats, overlaps, _transfer: [bitmap, mask] };
  },

  async build({ layers: specs, W, quality = 96, title = '', viewerMax = 4096 }, reqId) {
    const H = W / 2;
    const t0 = Date.now();
    // Gewichte der Phasen für eine ehrliche Gesamt-Restzeit (gemessen am Desktop-Chromium)
    const phases = { fill: 0.06, render: 0.44, jpeg: 0.42, extra: 0.08 };
    let done = 0;
    const progress = (phase, label, f) => {
      const total = Math.min(0.999, done + phases[phase] * f);
      const el = Date.now() - t0;
      const eta = total > 0.03 ? (el / total) * (1 - total) : null;
      post({ type: 'progress', reqId, phase, label, frac: total, phaseFrac: f, elapsedMs: el, etaMs: eta });
    };
    const timings = {};
    let t = Date.now();
    progress('fill', 'Ebenen vorbereiten und Lücken auffüllen …', 0);
    const layers = buildLayers(specs, W);
    const fill = computeFill(layers, 1024, 512);
    timings.fill = Date.now() - t;
    done += phases.fill;

    t = Date.now();
    const r = renderPanorama(layers, fill, W, H, {
      onProgress: (f) => progress('render', `Panorama berechnen (${W}×${H}) …`, f),
    });
    timings.render = Date.now() - t;
    done += phases.render;

    t = Date.now();
    const seam = seamCheck(r.data, W, H);
    const xmp = gpanoXmp(W, H, title ? { 'GPano:SourcePhotosCount': specs.length } : {});
    const jpeg = encodeJpeg({ width: W, height: H, data: r.data }, {
      quality, xmp, onProgress: (f) => progress('jpeg', 'JPEG speichern (4:4:4, 360°-Metadaten) …', f),
    });
    timings.jpeg = Date.now() - t;
    done += phases.jpeg;

    t = Date.now();
    progress('extra', 'Viewer-Bild und Herkunftsmaske vorbereiten …', 0);
    const display = await downscaleBitmap(r.data, W, H, viewerMax);
    const maskRGBA = provenanceRGBA(r.prov, r.provW, r.provH);
    const maskCanvas = new OffscreenCanvas(r.provW, r.provH);
    maskCanvas.getContext('2d').putImageData(new ImageData(maskRGBA, r.provW, r.provH), 0, 0);
    const maskPng = await maskCanvas.convertToBlob({ type: 'image/png' });
    const maskBitmap = maskCanvas.transferToImageBitmap();
    timings.extra = Date.now() - t;

    const layerInfo = layers.map((L) => ({
      kind: L.kind,
      srcPxPerDeg: L.srcPxPerDeg,
      panoPxPerDeg: L.panoPxPerDeg,
      level: L.level,
    }));
    const buf = jpeg.buffer;
    return {
      jpeg: buf, maskPng, display, maskBitmap,
      stats: r.stats, seam, timings, totalMs: Date.now() - t0, W, H, layerInfo,
      _transfer: [buf, display, maskBitmap],
    };
  },
};

self.onmessage = async (e) => {
  const { type, reqId, payload } = e.data;
  const h = handlers[type];
  if (!h) return post({ type: 'error', reqId, message: 'Unbekannter Auftrag: ' + type });
  try {
    const res = await h(payload, reqId);
    const transfer = res._transfer || [];
    delete res._transfer;
    post({ type: 'result', reqId, result: res }, transfer);
  } catch (err) {
    post({ type: 'error', reqId, message: String((err && err.message) || err) });
  }
};
