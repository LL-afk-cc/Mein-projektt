# Auto360 Innenraum

Handy-Web-App (PWA), die aus normalen Verkaufsfotos eines Fahrzeug-Innenraums eine
360°×180°-Ansicht (equirektangular, bis 8192×4096) „aus der Mitte“ erstellt –
vollständig lokal im Browser, ohne Server und ohne KI.

**Bedienungs- und Installationsanleitung für Anwender: [ANLEITUNG.md](ANLEITUNG.md)**

## Prinzip

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
  js/jpeg.js            JPEG-Encoder 4:4:4 + GPano-XMP
  js/viewer.js          WebGL-360°-Viewer (Touch, Zoom, Bewegungssensor, Maske)
  js/viewer-export.js   Offline-Viewer-HTML
  js/worker.js          Rechen-Worker (Dekodieren, Vorschau, Erstellen)
  js/store.js           IndexedDB-Zwischenspeicher (Wiederaufnahme)
  js/app.js             Oberfläche
tests/unit.test.mjs     Komponententests (Node ≥ 22, ohne Browser)
tests/e2e.mjs           Gesamttest mit Playwright/Chromium (Pixel-7-Emulation) und testdaten/
testdaten/              6 Beispielfotos (VW Golf 7 Variant)
.github/workflows/pages.yml  Tests + Veröffentlichung auf GitHub Pages
```

## Entwicklung

```bash
node --test tests/unit.test.mjs          # Komponententests
python3 -m http.server 8765 --directory app   # App lokal unter http://127.0.0.1:8765/
node tests/e2e.mjs http://127.0.0.1:8765/ tests/out 8192   # Gesamttest (braucht Playwright)
```

Kein Build-Schritt, keine Abhängigkeiten zur Laufzeit.
