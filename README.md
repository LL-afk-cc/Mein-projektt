# Auto360 Innenraum

Handy-Web-App (PWA), die eine 360°×180°-Innenraumansicht (equirektangular, bis 8192×4096)
„aus der Mitte“ erstellt – vollständig lokal im Browser, ohne Server und ohne KI.
Empfohlen: geführte **Rundumaufnahme** (24 Fotos von einem Standpunkt, Bewegungssensor + Bildvergleich).
Alternativ: vorhandene Verkaufsfotos (Cockpit als Original-Anker, Rest aufgefüllt).

**Bedienungs- und Installationsanleitung für Anwender: [ANLEITUNG.md](ANLEITUNG.md)**

## Prinzip

**Rundumaufnahme:** Live-Kamera + `deviceorientation` → Zielführung und Auto-Auslösen nach festem Plan
(10 + 6 + 6 + Zenit + Nadir). Feinausrichtung (`align.js`): Kamera-Sichtfeld über den Ringschluss der
horizontalen Fotos (Sekantenverfahren), paarweise Vollsuche der relativen Drehungen auf Tangentialebenen
(normierte Kreuzkorrelation, 3 Auflösungsstufen), robuste Drehungs-Mittelung (IRLS, Cauchy), Gesamtlage
per Procrustes an alle Sensorwerte, Helligkeitsangleich (Brown & Lowe). Überblendung mit Gewicht
α·cos(θ)^p. Unbrauchbarer Bildvergleich → Sensorwerte bleiben.

**Einzelfotos:**

- Das Cockpit-Gesamtfoto wird als **Original-Anker** per reiner Drehung (Lochkamera, Gier/Nick/Roll/Sichtfeld)
  in die Kugel projiziert. Seine Pixel sind nie mit etwas anderem vermischt.
- Weitere Fotos können als **Inseln** in eine Richtung gelegt werden (Lage nur ungefähr, da nicht aus der Mitte aufgenommen).
  Eine geometrische Überdeckungsprüfung warnt vor möglichen Doppelungen.
- Nicht fotografierte Richtungen werden per **Pull-Push** + latitudenabhängiger Unschärfe nahtlos aufgefüllt
  (360°-Umlauf, einheitliche Pole) und in der **Herkunftsmaske** rot markiert.
- Export: eigener JPEG-Encoder (4:4:4, GPano-XMP), eigenständige Offline-Viewer-HTML.

## Aufbau

```
app/                    Die Web-App (wird so wie sie ist veröffentlicht)
  index.html, styles.css, manifest.webmanifest, sw.js, icons/
  js/math.js            Kugel-/Kamerageometrie
  js/compose.js         Projektion, Auffüllung, Panorama-Rendern, Maske, Naht- und Überdeckungsprüfung
  js/estimate.js        Anker-Vorschlag, Roll-Schätzung
  js/capture.js         Geführte Rundumaufnahme (Kamera, Bewegungssensor, Zielführung)
  js/capture-plan.js    Aufnahmeplan (24 Richtungen), Sichtfeld-Schätzung
  js/align.js           Feinausrichtung der Rundumfotos, Sichtfeld, Helligkeitsangleich
  js/jpeg.js            JPEG-Encoder 4:4:4 + GPano-XMP
  js/viewer.js          WebGL-360°-Viewer (Touch, Zoom, Bewegungssensor, Maske)
  js/viewer-export.js   Offline-Viewer-HTML
  js/worker.js          Rechen-Worker (Dekodieren, Vorschau, Erstellen)
  js/store.js           IndexedDB-Zwischenspeicher (Wiederaufnahme)
  js/app.js             Oberfläche
tests/unit.test.mjs     Komponententests (Node ≥ 22, ohne Browser)
tests/e2e.mjs           Gesamttest Einzelfotos mit Playwright/Chromium (Pixel-7-Emulation) und testdaten/
tests/e2e-rundum.mjs    Gesamttest Rundumaufnahme (Testkamera, simulierter Sensor, virtuelle Aufnahmen)
testdaten/              6 Beispielfotos (VW Golf 7 Variant)
.github/workflows/pages.yml  Tests + Veröffentlichung auf GitHub Pages
```

## Entwicklung

```bash
node --test tests/unit.test.mjs          # Komponententests
python3 -m http.server 8765 --directory app   # App lokal unter http://127.0.0.1:8765/
node tests/e2e.mjs http://127.0.0.1:8765/ tests/out 8192   # Gesamttest Einzelfotos (braucht Playwright)
python3 -m http.server 8766              # im Projektordner (Test braucht testdaten/)
node tests/e2e-rundum.mjs http://127.0.0.1:8766/app/ tests/out   # Gesamttest Rundumaufnahme
```

Kein Build-Schritt, keine Abhängigkeiten zur Laufzeit.
