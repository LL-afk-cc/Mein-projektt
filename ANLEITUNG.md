# Auto360 Innenraum – Anleitung

360°-Innenraumansicht aus normalen Verkaufsfotos, **direkt auf dem Android-Handy**.
Die App läuft im Browser (Chrome) und lässt sich wie eine normale App auf den Startbildschirm legen.
Alle Berechnungen passieren auf dem Handy, es werden keine Fotos hochgeladen.

---

## 1. Machbarkeitsanalyse: was die Handy-Version kann und was nicht

Die Entscheidung lautete **„nur auf dem Handy, ohne Rechner“**. Daraus folgt:

| | Funktion | Stand |
|---|---|---|
| ✅ sicher machbar | Cockpit-Foto als **Original-Anker** in die 360°-Kugel legen (nur perspektivische Umrechnung, keine Neuzeichnung) | umgesetzt und getestet |
| ✅ sicher machbar | Automatischer Anker-Vorschlag, Neigungs-Schätzung (Roll), Feinjustierung mit Schiebereglern und Live-Vorschau | umgesetzt und getestet |
| ✅ sicher machbar | Weitere Fotos als **Inseln** (Rückbank, Türen) in eine Richtung legen, mit Warnung bei Überdeckung | umgesetzt und getestet |
| ✅ sicher machbar | Nahtlose Auffüllung, Prüfung von 360°-Naht und Polen, **Herkunftsmaske**, Export **8192×4096** JPEG (4:4:4, GPano-360°-Metadaten), Offline-Viewer-HTML, Teilen | umgesetzt und getestet |
| ⚠️ mit Risiko | Rechenzeit und Arbeitsspeicher auf deinem Handy (siehe Abschnitt 6) | nur am Desktop-Browser gemessen |
| ⚠️ mit Risiko | Inseln: Diese Fotos sind von der Tür aus aufgenommen, nicht aus der Mitte. Ihre Lage ist deshalb nur **ungefähr** richtig. | so gekennzeichnet |
| ❌ nicht machbar | **KI-Ergänzung** der fehlenden Richtungen (SDXL/ControlNet/IP-Adapter). Diese Modelle brauchen eine Grafikkarte mit ≥ 8 GB und laufen auf keinem Handy in brauchbarer Zeit. | **nicht umgesetzt** |
| ❌ verworfen | Nahaufnahmen (z. B. nur Lenkrad) als „Detail-Insel“ automatisch einpassen | getestet und wieder entfernt, siehe Abschnitt 7 |

**Was das für das Ergebnis bedeutet:** Vorne (Cockpit, Lenkrad, Tacho, Navi, Klima, Schalthebel)
siehst du **echte Fotopixel in Originalauflösung**. Alles, was nicht fotografiert wurde (Dach,
Rückseiten der Vordersitze, große Teile hinten), wird **nur unscharf farblich aufgefüllt** und ist
in der Herkunftsmaske **rot** markiert. Es wird nichts erfunden, und es gibt keine KI-Bereiche.
Auf dem Handy entsteht also kein „vollständig fotorealistisches“ Rundum-Bild. Dafür bräuchte es
den KI-Teil auf einem PC mit Grafikkarte, der sich später ergänzen lässt.

---

## 2. App aufs Handy bringen (einmalig)

Die App muss über eine **https-Adresse** erreichbar sein. Am einfachsten geht das kostenlos über GitHub Pages:

1. Auf github.com das Repository **Mein-projektt** öffnen.
2. **Settings** → links **Pages** → bei *Source* **„GitHub Actions“** auswählen.
   (Bei privaten Repositories ist GitHub Pages nur mit einem kostenpflichtigen GitHub-Tarif möglich.
   Sonst das Repository auf *public* stellen. Die Testfotos im Ordner `testdaten/` sind dann ebenfalls öffentlich.)
3. Oben auf **Actions** → „App veröffentlichen (GitHub Pages)“ → **Run workflow**.
   Nach ca. 1 Minute steht dort die Adresse, z. B. `https://ll-afk-cc.github.io/Mein-projektt/`.
4. Diese Adresse auf dem Handy in **Chrome** öffnen.
5. Chrome-Menü (⋮) → **„Zum Startbildschirm hinzufügen“** bzw. **„App installieren“**.
6. Ab jetzt per Symbol **Auto360** starten. Die App funktioniert danach auch **offline**.

---

## 3. Bedienung

Die App hat unten vier Schritte.

**1 Fotos**
- „Fotos auswählen“ und alle Innenraumfotos eines Fahrzeugs auf einmal markieren
  (oder „Foto aufnehmen“).
- Das Cockpit-Gesamtfoto wird automatisch als **Anker** vorgeschlagen (Rahmen grün, Hinweis „Vorschlag“).
  Falls das falsch ist, beim richtigen Foto „Anker (Cockpit)“ wählen.
- Optional weitere Fotos auf **„Insel (ungefähre Lage)“** stellen und die Richtung wählen,
  z. B. Rückbank-Foto → „Blick hinten“, Beifahrertür → „Blick rechts“.
- **Nahaufnahmen** (nur Lenkrad o. Ä.) auf „Nicht verwenden“ lassen.

**2 Ausrichten**
- Oben siehst du die 360°-Vorschau. Mit dem Finger ziehen zum Umsehen, mit zwei Fingern zoomen.
- Anker einstellen:
  - **Kippen (Roll):** „Neigung automatisch“ tippen, dann prüfen: Die Mittelkonsole soll senkrecht stehen.
  - **Sichtfeld:** größer = Foto erscheint kleiner/weiter weg. Das Lenkrad soll natürlich groß wirken.
  - **Hoch/runter (Nick):** Armaturenbrett etwa auf Augenhöhe.
  - **Drehen (Gier):** meist 0° lassen (Anker = „vorne“).
- Für Inseln: Gier/Nick/Sichtfeld nach Augenmaß einstellen und mit „Rand beschneiden“
  Türrahmen und Karosserie wegschneiden.
- Die Hinweisbox warnt, wenn sich eine Insel mit dem Anker oder einer anderen Insel überdeckt.
  Dort könnten Objekte **doppelt** erscheinen.
- „Herkunft“ blendet die Farbmaske ein: grün = Anker, gelbgrün = Insel, rot = aufgefüllt.

**3 Erstellen**
- Fahrzeugname eintragen (für Dateinamen), Auflösung **8192 × 4096** lassen.
- „360°-Ansicht erstellen“ tippen. Der Fortschritt zeigt Phase, Prozent und Restzeit;
  100 % erscheint erst, wenn wirklich alles fertig ist. Der Bildschirm bleibt dabei an.
- Danach erscheint ein **Bericht** mit dem Anteil der Kugel aus Originalfotos bzw. Auffüllung,
  der Auflösung je Foto (Original oder hochskaliert) und dem Ergebnis der Nahtprüfung.

**4 Ansehen**
- 360°-Ansicht mit Auto-Drehen, Herkunftsmaske, **Bewegungssensor** (Handy drehen = umsehen) und Vollbild.
- **JPEG speichern:** 8192×4096 mit 360°-Metadaten. Facebook, Google Fotos usw. erkennen es als Panorama.
- **Viewer-Datei speichern:** eine einzelne HTML-Datei, die offline in jedem Browser
  das 360°-Bild mit Maus/Touch, Zoom, Vollbild, Auto-Drehen und Herkunftsmaske zeigt.
  Sie eignet sich auch für die Website.
- **Teilen:** direkt per WhatsApp, E-Mail usw.
- **Als 2D-Bild:** das flache Panoramabild ansehen.

Alles wird automatisch im Handy gespeichert. Nach dem Schließen geht es genau dort weiter.
**„Neues Fahrzeug“** (Schritt 1) leert das Projekt für das nächste Auto.

---

## 4. Stellschrauben bei schlechten Ergebnissen

| Problem | Abhilfe |
|---|---|
| Cockpit wirkt schief | Roll-Regler, bis die Mittelkonsole senkrecht steht (Feinschritt mit −/+ : 0,25°) |
| Lenkrad wirkt riesig oder winzig | Sichtfeld anpassen (Handy-Hauptkamera meist 65–75°) |
| Harte Kante zwischen Foto und Auffüllung | „Weiche Kante“ erhöhen (Anker 4–8 %, Inseln 10–20 %) |
| Türrahmen/Karosserie sichtbar | „Rand beschneiden“ links/rechts/oben/unten |
| Doppelte Kopfstützen/Sitze | Insel weiterdrehen (Gier), stärker beschneiden oder Insel nicht verwenden |
| App bricht beim Erstellen ab | Auflösung **4096 × 2048** wählen (braucht ein Viertel des Speichers) |
| Vorschau ruckelt | normal, sie wird nach dem Loslassen scharf nachberechnet |

---

## 5. Was tatsächlich getestet wurde

Getestet in einer Cloud-Umgebung (Linux, 4 CPU-Kerne) **ohne echtes Handy**, mit Chromium in
**Pixel-7-Emulation** und deinen 6 Beispielfotos (VW Golf 7 Variant, `testdaten/`).

**Komponententests** (`node --test tests/unit.test.mjs`): **11 von 11 bestanden**
- Equirect ↔ Richtung umkehrbar, Drehmatrizen orthonormal, Kamera-Projektion konsistent
- Anker-Pixel stammen ausschließlich aus dem Foto (nur bilinear umgerechnet, Abweichung höchstens ±1 Rundung) und werden von Inseln oder der Auffüllung nicht verändert
- Auffüllung lückenlos und stetig über die 360°-Naht, Pole einheitlich
- Herkunftsmaske, Überdeckungswarnung, Roll-Schätzung (−6°/0°/+4° auf ±0,75° genau), Anker-Vorschlag
- JPEG: gültige Struktur, 4:4:4, GPano-XMP

**Gesamttest im Browser** (`tests/e2e.mjs`):
- Anker-Vorschlag: `05_cockpit.jpg` richtig erkannt (Punktzahl 1,67; Lenkrad-Nahaufnahme 1,13; Tür-/Fondfotos 0,18–0,35)
- Neigung geschätzt: 1,5°
- Überdeckungswarnung: Insel bei Gier 35° → „45,7 % überdeckt“, bei 90° → 0 %
- Erstellen **8192 × 4096: 4,3 s** (Auffüllen 0,14 s, Panorama 2,8 s, JPEG 0,9 s)
- Fortschrittsanzeige: 100 % erst am Ende
- Export unabhängig mit Python/Pillow geprüft: 8192×4096, 4:4:4, GPano „equirectangular“, Naht links/rechts 1,4 gegenüber 1,2 zwischen Nachbarspalten (= nahtlos)
- Offline-Viewer-HTML per `file://` geöffnet: Panorama wird als 8192er-Textur angezeigt
- Nach Neuladen: alle 6 Fotos, Rollen und das Ergebnis wiederhergestellt
- Keine Fehler in der Browser-Konsole

---

## 6. Was du auf deinem Handy noch prüfen musst

1. **Rechenzeit:** Am Desktop dauerten 8192 × 4096 rund 4 s. Auf einem Handy erwarte ich grob
   **10–30 Sekunden**. Das ist geschätzt, nicht gemessen.
2. **Arbeitsspeicher:** 8192 × 4096 braucht während der Berechnung ca. 400–500 MB.
   Auf älteren Handys kann der Tab abstürzen. Dann 4096 wählen. Das Projekt bleibt erhalten.
3. **Viewer-Schärfe:** Manche ältere Handys können nur 4096 Pixel breite Texturen anzeigen.
   Der Viewer verkleinert dann automatisch für die Anzeige; die gespeicherte JPEG-Datei bleibt 8192.
4. **Bewegungssensor:** Richtung und Vorzeichen beim Drehen des Handys prüfen.
   Das ließ sich in der Emulation nicht testen.
5. **Foto aufnehmen** über die Handykamera (in der Emulation nicht testbar).
6. **Offline-Betrieb** nach der Installation (Flugmodus an, App öffnen).

---

## 7. Warum keine Nahaufnahmen („Detail-Inseln“)?

Ursprünglich sollte die Lenkrad-Nahaufnahme automatisch über das Cockpit-Foto gelegt werden, um diesen
Bereich schärfer zu machen. In den Tests entstand dabei **zweimal ein doppeltes Lenkrad**, obwohl die
automatische Passgenauigkeits-Kennzahl jedes Mal „mittel“ bzw. „gut“ meldete. Der Grund: Die Nahaufnahme
wurde von einem anderen Standpunkt (näher am Lenkrad) aufgenommen. Nahe und ferne Teile (Lenkrad bzw. Tacho)
verschieben sich dabei unterschiedlich stark, und das lässt sich mit einer reinen Drehung grundsätzlich nicht
deckungsgleich machen. Weil „keine doppelten Objekte“ Vorrang hat und das Cockpit-Foto bei 8192 × 4096
ohnehin schon in **voller Originalauflösung** im Panorama steckt (30 px/° Foto gegenüber 22,8 px/° Panorama),
wurde die Funktion entfernt.

---

## 8. Mögliche nächste Schritte (nicht umgesetzt)

- **KI-Ergänzung auf dem PC** (RTX 2080): Das Handy bleibt Bedienung und Viewer, der PC füllt die roten
  Bereiche mit SDXL-Inpainting, gesteuert von einem 3D-Innenraummodell. Das wäre ein eigenes Projekt.
- **Stapelbetrieb** vieler Fahrzeuge: auf dem Handy nicht sinnvoll, deshalb nicht enthalten.
