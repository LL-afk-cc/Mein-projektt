// 360°-Viewer (WebGL 1) für equirektangulare Panoramen.
// Pro Bildschirmpixel wird die Blickrichtung berechnet und im Panorama nachgeschlagen –
// dadurch keine Kugel-Geometrie, keine Naht am 360°-Rand und saubere Pole.
// Diese Datei hat bewusst keine Imports: sie wird unverändert in die Offline-Viewer-HTML kopiert.

export class PanoViewer {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.yaw = opts.yaw ?? 0;
    this.pitch = opts.pitch ?? 0;
    this.fov = opts.fov ?? 80; // vertikales Sichtfeld in Grad
    this.minFov = 20;
    this.maxFov = 110;
    this.maskOpacity = 0;
    this.autoRotate = false;
    this.autoSpeed = 6; // Grad pro Sekunde
    this.gyro = false;
    this.onChange = null;
    this.hasImage = false;
    this._needs = true;
    this._last = 0;
    const gl = canvas.getContext('webgl', { antialias: false, preserveDrawingBuffer: true, alpha: false });
    if (!gl) throw new Error('WebGL ist in diesem Browser nicht verfügbar.');
    this.gl = gl;
    this.maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    this.extLod = gl.getExtension('EXT_shader_texture_lod');
    this.extDeriv = gl.getExtension('OES_standard_derivatives');
    this._initGL();
    this._bindInput();
    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);
  }

  _initGL() {
    const gl = this.gl;
    const useLod = !!(this.extLod && this.extDeriv);
    this.useMips = useLod;
    const vs = `attribute vec2 aPos; varying vec2 vPos; void main(){ vPos = aPos; gl_Position = vec4(aPos, 0.0, 1.0); }`;
    const fs = `${useLod ? '#extension GL_EXT_shader_texture_lod : enable\n#extension GL_OES_standard_derivatives : enable\n' : ''}
precision highp float;
uniform sampler2D uTex; uniform sampler2D uMask; uniform float uMaskA;
uniform mat3 uRot; uniform vec2 uTan; varying vec2 vPos;
const float PI = 3.14159265358979;
vec4 tex(sampler2D s, vec2 uv, vec2 dx, vec2 dy) {
${useLod ? '  return texture2DGradEXT(s, uv, dx, dy);' : '  return texture2D(s, uv);'}
}
void main() {
  vec3 c = normalize(vec3(vPos.x * uTan.x, vPos.y * uTan.y, 1.0));
  vec3 d = uRot * c;
  float lon = atan(d.x, d.z);
  float lat = asin(clamp(d.y, -1.0, 1.0));
  vec2 uv = vec2(lon / (2.0 * PI) + 0.5, 0.5 - lat / PI);
  vec2 dx = vec2(0.0), dy = vec2(0.0);
${useLod ? `  dx = dFdx(uv); dy = dFdy(uv);
  // Sprung am 360°-Rand ausgleichen, sonst falsche Mipmap-Stufe (sichtbare Linie)
  if (dx.x > 0.5) dx.x -= 1.0; else if (dx.x < -0.5) dx.x += 1.0;
  if (dy.x > 0.5) dy.x -= 1.0; else if (dy.x < -0.5) dy.x += 1.0;` : ''}
  vec4 col = tex(uTex, uv, dx, dy);
  if (uMaskA > 0.0) col.rgb = mix(col.rgb, tex(uMask, uv, dx, dy).rgb, uMaskA);
  gl_FragColor = vec4(col.rgb, 1.0);
}`;
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    gl.useProgram(p);
    this.prog = p;
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(p, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    this.uRot = gl.getUniformLocation(p, 'uRot');
    this.uTan = gl.getUniformLocation(p, 'uTan');
    this.uMaskA = gl.getUniformLocation(p, 'uMaskA');
    gl.uniform1i(gl.getUniformLocation(p, 'uTex'), 0);
    gl.uniform1i(gl.getUniformLocation(p, 'uMask'), 1);
    this.tex = this._makeTex(0);
    this.maskTex = this._makeTex(1);
    this._upload(this.maskTex, 1, this._solid(255, 255, 255));
  }

  _makeTex(unit) {
    const gl = this.gl;
    const t = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t);
    return t;
  }

  _solid(r, g, b) {
    const c = document.createElement('canvas');
    c.width = 2; c.height = 1;
    const x = c.getContext('2d');
    x.fillStyle = `rgb(${r},${g},${b})`;
    x.fillRect(0, 0, 2, 1);
    return c;
  }

  /** Verkleinert die Quelle, falls sie die maximale Texturgröße der Grafik übersteigt. */
  _fit(source) {
    const w = source.width, h = source.height;
    const max = this.maxTex;
    if (w <= max && h <= max) return source;
    const s = Math.min(max / w, max / h);
    const c = document.createElement('canvas');
    c.width = Math.max(2, Math.floor(w * s));
    c.height = Math.max(1, Math.floor(h * s));
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, 0, 0, c.width, c.height);
    return c;
  }

  _upload(tex, unit, source) {
    const gl = this.gl;
    const src = this._fit(source);
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, src);
    const pot = (n) => (n & (n - 1)) === 0;
    const isPot = pot(src.width) && pot(src.height);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, isPot ? gl.REPEAT : gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    if (isPot && this.useMips) {
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    } else {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    }
    return src;
  }

  /** Panorama setzen (Bild, Canvas, ImageBitmap). Gibt die tatsächlich genutzte Texturgröße zurück. */
  setImage(source) {
    const used = this._upload(this.tex, 0, source);
    this.hasImage = true;
    this.textureSize = [used.width, used.height];
    this.invalidate();
    return this.textureSize;
  }

  setMask(source) {
    this._upload(this.maskTex, 1, source || this._solid(255, 255, 255));
    this.invalidate();
  }

  setMaskOpacity(a) {
    this.maskOpacity = a;
    this.invalidate();
  }

  lookAt(yaw, pitch, fov) {
    this.yaw = yaw;
    this.pitch = Math.max(-89.9, Math.min(89.9, pitch));
    if (fov) this.fov = Math.max(this.minFov, Math.min(this.maxFov, fov));
    this.invalidate();
  }

  invalidate() { this._needs = true; }

  _rot() {
    const D = Math.PI / 180;
    if (this.gyroMatrix) return this.gyroMatrix;
    const a = this.yaw * D, b = this.pitch * D;
    const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b);
    // R = Ry(yaw) · Rx(pitch), zeilenweise – identisch zu rotationMatrix() in math.js (ohne Roll)
    return [ca, -sa * sb, sa * cb, 0, cb, sb, -sa, -ca * sb, ca * cb];
  }

  _draw() {
    const gl = this.gl, c = this.canvas;
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const w = Math.max(1, Math.round(c.clientWidth * dpr)), h = Math.max(1, Math.round(c.clientHeight * dpr));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    gl.viewport(0, 0, w, h);
    const R = this._rot();
    // GLSL erwartet spaltenweise Matrizen
    gl.uniformMatrix3fv(this.uRot, false, new Float32Array([R[0], R[3], R[6], R[1], R[4], R[7], R[2], R[5], R[8]]));
    const ty = Math.tan((this.fov * Math.PI) / 360);
    gl.uniform2f(this.uTan, ty * (w / h), ty);
    gl.uniform1f(this.uMaskA, this.maskOpacity);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    this._placeHotspots(R, ty * (w / h), ty);
  }

  /**
   * Antippbare Punkte im 360°-Bild (z. B. „Lenkrad – Detailfoto“).
   * list: [{ yaw, pitch, label, onClick }] – Richtung in Grad wie im Panorama (0/0 = Bildmitte).
   */
  setHotspots(list) {
    if (!this._hsLayer) {
      const layer = document.createElement('div');
      layer.className = 'pano-hotspots';
      layer.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;pointer-events:none;';
      const host = this.canvas.parentElement;
      if (getComputedStyle(host).position === 'static' && host !== document.body) host.style.position = 'relative';
      host.appendChild(layer);
      this._hsLayer = layer;
    }
    this._hsLayer.replaceChildren();
    const D = Math.PI / 180;
    this.hotspots = (list || []).map((h) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pano-hotspot';
      b.textContent = h.label;
      b.style.cssText = 'position:absolute;transform:translate(-50%,-50%);pointer-events:auto;white-space:nowrap;' +
        'background:rgba(20,20,20,.78);color:#fff;border:2px solid #2fd15a;border-radius:999px;padding:7px 12px;' +
        'font:600 14px system-ui,sans-serif;box-shadow:0 0 0 4px rgba(47,209,90,.25);cursor:pointer;';
      b.addEventListener('pointerdown', (e) => e.stopPropagation());
      b.addEventListener('click', (e) => { e.stopPropagation(); h.onClick && h.onClick(h); });
      this._hsLayer.appendChild(b);
      const a = h.yaw * D, p = h.pitch * D;
      return { ...h, el: b, dir: [Math.cos(p) * Math.sin(a), Math.sin(p), Math.cos(p) * Math.cos(a)] };
    });
    this.invalidate();
  }

  _placeHotspots(R, tx, ty) {
    if (!this.hotspots || !this.hotspots.length) return;
    const c = this.canvas;
    const W = c.clientWidth, H = c.clientHeight, ox = c.offsetLeft, oy = c.offsetTop;
    for (const h of this.hotspots) {
      const d = h.dir;
      // Kamera-Koordinaten = Rᵀ · d
      const cx = R[0] * d[0] + R[3] * d[1] + R[6] * d[2];
      const cy = R[1] * d[0] + R[4] * d[1] + R[7] * d[2];
      const cz = R[2] * d[0] + R[5] * d[1] + R[8] * d[2];
      const nx = cz > 0.05 ? cx / cz / tx : 9, ny = cz > 0.05 ? cy / cz / ty : 9;
      const vis = Math.abs(nx) < 0.92 && Math.abs(ny) < 0.88;
      h.el.style.display = vis ? '' : 'none';
      if (vis) {
        // Knopf ganz im Bild halten (Beschriftung nicht abschneiden)
        const half = (h.el.offsetWidth || 0) / 2 + 6;
        const x = Math.max(half, Math.min(W - half, ((nx + 1) / 2) * W));
        h.el.style.left = (ox + x) + 'px';
        h.el.style.top = (oy + ((1 - ny) / 2) * H) + 'px';
      }
    }
  }

  _loop(t) {
    const dt = this._last ? Math.min(0.1, (t - this._last) / 1000) : 0;
    this._last = t;
    if (this.autoRotate && !this._dragging && !this.gyro) {
      this.yaw += this.autoSpeed * dt;
      this._needs = true;
    }
    if (this.yaw > 180) this.yaw -= 360;
    if (this.yaw < -180) this.yaw += 360;
    if (this._needs || this.gyro) {
      this._needs = false;
      this._draw();
      if (this.onChange) this.onChange(this);
    }
    requestAnimationFrame(this._loop);
  }

  _bindInput() {
    const c = this.canvas;
    c.style.touchAction = 'none';
    const pts = new Map();
    let lastDist = 0, lastTap = 0;
    const degPerPx = () => this.fov / Math.max(1, c.clientHeight);
    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, [e.clientX, e.clientY]);
      this._dragging = true;
      if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        lastDist = Math.hypot(a[0] - b[0], a[1] - b[1]);
      }
      const now = Date.now();
      if (pts.size === 1 && now - lastTap < 300) { this.lookAt(this.yaw, 0, 80); }
      lastTap = now;
    });
    c.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId)) return;
      const prev = pts.get(e.pointerId);
      pts.set(e.pointerId, [e.clientX, e.clientY]);
      if (pts.size === 1) {
        if (this.gyro) return;
        const k = degPerPx();
        this.lookAt(this.yaw - (e.clientX - prev[0]) * k, this.pitch + (e.clientY - prev[1]) * k);
      } else if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        if (lastDist > 0) this.lookAt(this.yaw, this.pitch, this.fov * (lastDist / d));
        lastDist = d;
      }
    });
    const up = (e) => {
      pts.delete(e.pointerId);
      if (pts.size === 0) this._dragging = false;
      lastDist = 0;
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.lookAt(this.yaw, this.pitch, this.fov * Math.exp(e.deltaY * 0.001));
    }, { passive: false });
    window.addEventListener('resize', () => this.invalidate());
  }

  /** Bewegungssensor (Handy drehen = umsehen). Gibt false zurück, wenn nicht verfügbar. */
  async enableGyro(on) {
    if (!on) {
      this.gyro = false;
      this.gyroMatrix = null;
      if (this._gyroHandler) window.removeEventListener('deviceorientation', this._gyroHandler);
      this.invalidate();
      return true;
    }
    if (typeof DeviceOrientationEvent === 'undefined') return false;
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
      try {
        if ((await DeviceOrientationEvent.requestPermission()) !== 'granted') return false;
      } catch { return false; }
    }
    let offset = null;
    this._gyroHandler = (e) => {
      if (e.alpha == null) return;
      const C = deviceCameraR(e.alpha, e.beta, e.gamma, screenAngle());
      const fwdYaw = Math.atan2(C[2], C[8]) * 180 / Math.PI;
      if (offset === null) offset = this.yaw - fwdYaw;
      const o = offset * Math.PI / 180, co = Math.cos(o), so = Math.sin(o);
      const ry = (v) => [co * v[0] + so * v[2], v[1], -so * v[0] + co * v[2]];
      const r = ry([C[0], C[3], C[6]]), u = ry([C[1], C[4], C[7]]), f = ry([C[2], C[5], C[8]]);
      this.gyroMatrix = [r[0], u[0], f[0], r[1], u[1], f[1], r[2], u[2], f[2]];
      this.yaw = Math.atan2(f[0], f[2]) * 180 / Math.PI;
      this.pitch = Math.asin(Math.max(-1, Math.min(1, f[1]))) * 180 / Math.PI;
      this._needs = true;
    };
    window.addEventListener('deviceorientation', this._gyroHandler);
    this.gyro = true;
    return true;
  }
}

/**
 * Kamera-Drehmatrix (zeilenweise, unsere Konvention: Spalten = rechts, oben, Blickrichtung)
 * der Rückkamera aus der Geräteausrichtung (deviceorientation alpha/beta/gamma, Grad).
 * Hochkant gehalten und geradeaus gerichtet ergibt das Nick 0 / Roll 0.
 */
export function deviceCameraR(alpha, beta, gamma, orient = 0) {
  const M = deviceMatrix(alpha, beta, gamma, orient);
  // three.js-Welt → unsere Welt: z spiegeln; Kamera blickt in three.js entlang −z
  const right = [M[0], M[3], -M[6]], up = [M[1], M[4], -M[7]], fwd = [-M[2], -M[5], M[8]];
  return [right[0], up[0], fwd[0], right[1], up[1], fwd[1], right[2], up[2], fwd[2]];
}

export function screenAngle() {
  const o = (screen.orientation && screen.orientation.angle) ?? window.orientation ?? 0;
  return Number(o) || 0;
}

// Geräteausrichtung → Kamera-Drehmatrix (wie three.js DeviceOrientationControls), zeilenweise.
function deviceMatrix(alpha, beta, gamma, orient) {
  const D = Math.PI / 180;
  const q = eulerYXZToQuat(beta * D, alpha * D, -gamma * D);
  const q1 = [-Math.SQRT1_2, 0, 0, Math.SQRT1_2]; // -90° um X
  let r = quatMul(q, q1);
  const h = (-orient * D) / 2;
  r = quatMul(r, [0, 0, Math.sin(h), Math.cos(h)]);
  return quatToMat(r);
}

function eulerYXZToQuat(x, y, z) {
  const c1 = Math.cos(x / 2), c2 = Math.cos(y / 2), c3 = Math.cos(z / 2);
  const s1 = Math.sin(x / 2), s2 = Math.sin(y / 2), s3 = Math.sin(z / 2);
  return [
    s1 * c2 * c3 + c1 * s2 * s3,
    c1 * s2 * c3 - s1 * c2 * s3,
    c1 * c2 * s3 - s1 * s2 * c3,
    c1 * c2 * c3 + s1 * s2 * s3,
  ];
}

function quatMul(a, b) {
  const [ax, ay, az, aw] = a, [bx, by, bz, bw] = b;
  return [
    ax * bw + aw * bx + ay * bz - az * by,
    ay * bw + aw * by + az * bx - ax * bz,
    az * bw + aw * bz + ax * by - ay * bx,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

function quatToMat([x, y, z, w]) {
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
    2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
    2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y),
  ];
}
