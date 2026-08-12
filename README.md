# eBook Library

Obsidian-Plugin, das eine EPUB- und PDF-Sammlung als Markdown-Katalog verwaltet.
Der fachliche Entwurf steht in [KONZEPT.md](KONZEPT.md).

Der Ingest ist reines JavaScript und läuft vollständig offline: `fflate` entpackt
das EPUB-ZIP, `DOMParser` liest das OPF-XML, `pdf.js` rendert die erste PDF-Seite,
`crypto.subtle` bildet den Hash. Keine KI, kein Netzzugriff, keine externen Dienste.

## Was es tut

Der Katalog wird über einen eigenen View bedient — Regalbrett mit Covern, Suche,
Format- und Tag-Filtern, Zoom. Die Markdown-Notizen sind reine Datenhaltung; man
muss sie nicht öffnen.

Die Tag-Leiste hat eine eigene Sucheingabe: bei hunderten Tags sind höchstens
vierzig Chips zu sehen, der Rest ist über die Suche erreichbar. Gewählte Tags
stehen immer vorn und bleiben sichtbar.

Ein Scan geht alle `.epub`- und `.pdf`-Dateien der Vault durch und legt zu jedem
neuen Buch eine Notiz unter `_catalog/` an — mit Titel, Autor, Jahr, Sprache,
Dateigröße und Tags im Frontmatter, dazu ein Cover unter `_catalog/covers/`.
Danach arbeitet der Katalog nur noch auf den Markdown-Dateien.

Bücher werden über den SHA-256-Hash ihrer Datei identifiziert. Umbenennen und
Verschieben werden deshalb als solche erkannt und ziehen nur den Pfad nach.
Verschwundene Bücher werden markiert, nie gelöscht.

## Befehle

| Befehl | Wirkung |
| --- | --- |
| **Bibliothek scannen, neue Bücher in den Katalog aufnehmen** | Der Normalfall. Unveränderte Bücher werden übersprungen, ohne sie zu lesen. |
| **Alle Buchdateien neu hashen** | Derselbe Ablauf wie ein Scan, nur ohne die Abkürzung „Pfad und Größe unverändert". Notbremse für den einen Fall, den die Abkürzung nicht sieht: eine Datei am selben Pfad durch eine andere mit exakt gleicher Bytegröße ersetzt. Wirft nichts weg. |
| **Metadaten und Cover aller Bücher neu einlesen** | Nach einer Verbesserung der Extraktion im Plugin. Ein Scan hilft dafür nicht — die Bücher haben sich ja nicht geändert, nur das Auslesen. Tags und Notiztext bleiben unangetastet. |
| **Metadaten und Cover dieses Buchs neu einlesen** | Dasselbe für die gerade geöffnete Katalog-Notiz. |

## Import

Das Import-Symbol in der Leiste öffnet die Dateiauswahl. Die gewählten EPUBs und
PDFs werden zunächst nur **in den Speicher** gelesen — Hash, Metadaten, Cover.
Nichts landet in der Vault, bevor du bestätigst.

Der Dialog zeigt je Buch Cover, Titel, Autor, Zielordner und Tags, alles
änderbar. Der Zielordner ist vorbelegt: steht schon ein Buch desselben Autors im
Katalog, kommt das neue in dessen Ordner; sonst gilt der zuletzt gewählte. Die
Tags folgen aus dem Ordner, solange du sie nicht selbst anfasst.

Beim Import wird die Datei nach deiner Konvention umbenannt — `Titel - Autor.epub` —
und in den Zielordner kopiert; die Notiz entsteht direkt, ein Scan ist nicht nötig.
Bücher, die am Hash schon im Katalog erkannt werden, sind gesperrt.

Hat alles geklappt, fragt das Plugin, ob die Quelldateien in den Papierkorb
sollen. In den Papierkorb, nicht gelöscht.

Jeder Import ist ein Eintrag in den Zugängen wie ein Scan — du siehst also
gleich, was gerade dazugekommen ist.

## Kontextmenü eines Buchs

Rechtsklick auf ein Buch im Katalog:

- **Zu Leseliste hinzufügen …**
- **Im Finder zeigen** (auf Windows: im Explorer) — springt zur Buchdatei im
  Dateimanager des Systems
- im Listenmodus zusätzlich **An den Anfang**, **Ans Ende** und **Aus der Liste
  entfernen**

## Zugänge und Protokoll

Jeder Ingest-Lauf bekommt einen Zeitstempel, der als `ingested` in den Notizen
landet. Das Verlaufs-Symbol in der Leiste öffnet ein Menü mit den letzten Läufen,
neuester zuerst, je mit Datum und Anzahl. Einer ausgewählt heißt: der Katalog
zeigt nur dessen Bücher.

Dasselbe Menü öffnet das Protokoll. Bei Erfolg steht dort eine Zeile mit Zahlen;
ausführlich wird es nur bei Fehlschlägen — Begründung und Bezug auf das Buch, bei
dem es hakte, von dort springt man in dessen Notiz.

Die Historie liegt in der `data.json` des Plugins, nicht als Markdown in der
Vault. Aufgehoben werden die letzten 30 Läufe.

## Leselisten

Rechtsklick auf ein Buch → „Zu Leseliste hinzufügen …". Der Dialog zeigt die
vorhandenen Listen; tippt man einen neuen Namen, entsteht die Liste.

Das Listensymbol in der Leiste öffnet das Menü aller Listen mit ihrer Anzahl.
Eine ausgewählt schaltet den Katalog in den Listenmodus: nur ihre Bücher, in
Listenreihenfolge, mit Positionsnummer auf dem Cover. Umsortiert wird durch
Ziehen und Ablegen — die rote Marke im Zwischenraum zeigt, wo eingefügt wird. Im
Kontextmenü stehen zusätzlich „An den Anfang" und „Ans Ende", dort wird auch
entfernt.

Löschen lässt sich eine Liste im Listenmenü, aber nur solange sie aufgeschlagen
ist — sonst wäre unklar, welche gemeint ist. Es kommt eine Rückfrage, die Datei
wandert in den Papierkorb, die Bücher bleiben unberührt.

Je Liste eine Markdown-Datei unter `_catalog/readinglists/`, der Dateiname ist
der Titel:

```markdown
- [[The Gene - Siddhartha Mukherjee]]
- [[Alexandria - Paul Kingsnorth]]
```

Verwiesen wird per Wikilink, weil Obsidian die beim Umbenennen einer Buchnotiz
selbst nachzieht. Geschrieben wird nur der zusammenhängende Block der
`- [[…]]`-Zeilen — was du darüber oder darunter schreibst, bleibt stehen.

## Entwickeln

```bash
npm install
npm run dev      # esbuild im Watch-Modus
npm run build    # Typprüfung + Produktionsbündel
```

Das Plugin ist per Symlink in der Test-Vault installiert:
`Ebook Test Vault/.obsidian/plugins/ebook-library` → dieses Verzeichnis.
Nach einem Build in Obsidian das Plugin aus- und wieder einschalten.

## Prüfstände

Die Extraktion lässt sich ohne Obsidian gegen die echten Bücher fahren.

```bash
npm test              # Scanner gegen eine Wegwerf-Kopie der Test-Vault
npm run harness -- "../Ebook Vorrat"   # zeigt, was an Metadaten herauskommt
npm run harness:browser                # für Cover: braucht Canvas, also einen Browser
```

`npm test` prüft die vier Zweige eines Scans: Ingest, Überspringen, Verschieben,
Verwaisen. Cover bleiben dabei außen vor — die brauchen Canvas-APIs, die es in
Node nicht gibt, und werden vom Browser-Prüfstand abgedeckt
(`test/browser/index.html` über den Server aus `harness:browser` öffnen).
