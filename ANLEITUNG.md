# Auto360 Innenraum – Anleitung

360°-Innenraumansicht **direkt auf dem Android-Handy**. Die App läuft im Browser (Chrome) und lässt
sich wie eine normale App auf den Startbildschirm legen. Alle Berechnungen passieren auf dem Handy,
es werden keine Fotos hochgeladen.

Es gibt zwei Wege:

| | **A – Rundumaufnahme aus der Mitte** (empfohlen) | **B – vorhandene Einzelfotos** (Türfotos) |
|---|---|---|
| Aufnahme | 24 Fotos mit der App, Handy zwischen den Vordersitzen, nur drehen | normale Verkaufsfotos durch die Türen |
| Ergebnis | **vollständiges, scharfes 360°-Bild aus echten Fotos** | Cockpit scharf, Rest größtenteils unscharf aufgefüllt |
| Zeitaufwand | ca. 2–3 Minuten Aufnahme pro Fahrzeug | keiner (Fotos vorhanden) |

---

## 1. Machbarkeit: was die App kann und was nicht

| | Funktion | Stand |
|---|---|---|
| ✅ sicher machbar | **Rundumaufnahme:** geführte Aufnahme (Zielkreise, Pfeil, Auto-Auslösen) mit Bewegungssensor | umgesetzt, Ablauf simuliert getestet |
| ✅ sicher machbar | **Automatische Feinausrichtung** der 24 Fotos per Bildvergleich, Kamera-Sichtfeld wird mitbestimmt, Helligkeitsangleich | umgesetzt, mit simulierten Aufnahmen getestet (Abschnitt 5) |
| ✅ sicher machbar | Einzelfotos: Cockpit-Foto als **Original-Anker** in die Kugel legen, Inseln mit Überdeckungswarnung | umgesetzt und getestet |
| ✅ sicher machbar | Nahtlose Auffüllung, **Herkunftsmaske**, Export **8192×4096** JPEG (4:4:4, GPano-360°-Metadaten), Offline-Viewer-HTML, Teilen | umgesetzt und getestet |
| ⚠️ mit Risiko | **Parallaxe bei der Rundumaufnahme:** Wird das Handy beim Drehen verschoben statt nur gedreht, passen nahe Teile (Kopfstützen, Sitze) an den Übergängen nicht exakt → doppelte Kanten. Im Auto sind Objekte nur 30–80 cm entfernt, das macht es empfindlich. | nur simuliert ohne Parallaxe getestet |
| ⚠️ mit Risiko | Bildqualität aus dem **Video-Kamerastrom** (statt Foto-Modus), Rechenzeit und Speicher auf deinem Handy | nicht auf echtem Handy getestet |
| ❌ nicht machbar | **KI-Ergänzung** fehlender Bereiche (SDXL & Co.) – braucht eine Grafikkarte, läuft auf keinem Handy | nicht umgesetzt |
| ❌ verworfen | Nahaufnahmen (z. B. nur Lenkrad) automatisch über das Cockpit legen | getestet und entfernt (Abschnitt 7) |

---

## 2. App aufs Handy bringen (einmalig)

Die App muss über eine **https-Adresse** erreichbar sein (nötig für Kamera, Bewegungssensor und Installation).
Kostenlos über GitHub Pages:

1. Auf github.com das Repository **Mein-projektt** öffnen.
2. **Settings** → links **Pages** → bei *Source* **„GitHub Actions“** auswählen.
   (Bei privaten Repositories nur mit kostenpflichtigem GitHub-Tarif. Sonst Repository auf *public* stellen –
   dann sind auch die Beispielfotos in `testdaten/` öffentlich.)
3. **Actions** → „App veröffentlichen (GitHub Pages)“ → **Run workflow**. Nach ca. 1 Minute steht dort die Adresse,
   voraussichtlich `https://ll-afk-cc.github.io/Mein-projektt/`.
4. Adresse auf dem Handy in **Chrome** öffnen → Menü (⋮) → **„Zum Startbildschirm hinzufügen“** / „App installieren“.
5. Beim ersten Start der Rundumaufnahme **Kamera** und **Bewegungssensoren** erlauben.

---

## 3. Bedienung

### Weg A – Rundumaufnahme aus der Mitte (empfohlen)

**Vorbereitung:** Türen schließen (sonst fehlen Türverkleidungen), Innenlicht wie gewünscht, Vordersitze in
normale Position. Am besten ein **Einbeinstativ** mit Handyhalter zwischen die Vordersitze stellen –
dann bleibt die Kamera automatisch an derselben Stelle.

1. Schritt **1 Fotos** → **„Rundumaufnahme starten“**.
2. Handy **hochkant**, Kamera **mittig zwischen den Vordersitzen auf Kopfhöhe**.
   Auf die Mitte des Armaturenbretts richten und den **Auslöser** drücken → das ist „vorne“.
3. Jetzt nur noch **drehen**: Ein **grüner Kreis** (oder Pfeil am Rand) zeigt die nächste Richtung.
   Fadenkreuz in den Kreis bringen und **kurz ruhig halten** – die App löst automatisch aus (gelber Ring füllt sich).
   Reihenfolge: 10 Fotos geradeaus rundherum, 6 schräg nach oben, 6 schräg nach unten, Dach, Boden.
   Die Mini-Karte unten rechts zeigt, was fertig ist (grün).
4. **„Fertig“** → die App richtet die Fotos automatisch aus (ca. 15–60 s, Fortschritt wird angezeigt).
5. Schritt **2 Ausrichten**: Ergebnis im Viewer prüfen. Die Box oben sagt, wie gut die Fotos zusammenpassen.
   Regler: **Blickrichtung „vorne“**, **Horizont** hoch/runter und kippen, **Kamera-Sichtfeld**, **Übergänge**.
6. Schritt **3 Erstellen** und **4 Ansehen** wie unten.

**Wichtigster Tipp:** Um das **Objektiv** drehen, nicht um den eigenen Körper. Wer das Handy mit
ausgestrecktem Arm schwenkt, verschiebt die Kamera um 30–50 cm → doppelte Kopfstützen an den Übergängen.

### Weg B – vorhandene Einzelfotos

1. **1 Fotos** → „Fotos auswählen“, alle Innenraumfotos markieren. Das Cockpit-Gesamtfoto wird als
   **Anker** vorgeschlagen. Optional weitere Fotos als **„Insel (ungefähre Lage)“** mit Richtung.
   Nahaufnahmen auf „Nicht verwenden“ lassen.
2. **2 Ausrichten**: „Neigung automatisch“, dann Sichtfeld/Nick/Roll so einstellen, dass die
   Mittelkonsole senkrecht steht. Inseln mit „Rand beschneiden“ von Türrahmen befreien.
   Die App warnt, wenn sich Fotos überdecken (Gefahr doppelter Objekte).

### Erstellen und Ansehen (beide Wege)

- **3 Erstellen:** Fahrzeugname eintragen, **8192 × 4096** lassen, „360°-Ansicht erstellen“.
  Fortschritt mit Phase, Prozent und Restzeit; 100 % erst, wenn alles fertig ist.
  Danach ein **Bericht**: Anteil echter Fotos / Auffüllung, Auflösung, Ausrichtungsqualität, Nahtprüfung.
- **4 Ansehen:** 360°-Viewer mit Auto-Drehen, **Herkunftsmaske** (grün = Originalfoto, gelbgrün = Insel,
  rot = aufgefüllt), **Bewegungssensor**, Vollbild.
  **JPEG speichern** (8192×4096 mit 360°-Metadaten), **Viewer-Datei speichern** (eine HTML-Datei, offline,
  auch für die Website), **Teilen**, **Als 2D-Bild**.

Alles wird automatisch im Handy gespeichert. **„Neues Fahrzeug“** (Schritt 1) leert das Projekt.

---

## 4. Stellschrauben bei schlechten Ergebnissen

**Rundumaufnahme**

| Problem | Abhilfe |
|---|---|
| Doppelte Kanten an Übergängen (Kopfstützen, Türgriffe) | Neu aufnehmen und dabei nur drehen (Einbeinstativ). Regler „Übergänge“ höher (schärfer) stellen. |
| Box meldet „Bildvergleich hat nicht funktioniert“ | Fotos zu verwackelt/dunkel: mehr Licht, langsamer drehen, neu aufnehmen |
| Einzelnes Paar „passt schlecht“ | Im Viewer an der Stelle prüfen; ggf. das Foto unter „Fotos“ auf „Nicht verwenden“ (Lücke wird aufgefüllt) |
| Horizont schief | „Horizont kippen“ (0,1°-Schritte) |
| Ganzes Bild wirkt gestaucht/gestreckt | „Kamera-Sichtfeld“ prüfen (wird automatisch bestimmt; Hinweis erscheint, wenn unsicher) |
| Falsche Richtung ist „vorne“ | „Blickrichtung vorne drehen“ |
| Helle/dunkle Flecken | Automatisch ausgeglichen; bei starker Gegenlicht-Situation Innenraum gleichmäßiger ausleuchten |

**Einzelfotos**

| Problem | Abhilfe |
|---|---|
| Cockpit schief | Roll-Regler (−/+: 0,25°) |
| Lenkrad zu groß/klein | Sichtfeld (Hauptkamera meist 65–75°) |
| Harte Kante Foto ↔ Auffüllung | „Weiche Kante“ erhöhen |
| Doppelte Sitze/Kopfstützen | Insel drehen, beschneiden oder nicht verwenden |

**Allgemein:** App bricht beim Erstellen ab → **4096 × 2048** wählen (ein Viertel des Speichers).

---

## 5. Was tatsächlich getestet wurde

Getestet in einer Cloud-Umgebung (Linux, 4 CPU-Kerne) **ohne echtes Handy**: Chromium mit
**Pixel-7-Emulation**, Chromium-Testkamera, **simuliertem** Bewegungssensor und deinen Beispielfotos.

**Komponententests** (`node --test tests/unit.test.mjs`): **13 von 13 bestanden**
- Geometrie, Projektion, Anker-Pixeltreue, Auffüllung/Naht/Pole, Herkunftsmaske, Überdeckungswarnung,
  Roll-Schätzung, Anker-Vorschlag, JPEG 4:4:4 + GPano
- **Rundumaufnahme-Ausrichtung:** 24 virtuelle Fotos einer Testszene, Sensorfehler bis 3,5°,
  Sichtfeld 8 % falsch vorgegeben, Belichtung ±10 % → Lagefehler danach **< 0,4° mittel / < 1° max**,
  Sichtfeld auf **1,5 %** genau, Helligkeitsangleich plausibel
- Überblendung der 24 Fotos deckt die Kugel vollständig (< 1 % Auffüllung)

**Gesamttest Rundumaufnahme** (`tests/e2e-rundum.mjs`):
- Aufnahme-Oberfläche: Testkamera 1920×1440 läuft, alle **24 Ziele automatisch ausgelöst**
  (simulierter Sensor), gespeicherte Richtungen stimmen
- Absicherung: Mit unbrauchbaren Bildern (Testkamera zeigt überall dasselbe) meldet die App ehrlich
  „Bildvergleich hat nicht funktioniert“ und **behält die Sensorwerte**, statt sie zu verschlechtern
- Virtuelle Aufnahmen aus einer Szene mit deinen Fotos (Sensorfehler bis 4°): Ausrichtung im Browser
  **13 s**, Fehler **2,2° → 0,16° mittel / 0,30° max**, Sichtfeld 53,07° (wahr 53,04°)
- Erstellen **8192 × 4096: 7,4 s**, 99,9 % echte Fotopixel, Nahtprüfung bestanden, Download ok

**Zusatzversuch mit deinem Beispiel-Panorama** als „echter Szene“ (24 virtuelle Fotos, Sensorfehler bis 4°,
Sichtfeld +10 % falsch): Sichtfeld in drei Durchläufen auf 53,09–53,18° (wahr 53,04°) bestimmt,
Fotos untereinander auf **0,19–0,33° mittel** ausgerichtet. Ohne Feinausrichtung (nur Sensor) entstehen
sichtbar doppelte Lenkräder und Pedale, mit Feinausrichtung nicht.

**Gesamttest Einzelfotos** (`tests/e2e.mjs`): Anker-Vorschlag korrekt, Überdeckungswarnung, Erstellen
8192×4096 in 3,9 s, Export (unabhängig mit Pillow geprüft: 4:4:4, GPano), Offline-Viewer, Wiederaufnahme.

**Wichtig:** Die simulierten Aufnahmen haben **keine Parallaxe** und **kein Bildrauschen** – echte Handyfotos
sind schwieriger. Die Zahlen zeigen, dass das Verfahren funktioniert, nicht wie gut dein konkretes Ergebnis wird.

---

## 6. Was du auf deinem Handy noch prüfen musst

1. **Bewegungssensor-Richtung:** Folgen die grünen Kreise beim Drehen richtig? (nur simuliert getestet)
2. **Kamerabild:** Die Aufnahme nutzt den Video-Kamerastrom (meist 1920×1440). Schärfe und Rauschen bei
   wenig Licht prüfen. Fokus/Belichtung steuert das Handy automatisch.
3. **Parallaxe:** Gibt es doppelte Kanten an Übergängen? Dann mit Einbeinstativ bzw. „um das Objektiv drehen“ wiederholen.
4. **Rechenzeit:** Desktop: Ausrichtung ~13 s, Erstellen 8192 ~7 s. Handy geschätzt **3–5× länger** (nicht gemessen).
5. **Arbeitsspeicher:** 24 Fotos + 8192er Panorama brauchen zusammen ca. 500–700 MB. Bei Abstürzen 4096 wählen.
6. **Viewer:** Ältere Handys zeigen ggf. nur 4096er Texturen (Datei bleibt 8192).
7. **Offline-Betrieb** nach der Installation.

---

## 7. Warum keine Nahaufnahmen („Detail-Inseln“)?

Eine Lenkrad-Nahaufnahme automatisch über das Cockpit-Foto zu legen, erzeugte in Tests **zweimal ein doppeltes
Lenkrad**, obwohl die Kennzahl „gut“ meldete. Die Nahaufnahme stammt von einem anderen Standpunkt – nahe und ferne
Teile verschieben sich unterschiedlich (Parallaxe), das ist mit einer reinen Drehung nicht deckungsgleich zu machen.
Das Cockpit-Foto steckt bei 8192 × 4096 ohnehin in voller Originalauflösung im Panorama. Funktion entfernt.

Genau dieses Problem gibt es bei der Rundumaufnahme nicht, **solange die Kamera an derselben Stelle bleibt** –
deshalb ist sie der empfohlene Weg.

---

## 8. Mögliche nächste Schritte (nicht umgesetzt)

- **Foto-Modus statt Video-Kamerastrom** (höhere Auflösung), sofern das Handy die nötige Schnittstelle unterstützt.
- **KI-Ergänzung auf dem PC** für Fahrzeuge, von denen nur Türfotos existieren.
- **Stapelbetrieb** vieler Fahrzeuge: auf dem Handy nicht sinnvoll, deshalb nicht enthalten.
