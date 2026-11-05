// Erzeugt eine eigenständige HTML-Datei mit eingebettetem Panorama + Herkunftsmaske.
// Funktioniert offline per Doppelklick bzw. Antippen, ohne Server, Maus und Touch.

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export async function buildViewerHtml({ jpegBlob, maskBlob, title, viewerSource }) {
  const img = await blobToBase64(jpegBlob);
  const mask = maskBlob ? await blobToBase64(maskBlob) : '';
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
  window.__viewer = v;
})();
</script></body></html>`;
}
