// Erzeugt eine eigenständige HTML-Datei mit eingebettetem Panorama + Herkunftsmaske.
// Funktioniert offline per Doppelklick bzw. Antippen, ohne Server, Maus und Touch.
// Optional: Detail-Punkte im 360°-Bild, die ein Originalfoto in voller Auflösung öffnen
// (z. B. Lenkrad-Nahaufnahme, damit alle Tasten lesbar sind).

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/**
 * @param details [{ yaw, pitch, label, blob }] – Richtung in Grad im Panorama, Beschriftung, Originalfoto
 */
export async function buildViewerHtml({ jpegBlob, maskBlob, title, viewerSource, details = [] }) {
  const img = await blobToBase64(jpegBlob);
  const mask = maskBlob ? await blobToBase64(maskBlob) : '';
  const det = [];
  for (const d of details) det.push({ yaw: d.yaw, pitch: d.pitch, label: String(d.label), type: d.blob.type || 'image/jpeg', b64: await blobToBase64(d.blob) });
  const detJson = JSON.stringify(det).replace(/</g, '\\u003c');
  const code = viewerSource.replace(/^export\s+/gm, '');
  const t = esc(title || '360°-Innenraum');
  return `<!doctype html>
<html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${t}</title>
<style>
:root{--bg:#111;--fg:#f2f2f2;--btn:rgba(20,20,20,.72);--acc:#2f9e44}
html,body{margin:0;height:100%;background:var(--bg);color:var(--fg);font:15px/1.3 system-ui,sans-serif;overflow:hidden}
canvas{position:fixed;inset:0;width:100%;height:100%;display:block}
.bar{position:fixed;left:0;right:0;bottom:0;display:flex;gap:6px;justify-content:center;flex-wrap:wrap;padding:10px 12px calc(10px + env(safe-area-inset-bottom))}
button{background:var(--btn);color:var(--fg);border:1px solid rgba(255,255,255,.25);border-radius:10px;padding:9px 12px;font:inherit;min-height:42px}
button[aria-pressed=true]{background:var(--acc);border-color:var(--acc)}
.title{position:fixed;top:0;left:0;right:0;padding:10px 14px;background:linear-gradient(#000a,#0000);font-weight:600}
.legend{position:fixed;top:44px;left:12px;background:var(--btn);padding:8px 10px;border-radius:8px;font-size:13px;display:none}
.legend i{display:inline-block;width:11px;height:11px;border-radius:2px;margin-right:6px;vertical-align:-1px}
.err{position:fixed;inset:0;display:none;align-items:center;justify-content:center;padding:24px;text-align:center}
.detail{position:fixed;inset:0;background:#000;z-index:10;touch-action:none;overflow:hidden}
.detail[hidden]{display:none}
.detail img{position:absolute;left:0;top:0;transform-origin:0 0;max-width:none;user-select:none;-webkit-user-drag:none}
.dtop{position:absolute;top:0;left:0;right:0;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:calc(8px + env(safe-area-inset-top)) 12px 8px;background:linear-gradient(#000c,#0000);font-weight:600}
.dhint{position:absolute;bottom:calc(14px + env(safe-area-inset-bottom));left:0;right:0;text-align:center;font-size:13px;opacity:.85;text-shadow:0 1px 2px #000}
</style></head><body>
<canvas id="c"></canvas>
<div class="title">${t}</div>
<div class="legend" id="legend"><div><i style="background:#1ebe3c"></i>Originalfoto (Anker bzw. Rundumfoto)</div><div><i style="background:#aad228"></i>Originalfoto (Insel, ungefähre Lage)</div><div><i style="background:#dc2828"></i>Aufgefüllt (nicht fotografiert)</div></div>
<div class="bar">
<button id="rot" aria-pressed="false">Auto-Drehen</button>
<button id="mask" aria-pressed="false">Herkunft</button>
<button id="gyro" aria-pressed="false">Bewegung</button>
<button id="zin">＋</button><button id="zout">－</button>
<button id="fs">Vollbild</button>
</div>
<div class="detail" id="detail" hidden><img id="dimg" alt=""><div class="dtop"><span id="dlabel"></span><button id="dclose">✕ Zurück zum 360°-Bild</button></div><div class="dhint">Originalfoto in voller Auflösung · zwei Finger oder Doppeltippen zum Vergrößern</div></div>
<div class="err" id="err">WebGL ist auf diesem Gerät nicht verfügbar. Das Panorama kann trotzdem als Bild geöffnet werden.</div>
<script>
${code}
(function(){
  var v;
  try { v = new PanoViewer(document.getElementById('c'), {pitch:-5, fov:80}); }
  catch(e){ document.getElementById('err').style.display='flex'; return; }
  var img = new Image();
  img.onload = function(){ v.setImage(img); };
  img.src = 'data:image/jpeg;base64,${img}';
  var hasMask = ${mask ? 'true' : 'false'};
  if (hasMask) { var m = new Image(); m.onload = function(){ v.setMask(m); }; m.src = 'data:image/png;base64,${mask}'; }
  else document.getElementById('mask').style.display='none';
  function tog(id, fn){ var b=document.getElementById(id); b.onclick=function(){ var on=b.getAttribute('aria-pressed')!=='true'; Promise.resolve(fn(on)).then(function(ok){ b.setAttribute('aria-pressed', String(ok===false?false:on)); }); }; }
  tog('rot', function(on){ v.autoRotate = on; });
  tog('mask', function(on){ v.setMaskOpacity(on?0.45:0); document.getElementById('legend').style.display = on?'block':'none'; });
  tog('gyro', function(on){ return v.enableGyro(on); });
  document.getElementById('zin').onclick=function(){ v.lookAt(v.yaw, v.pitch, v.fov/1.25); };
  document.getElementById('zout').onclick=function(){ v.lookAt(v.yaw, v.pitch, v.fov*1.25); };
  document.getElementById('fs').onclick=function(){ var d=document.documentElement; if(!document.fullscreenElement){ (d.requestFullscreen||d.webkitRequestFullscreen||function(){}).call(d); } else document.exitFullscreen(); };
  // ---- Detail-Punkte: Originalfoto in voller Auflösung mit Zoom
  var details = ${detJson};
  var box = document.getElementById('detail'), dimg = document.getElementById('dimg');
  var z = { s: 1, x: 0, y: 0, base: 1 };
  function apply() {
    var W = box.clientWidth, H = box.clientHeight, iw = dimg.naturalWidth * z.base * z.s, ih = dimg.naturalHeight * z.base * z.s;
    z.x = iw <= W ? (W - iw) / 2 : Math.min(0, Math.max(W - iw, z.x));
    z.y = ih <= H ? (H - ih) / 2 : Math.min(0, Math.max(H - ih, z.y));
    dimg.style.transform = 'translate(' + z.x + 'px,' + z.y + 'px) scale(' + (z.base * z.s) + ')';
  }
  function zoomAt(f, px, py) {
    var ns = Math.max(1, Math.min(8, z.s * f)); f = ns / z.s;
    z.x = px - (px - z.x) * f; z.y = py - (py - z.y) * f; z.s = ns; apply();
  }
  function openDetail(d) {
    document.getElementById('dlabel').textContent = d.label;
    dimg.onload = function () { z.base = Math.min(box.clientWidth / dimg.naturalWidth, box.clientHeight / dimg.naturalHeight); z.s = 1; z.x = 0; z.y = 0; apply(); };
    box.hidden = false;
    dimg.src = 'data:' + d.type + ';base64,' + d.b64;
  }
  document.getElementById('dclose').onclick = function () { box.hidden = true; dimg.removeAttribute('src'); };
  var pts = {}, last = 0, lastD = 0;
  box.addEventListener('pointerdown', function (e) {
    if (e.target.id === 'dclose') return;
    box.setPointerCapture(e.pointerId); pts[e.pointerId] = [e.clientX, e.clientY];
    var now = Date.now();
    if (Object.keys(pts).length === 1 && now - last < 300) zoomAt(z.s > 1.5 ? 1 / z.s : 3, e.clientX, e.clientY);
    last = now; lastD = 0;
  });
  box.addEventListener('pointermove', function (e) {
    if (!pts[e.pointerId]) return;
    var p = pts[e.pointerId], k = Object.keys(pts);
    if (k.length === 1) { z.x += e.clientX - p[0]; z.y += e.clientY - p[1]; pts[e.pointerId] = [e.clientX, e.clientY]; apply(); return; }
    pts[e.pointerId] = [e.clientX, e.clientY];
    var a = pts[k[0]], b = pts[k[1]], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
    if (lastD) zoomAt(d / lastD, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
    lastD = d;
  });
  function up(e) { delete pts[e.pointerId]; lastD = 0; }
  box.addEventListener('pointerup', up); box.addEventListener('pointercancel', up);
  box.addEventListener('wheel', function (e) { e.preventDefault(); zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY); }, { passive: false });
  window.addEventListener('resize', function () { if (!box.hidden && dimg.naturalWidth) { z.base = Math.min(box.clientWidth / dimg.naturalWidth, box.clientHeight / dimg.naturalHeight); apply(); } });
  if (details.length && v.setHotspots) v.setHotspots(details.map(function (d) { return { yaw: d.yaw, pitch: d.pitch, label: d.label, onClick: function () { openDetail(d); } }; }));
  window.__viewer = v;
  window.__openDetail = function (i) { openDetail(details[i]); };
  window.__zoomDetail = function (f, x, y) { zoomAt(f, x, y); };
})();
</script></body></html>`;
}
