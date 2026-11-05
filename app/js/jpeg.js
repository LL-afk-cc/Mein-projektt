// Baseline-JPEG-Encoder mit 4:4:4 (keine Farbunterabtastung) und eingebetteten
// GPano-XMP-Metadaten, damit Facebook/Google/Viewer das Bild als 360° erkennen.
// Der Browser-eigene Encoder (canvas.toBlob) erlaubt weder 4:4:4 noch XMP – deshalb eigen.

const ZIGZAG = [
  0, 1, 5, 6, 14, 15, 27, 28, 2, 4, 7, 13, 16, 26, 29, 42, 3, 8, 12, 17, 25, 30, 41, 43, 9, 11, 18,
  24, 31, 40, 44, 53, 10, 19, 23, 32, 39, 45, 52, 54, 20, 22, 33, 38, 46, 51, 55, 60, 21, 34, 37,
  47, 50, 56, 59, 61, 35, 36, 48, 49, 57, 58, 62, 63,
];
const YQT = [
  16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56,
  14, 17, 22, 29, 51, 87, 80, 62, 18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113,
  92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99,
];
const UVQT = [
  17, 18, 24, 47, 99, 99, 99, 99, 18, 21, 26, 66, 99, 99, 99, 99, 24, 26, 56, 99, 99, 99, 99, 99,
  47, 66, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99,
];
const DC_LUM_CODES = [0, 0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0];
const DC_LUM_VALS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const AC_LUM_CODES = [0, 0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7d];
const AC_LUM_VALS = [
  0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07,
  0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xa1, 0x08, 0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0,
  0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28,
  0x29, 0x2a, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49,
  0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69,
  0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89,
  0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7,
  0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5,
  0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2,
  0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8,
  0xf9, 0xfa,
];
const DC_CHR_CODES = [0, 0, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0];
const DC_CHR_VALS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const AC_CHR_CODES = [0, 0, 2, 1, 2, 4, 4, 3, 4, 7, 5, 4, 4, 0, 1, 2, 0x77];
const AC_CHR_VALS = [
  0x00, 0x01, 0x02, 0x03, 0x11, 0x04, 0x05, 0x21, 0x31, 0x06, 0x12, 0x41, 0x51, 0x07, 0x61, 0x71,
  0x13, 0x22, 0x32, 0x81, 0x08, 0x14, 0x42, 0x91, 0xa1, 0xb1, 0xc1, 0x09, 0x23, 0x33, 0x52, 0xf0,
  0x15, 0x62, 0x72, 0xd1, 0x0a, 0x16, 0x24, 0x34, 0xe1, 0x25, 0xf1, 0x17, 0x18, 0x19, 0x1a, 0x26,
  0x27, 0x28, 0x29, 0x2a, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48,
  0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68,
  0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87,
  0x88, 0x89, 0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5,
  0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3,
  0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda,
  0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8,
  0xf9, 0xfa,
];
const AASF = [1.0, 1.387039845, 1.306562965, 1.175875602, 1.0, 0.785694958, 0.5411961, 0.275899379];

function huffTable(codes, vals) {
  const ht = [];
  let code = 0, pos = 0;
  for (let k = 1; k <= 16; k++) {
    for (let j = 1; j <= codes[k]; j++) {
      ht[vals[pos]] = [code, k];
      pos++;
      code++;
    }
    code *= 2;
  }
  return ht;
}

const HT_YDC = huffTable(DC_LUM_CODES, DC_LUM_VALS);
const HT_YAC = huffTable(AC_LUM_CODES, AC_LUM_VALS);
const HT_UVDC = huffTable(DC_CHR_CODES, DC_CHR_VALS);
const HT_UVAC = huffTable(AC_CHR_CODES, AC_CHR_VALS);

// Kategorie und Bitcode für Werte -32767..32767
const CATEGORY = new Uint8Array(65535);
const BITLEN = new Uint8Array(65535);
const BITVAL = new Uint16Array(65535);
(function initCategory() {
  let lo = 1, hi = 2;
  for (let cat = 1; cat <= 15; cat++) {
    for (let nr = lo; nr < hi; nr++) {
      CATEGORY[32767 + nr] = cat;
      BITLEN[32767 + nr] = cat;
      BITVAL[32767 + nr] = nr;
    }
    for (let nr = -(hi - 1); nr <= -lo; nr++) {
      CATEGORY[32767 + nr] = cat;
      BITLEN[32767 + nr] = cat;
      BITVAL[32767 + nr] = hi - 1 + nr;
    }
    lo <<= 1;
    hi <<= 1;
  }
})();

function scaledTables(quality) {
  const q = Math.max(1, Math.min(100, Math.round(quality)));
  const sf = q < 50 ? Math.floor(5000 / q) : Math.floor(200 - q * 2);
  const YT = new Uint8Array(64), UVT = new Uint8Array(64);
  for (let i = 0; i < 64; i++) {
    YT[ZIGZAG[i]] = Math.min(255, Math.max(1, Math.floor((YQT[i] * sf + 50) / 100)));
    UVT[ZIGZAG[i]] = Math.min(255, Math.max(1, Math.floor((UVQT[i] * sf + 50) / 100)));
  }
  const fdY = new Float32Array(64), fdUV = new Float32Array(64);
  let k = 0;
  for (let row = 0; row < 8; row++)
    for (let col = 0; col < 8; col++) {
      fdY[k] = 1 / (YT[ZIGZAG[k]] * AASF[row] * AASF[col] * 8);
      fdUV[k] = 1 / (UVT[ZIGZAG[k]] * AASF[row] * AASF[col] * 8);
      k++;
    }
  return { YT, UVT, fdY, fdUV };
}

class ByteWriter {
  constructor(size) {
    this.buf = new Uint8Array(size);
    this.pos = 0;
    this.bitBuf = 0;
    this.bitCnt = 0;
  }
  ensure(n) {
    if (this.pos + n <= this.buf.length) return;
    let len = this.buf.length * 2;
    while (len < this.pos + n) len *= 2;
    const nb = new Uint8Array(len);
    nb.set(this.buf.subarray(0, this.pos));
    this.buf = nb;
  }
  byte(b) {
    this.ensure(1);
    this.buf[this.pos++] = b;
  }
  word(w) {
    this.ensure(2);
    this.buf[this.pos++] = (w >> 8) & 0xff;
    this.buf[this.pos++] = w & 0xff;
  }
  bytes(arr) {
    this.ensure(arr.length);
    this.buf.set(arr, this.pos);
    this.pos += arr.length;
  }
  bits(code, len) {
    // code: Wert, len: Anzahl Bits (MSB zuerst)
    this.bitBuf = (this.bitBuf << len) | (code & ((1 << len) - 1));
    this.bitCnt += len;
    while (this.bitCnt >= 8) {
      const b = (this.bitBuf >> (this.bitCnt - 8)) & 0xff;
      this.ensure(2);
      this.buf[this.pos++] = b;
      if (b === 0xff) this.buf[this.pos++] = 0;
      this.bitCnt -= 8;
      this.bitBuf &= (1 << this.bitCnt) - 1;
    }
  }
  flushBits() {
    if (this.bitCnt > 0) this.bits((1 << (8 - this.bitCnt)) - 1, 8 - this.bitCnt);
  }
  result() {
    return this.buf.slice(0, this.pos);
  }
}

function fdctQuant(d, fd, out) {
  for (let off = 0; off < 64; off += 8) {
    const d0 = d[off], d1 = d[off + 1], d2 = d[off + 2], d3 = d[off + 3];
    const d4 = d[off + 4], d5 = d[off + 5], d6 = d[off + 6], d7 = d[off + 7];
    const t0 = d0 + d7, t7 = d0 - d7, t1 = d1 + d6, t6 = d1 - d6;
    const t2 = d2 + d5, t5 = d2 - d5, t3 = d3 + d4, t4 = d3 - d4;
    let t10 = t0 + t3;
    const t13 = t0 - t3;
    let t11 = t1 + t2;
    let t12 = t1 - t2;
    d[off] = t10 + t11;
    d[off + 4] = t10 - t11;
    const z1 = (t12 + t13) * 0.707106781;
    d[off + 2] = t13 + z1;
    d[off + 6] = t13 - z1;
    t10 = t4 + t5;
    t11 = t5 + t6;
    t12 = t6 + t7;
    const z5 = (t10 - t12) * 0.382683433;
    const z2 = 0.5411961 * t10 + z5;
    const z4 = 1.306562965 * t12 + z5;
    const z3 = t11 * 0.707106781;
    const z11 = t7 + z3, z13 = t7 - z3;
    d[off + 5] = z13 + z2;
    d[off + 3] = z13 - z2;
    d[off + 1] = z11 + z4;
    d[off + 7] = z11 - z4;
  }
  for (let off = 0; off < 8; off++) {
    const d0 = d[off], d1 = d[off + 8], d2 = d[off + 16], d3 = d[off + 24];
    const d4 = d[off + 32], d5 = d[off + 40], d6 = d[off + 48], d7 = d[off + 56];
    const t0 = d0 + d7, t7 = d0 - d7, t1 = d1 + d6, t6 = d1 - d6;
    const t2 = d2 + d5, t5 = d2 - d5, t3 = d3 + d4, t4 = d3 - d4;
    let t10 = t0 + t3;
    const t13 = t0 - t3;
    let t11 = t1 + t2;
    let t12 = t1 - t2;
    d[off] = t10 + t11;
    d[off + 32] = t10 - t11;
    const z1 = (t12 + t13) * 0.707106781;
    d[off + 16] = t13 + z1;
    d[off + 48] = t13 - z1;
    t10 = t4 + t5;
    t11 = t5 + t6;
    t12 = t6 + t7;
    const z5 = (t10 - t12) * 0.382683433;
    const z2 = 0.5411961 * t10 + z5;
    const z4 = 1.306562965 * t12 + z5;
    const z3 = t11 * 0.707106781;
    const z11 = t7 + z3, z13 = t7 - z3;
    d[off + 40] = z13 + z2;
    d[off + 24] = z13 - z2;
    d[off + 8] = z11 + z4;
    d[off + 56] = z11 - z4;
  }
  for (let i = 0; i < 64; i++) {
    const v = d[i] * fd[i];
    out[ZIGZAG[i]] = v > 0 ? Math.floor(v + 0.5) : Math.ceil(v - 0.5);
  }
}

function encodeBlock(w, blk, fd, dc, htdc, htac, du) {
  fdctQuant(blk, fd, du);
  const diff = du[0] - dc;
  if (diff === 0) {
    w.bits(htdc[0][0], htdc[0][1]);
  } else {
    const p = 32767 + diff;
    const h = htdc[CATEGORY[p]];
    w.bits(h[0], h[1]);
    w.bits(BITVAL[p], BITLEN[p]);
  }
  let end = 63;
  while (end > 0 && du[end] === 0) end--;
  if (end === 0) {
    w.bits(htac[0x00][0], htac[0x00][1]);
    return du[0];
  }
  let i = 1;
  while (i <= end) {
    const start = i;
    while (du[i] === 0 && i <= end) i++;
    let zeros = i - start;
    if (zeros >= 16) {
      const n = zeros >> 4;
      for (let m = 0; m < n; m++) w.bits(htac[0xf0][0], htac[0xf0][1]);
      zeros &= 15;
    }
    const p = 32767 + du[i];
    const h = htac[(zeros << 4) + CATEGORY[p]];
    w.bits(h[0], h[1]);
    w.bits(BITVAL[p], BITLEN[p]);
    i++;
  }
  if (end !== 63) w.bits(htac[0x00][0], htac[0x00][1]);
  return du[0];
}

export function gpanoXmp(width, height, extra = {}) {
  const attrs = {
    'GPano:ProjectionType': 'equirectangular',
    'GPano:UsePanoramaViewer': 'True',
    'GPano:FullPanoWidthPixels': width,
    'GPano:FullPanoHeightPixels': height,
    'GPano:CroppedAreaImageWidthPixels': width,
    'GPano:CroppedAreaImageHeightPixels': height,
    'GPano:CroppedAreaLeftPixels': 0,
    'GPano:CroppedAreaTopPixels': 0,
    'GPano:PoseHeadingDegrees': 0,
    'GPano:InitialViewHeadingDegrees': 0,
    'GPano:InitialViewPitchDegrees': 0,
    'GPano:InitialHorizontalFOVDegrees': 90,
    'GPano:StitchingSoftware': 'Auto360 Handy',
    ...extra,
  };
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const a = Object.entries(attrs).map(([k, v]) => ` ${k}="${esc(v)}"`).join('');
  return (
    '<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>' +
    '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
    `<rdf:Description rdf:about="" xmlns:GPano="http://ns.google.com/photos/1.0/panorama/"${a}/>` +
    '</rdf:RDF></x:xmpmeta><?xpacket end="w"?>'
  );
}

/**
 * Kodiert RGBA-Pixel als JPEG (4:4:4).
 * @param {{width:number,height:number,data:Uint8ClampedArray|Uint8Array}} img
 * @param {{quality?:number, xmp?:string, onProgress?:(f:number)=>void}} opts
 * @returns {Uint8Array}
 */
export function encodeJpeg(img, opts = {}) {
  const { width: W, height: H, data } = img;
  const quality = opts.quality ?? 96;
  const { YT, UVT, fdY, fdUV } = scaledTables(quality);
  const w = new ByteWriter(Math.max(1 << 16, Math.floor(W * H * 0.6)));

  w.word(0xffd8);
  // APP0 JFIF
  w.word(0xffe0);
  w.word(16);
  w.bytes([0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
  // APP1 XMP
  if (opts.xmp) {
    const ns = new TextEncoder().encode('http://ns.adobe.com/xap/1.0/\0');
    const body = new TextEncoder().encode(opts.xmp);
    const len = 2 + ns.length + body.length;
    if (len > 65535) throw new Error('XMP zu groß');
    w.word(0xffe1);
    w.word(len);
    w.bytes(ns);
    w.bytes(body);
  }
  // DQT
  w.word(0xffdb);
  w.word(132);
  w.byte(0);
  w.bytes(YT);
  w.byte(1);
  w.bytes(UVT);
  // SOF0 – alle Komponenten 1×1 => 4:4:4
  w.word(0xffc0);
  w.word(17);
  w.byte(8);
  w.word(H);
  w.word(W);
  w.byte(3);
  w.bytes([1, 0x11, 0, 2, 0x11, 1, 3, 0x11, 1]);
  // DHT
  w.word(0xffc4);
  w.word(0x01a2);
  const dht = (cls, codes, vals) => {
    w.byte(cls);
    for (let i = 1; i <= 16; i++) w.byte(codes[i]);
    w.bytes(vals);
  };
  dht(0x00, DC_LUM_CODES, DC_LUM_VALS);
  dht(0x10, AC_LUM_CODES, AC_LUM_VALS);
  dht(0x01, DC_CHR_CODES, DC_CHR_VALS);
  dht(0x11, AC_CHR_CODES, AC_CHR_VALS);
  // SOS
  w.word(0xffda);
  w.word(12);
  w.bytes([3, 1, 0, 2, 0x11, 3, 0x11, 0, 0x3f, 0]);

  const Yb = new Float32Array(64), Ub = new Float32Array(64), Vb = new Float32Array(64);
  const du = new Int32Array(64);
  let dcY = 0, dcU = 0, dcV = 0;
  const rows = Math.ceil(H / 8);
  for (let by = 0; by < H; by += 8) {
    for (let bx = 0; bx < W; bx += 8) {
      for (let k = 0; k < 64; k++) {
        const y = Math.min(H - 1, by + (k >> 3));
        const x = Math.min(W - 1, bx + (k & 7));
        const p = (y * W + x) * 4;
        const r = data[p], g = data[p + 1], b = data[p + 2];
        Yb[k] = 0.299 * r + 0.587 * g + 0.114 * b - 128;
        Ub[k] = -0.16874 * r - 0.33126 * g + 0.5 * b;
        Vb[k] = 0.5 * r - 0.41869 * g - 0.08131 * b;
      }
      dcY = encodeBlock(w, Yb, fdY, dcY, HT_YDC, HT_YAC, du);
      dcU = encodeBlock(w, Ub, fdUV, dcU, HT_UVDC, HT_UVAC, du);
      dcV = encodeBlock(w, Vb, fdUV, dcV, HT_UVDC, HT_UVAC, du);
    }
    if (opts.onProgress && (by >> 3) % 16 === 0) opts.onProgress((by >> 3) / rows);
  }
  w.flushBits();
  w.word(0xffd9);
  if (opts.onProgress) opts.onProgress(1);
  return w.result();
}
