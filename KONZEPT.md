# eBook Library — Konzept

Obsidian-Plugin zur Verwaltung einer eBook-Sammlung aus EPUB- und PDF-Dateien.

## 1. Zweck und Abgrenzung

Die Sammlung liegt als EPUB- und PDF-Dateien in einer Vault, die zugleich ein
Dropbox-Verzeichnis ist. Obsidian dient hier als Application Host, nicht als
Notiz-Werkzeug im engeren Sinn.

Das Plugin **verwaltet** die Sammlung. Es **liest** keine Bücher.

Es tut genau eine Sache mit den Buchdateien: Es öffnet jede Datei **einmal**, um
Cover und Metadaten zu extrahieren. Danach existieren die Bücher für das Plugin
nicht mehr. Der Katalog arbeitet ausschließlich auf den daraus abgeleiteten
Markdown-Dateien.

### Nicht-Ziele

- Kein Lesen, kein Lesefortschritt, kein Reader-UI
- Keine mehrbändigen Werke — jede EPUB- und jede PDF-Datei ist ein Buch für sich
- Keine Dubletten-Erkennung über Titel; identische Dateien werden über den Hash
  erkannt, verschiedene Ausgaben desselben Werks sind verschiedene Bücher
- Keine Verwaltung der physischen Ordnerstruktur

## 2. Grundidee

Pro Buch entsteht eine Markdown-Notiz mit den Metadaten im Frontmatter und einer
Cover-Bilddatei. Damit übernimmt Obsidian den gesamten Rest: Suche, Tags,
Filtern, Sortieren, Kartenansicht über Bases — und die Notiz hat einen Body, in
den eigene Gedanken, Zitate und Rezensionen passen. Das ist der Mehrwert
gegenüber einem reinen Katalogprogramm.

## 3. Physische Ordner vs. Katalog

Die Bücher liegen in einer von Hand gepflegten Ordnerhierarchie
(`Sachbücher/Geschichte/`, `Abendlektüre/Genres/Krimis/` …). Diese Hierarchie
bleibt bestehen, weil die Sammlung auch über Dropbox ohne Obsidian zugänglich
sein muss.

Für den Katalog ist sie **irrelevant**. Sie wird beim Ingest einmalig in Tags
übersetzt und danach nie wieder gelesen. Grund: Im Dateisystem muss man sich für
eine Achse entscheiden, deshalb schachteln sich dort Gattung, Genre, Fachgebiet
und Lesekontext ineinander. Tags haben diesen Zwang nicht — ein Buch kann
gleichzeitig `sachbuch`, `geschichte` und `abendlektüre` sein, ohne dass eines
dem anderen untergeordnet wäre.

## 4. Ablage

```
<vault>/
  Sachbücher/…                 die Bücher, von Hand geordnet, vom Plugin nur gelesen
  Abendlektüre/…
  _catalog/
    Titel - Autor.md           eine Notiz pro Buch
    _ingest-report.md          generiert, Ergebnis des letzten Scans
    covers/
      <hash>.jpg               Cover, nach Hash benannt
```

Der Cover-Dateiname ist der Hash, weil er beim Umbenennen des Buchs stabil bleibt
und garantiert kollisionsfrei ist. Der Ordner ist nichts zum Durchblättern, dort
darf es unlesbar sein.

Der Notiz-Dateiname ist `Titel - Autor.md` — lesbar, verlinkbar, im Quick
Switcher auffindbar. Bei Kollision wird ein Zähler angehängt. Der Dateiname
trägt **keine Bedeutung**: Identifiziert wird ausschließlich über den Hash im
Frontmatter. Die Notiz darf jederzeit von Hand umbenannt werden.

## 5. Datenmodell

```yaml
---
# maschinell — vom Plugin gepflegt
hash: a3f91c…                  SHA-256 der Buchdatei, die Identität
file: "Sachbücher/Biologie/The gene … Mukherjee.epub"
format: epub                   epub | pdf
size: 4823901                  Bytes, als Zahl (damit korrekt sortiert wird)
cover: "[[a3f91c….jpg]]"       Wikilink, damit Obsidian ihn auflösen kann
ingested: 2026-08-11

# bibliographisch — beim Ingest ermittelt, danach von Hand korrigierbar
title: The Gene — An Intimate History
author: Siddhartha Mukherjee
year: 2016
language: en

# Einordnung — beim Ingest aus dem Pfad gesät, danach ausschließlich manuell
tags: [sachbuch, biologie, abendlektüre]
---

Freitext: eigene Notizen, Zitate, Rezension.
```

Alles Inhaltliche läuft über `tags`. Es gibt bewusst keine getrennten Achsen für
Gattung, Genre oder Fachgebiet, keinen Lesestatus und keine Bewertung.

## 6. Identität und Scan

### Identität

Ein Buch wird über den **SHA-256-Hash seiner Datei** identifiziert. Der Hash
überlebt Umbenennen und Verschieben — genau das, was gebraucht wird, weil die
physische Ordnung weiterhin von Hand außerhalb von Obsidian gepflegt wird.

### Die Nachschlagetabelle

Vollständiges Hashen aller Dateien bei jedem Scan würde bedeuten, die gesamte
Bibliothek zu lesen. Bei Dropbox mit online-only Dateien würde das die ganze
Sammlung herunterladen. Deshalb wird zuerst eine billige Frage gestellt.

Zu Beginn eines Scans wird aus den vorhandenen Katalog-Notizen eine Tabelle
`(pfad, größe) → notiz` aufgebaut. Das kostet keine Dateizugriffe, weil Obsidian
das Frontmatter aller Markdown-Dateien ohnehin im `metadataCache` im Speicher
hält.

Es gibt **keinen persistenten Cache**. Die Tabelle wird bei jedem Scan frisch
aus den Notizen abgeleitet und ist damit per Konstruktion nie veraltet. Möglich
ist das, weil `size` aus Anzeigegründen ohnehin im Frontmatter steht.

Der theoretische Fehlerfall — eine Datei am selben Pfad durch eine andere mit
exakt identischer Bytegröße ersetzt — ist bei EPUBs praktisch ausgeschlossen und
wird durch den Command „alles neu einlesen" aufgelöst.

### Ablauf

```
alle .epub/.pdf unterhalb der Vault auflisten     (adapter.list, rekursiv)
für jede Datei:
    größe erfragen                                (adapter.stat — kein Lesen)
    (pfad, größe) in der Tabelle?
        ja   → überspringen                       ← der Normalfall
        nein → hashen                             ← liest die Datei
               hash im Katalog bekannt?
                   ja   → Buch wurde umbenannt oder verschoben:
                          nur `file` in der Notiz aktualisieren.
                          Kein neuer Ingest, kein Cover neu extrahieren,
                          keine Tags anfassen.
                   nein → INGEST: Cover extrahieren, Metadaten ermitteln,
                          Tags aus dem Pfad säen, Notiz anlegen
am Ende:
    Notizen, deren `file` nicht mehr existiert → als verwaist markieren
```

Der Ingest ist kein eigener Vorgang, sondern der Zweig „diesen Hash habe ich noch
nie gesehen" innerhalb des Scans.

### Verwaiste Notizen

Eine Notiz, deren Buchdatei verschwunden ist, wird **markiert, nie gelöscht**.
Sonst könnte ein versehentlich verschobener Ordner handgeschriebene Rezensionen
vernichten. Markierung über ein zusätzliches Frontmatter-Feld `orphaned: <datum>`,
das beim Wiederauftauchen der Datei entfernt wird.

### Auslöser

Ein Scan läuft per Command. EPUB-Dateien sind für Obsidian unsichtbar (siehe
Abschnitt 8), es gibt für sie also keine Vault-Events, auf die man reagieren
könnte. Der Reihe halber gilt das für PDFs gleichermaßen.

## 7. Metadaten-Gewinnung

Fallback-Kette pro Feld: **Buchdatei → Dateiname → leer**.

### EPUB

`META-INF/container.xml` verweist auf die OPF-Datei, dort stehen die Dublin-Core-
Felder (`dc:title`, `dc:creator`, `dc:date`, `dc:language`, `dc:identifier`).
Erfahrungsgemäß brauchbar.

Zum Cover führen vier Wege, in absteigender Verlässlichkeit:

1. `<meta name="cover" content="ID">` und das Manifest-Item mit dieser ID
2. ein Manifest-Item mit `properties="cover-image"`
3. ein Bild-Item, dessen id oder href nach Cover aussieht
4. die Cover-*Seite* — im guide als `<reference type="cover">` — und darin das
   erste `<img>` bzw. SVG-`<image>`

Wichtig dabei: **Elemente über ihren lokalen Namen suchen, nicht über den
qualifizierten.** OPF-Dateien schreiben ihr Manifest mal als `<item>`, mal als
`<opf:item>`. `getElementsByTagName("item")` vergleicht in XML den vollen Namen
und findet die präfigierte Schreibweise nicht — das Manifest wäre damit
vollständig unsichtbar, samt Cover. Also `getElementsByTagNameNS("*", "item")`.

### PDF

DocInfo und XMP sind bei PDFs erfahrungsgemäß unbrauchbar („Microsoft Word -
Dokument1", Autor „Admin"). Sie werden gelesen, aber nur übernommen, wenn sie
plausibel wirken. Das Cover entsteht durch Rendern der ersten Seite.

### Dateiname

Der Nutzer hat die Sammlung überwiegend nach `Titel - Autor` benannt. Wo die
eingebetteten Metadaten nichts hergeben, ist der Dateiname die bessere Quelle.
Vorkommende Muster:

```
Titel - Autor.pdf
Titel -- Autor.pdf
Titel (Autor).epub
Titel (Autor [Nachname, Vorname]).epub
Titel, The - Autor.epub          ← nachgestellter Artikel
```

### Cover-Normalisierung

Cover werden auf max. 400 px Breite skaliert und als JPG gespeichert. Bei 1000
Büchern sind das rund 30 MB statt mehrerer hundert.

### Tags aus dem Pfad

Jedes Pfadsegment oberhalb der Datei wird ein Tag: kleingeschrieben, Leerzeichen
zu Bindestrich. `Alte Geschichte/` → `alte-geschichte`. Umlaute bleiben.

Bewusst **ohne Konfiguration**. Dass dabei gelegentlich ein inhaltsleeres Tag
entsteht (`Abendlektüre/Genres/Klassiker/` → auch `genres`), ist ein einmaliges
Aufräumen im Tag-Pane wert — keine Settings.

Tags werden **nur beim Anlegen der Notiz** geschrieben und danach nie wieder.
Ein späteres Verschieben der Datei aktualisiert `file` und lässt die Tags in
Ruhe. Andernfalls würde ein Verschieben die eigene Kuratierung überschreiben.

### Was das Plugin nie überschreibt

Nach dem Ingest schreibt das Plugin nur noch `file` und `orphaned`. Titel, Autor,
Jahr, Sprache, Tags und der gesamte Notiz-Body gehören dem Nutzer. Ein
erneutes Einlesen der Metadaten passiert ausschließlich auf ausdrücklichen
Befehl — für ein einzelnes Buch oder für alle.

Der Befehl für alle ist kein Luxus: Wenn die Extraktion im Plugin besser wird,
hilft kein Scan. Der überspringt unveränderte Dateien, und auch das vollständige
Neu-Hashen erkennt sie am Hash wieder und lässt die Notiz in Ruhe. Die Bücher
haben sich ja nicht geändert, nur das Auslesen. Tags und Notiztext bleiben auch
dabei unangetastet.

## 8. Technische Randbedingungen

**EPUBs sind für Obsidian unsichtbar.** Obsidian indexiert nur bekannte
Endungen; `.epub` gehört nicht dazu. `vault.getFiles()` liefert sie nicht, und es
gibt keine `create`/`rename`-Events. Zugriff nur über `vault.adapter.list()` und
`adapter.readBinary()`.

**PDF-Cover ist der Risikopunkt.** Es gibt kein eingebettetes Cover, die erste
Seite muss gerendert werden. Schlägt das fehl, bekommt das Buch eine Notiz ohne
Cover und einen Eintrag im Ingest-Report — der Ingest bricht nicht ab.

Beim Bauen sind dazu zwei Dinge aufgefallen, die beide nicht offensichtlich sind:

*pdf.js muss mit `intent: "print"` rendern.* Beim normalen Display-Rendering
treibt pdf.js den Vorgang mit `requestAnimationFrame` voran. Läuft der Ingest im
Hintergrund oder ist das Fenster verdeckt, feuert das nie — und `render()` bleibt
ohne Fehlermeldung für immer stehen. Das trat im Prüfstand selbst bei einem
handgeschriebenen Ein-Seiten-PDF auf, hat also nichts mit Dateigröße zu tun.

*Der Worker kommt aus einer Blob-URL.* Der Worker-Quelltext liegt als
Zeichenkette im Bündel (esbuild-Plugin in `esbuild-pdf-worker.mjs`) und wird zur
Laufzeit zu einer Blob-URL. Sonst müsste pdf.js im Hauptthread rendern, und ein
Ingest über hunderte PDFs würde Obsidian sekundenweise einfrieren. Obsidians
eigenes `window.pdfjsLib` kommt dafür nicht in Frage: das lädt Obsidian erst,
sobald einmal ein PDF geöffnet wurde.

**Pfade werden auf NFC normalisiert.** macOS liefert Dateinamen zerlegt (NFD):
„ü" ist dort `u` + kombinierendes Trema. Obsidian führt Pfade zusammengesetzt
(NFC). Ohne Angleichen schlüge der Pfadvergleich beim nächsten Scan fehl und
jedes Buch mit Umlaut im Pfad sähe verschoben aus. Dasselbe gilt für die
Tag-Erzeugung — sonst würde aus „Abendlektüre" das Tag `abendlektu-re`.

## 9. Oberfläche

**Zunächst keine eigene.** Das Plugin ist Scanner und Extraktor; die Ansicht ist
eine mitgelieferte `.base`-Datei mit Kartenlayout und Cover-Bild.

Begründung: Der wertvolle und schwierige Teil ist der Ingest. Bases liefert
Kartenansicht, Filtern, Sortieren, Gruppieren und Inline-Editieren ohne eine
Zeile Code. Und welche eigene Ansicht wirklich gebraucht wird, weiß man erst
nach einiger Zeit mit dem fertigen Katalog.

Ein eigener `ItemView` bleibt jederzeit nachrüstbar, ohne Migration — er läse
dieselben Notizen. Er würde sich lohnen für: Mehrfachauswahl mit
Massenbearbeitung, eigene Aktionen pro Buch, Kontrolle über das Seitenverhältnis
der Karten (Buchcover sind hochkant).

Fehler und Auffälligkeiten des Ingests landen in `_catalog/_ingest-report.md` —
als Markdown, damit sie auch unterwegs über Dropbox lesbar sind.

## 10. Entwicklungsumgebung

Das Plugin wird per Symlink in `Ebook Test Vault/.obsidian/plugins/` installiert.
`Ebook Vorrat/` enthält weitere Bücher, die zum Testen des laufenden Betriebs
nachträglich in die Test-Vault gelegt werden.
