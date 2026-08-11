# eBook Library

Obsidian-Plugin, das eine EPUB- und PDF-Sammlung als Markdown-Katalog verwaltet.
Der fachliche Entwurf steht in [KONZEPT.md](KONZEPT.md).

Der Ingest ist reines JavaScript und läuft vollständig offline: `fflate` entpackt
das EPUB-ZIP, `DOMParser` liest das OPF-XML, `pdf.js` rendert die erste PDF-Seite,
`crypto.subtle` bildet den Hash. Keine KI, kein Netzzugriff, keine externen Dienste.

## Was es tut

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

Das Ergebnis jedes Scans steht in `_catalog/_ingest-report.md`.

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
