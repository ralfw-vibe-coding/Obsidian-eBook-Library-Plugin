/**
 * Prüft die Teile des Imports, die ohne Vault auskommen: die Umbenennung nach
 * der Konvention `Titel - Autor`, die Tags aus dem Zielordner und die
 * Formaterkennung.
 */
import { cleanTags, formatOf, tagsForFolder, targetName } from "../src/import";

let failures = 0;

function check(label: string, condition: boolean, detail = ""): void {
	console.log(`${condition ? "✓" : "✗"} ${label}${!condition && detail ? ` — ${detail}` : ""}`);
	if (!condition) failures++;
}

// --- Format ----------------------------------------------------------------

check("EPUB erkannt", formatOf("Buch.epub") === "epub");
check("PDF erkannt, auch in Großbuchstaben", formatOf("BUCH.PDF") === "pdf");
check("alles andere wird abgelehnt", formatOf("cover.jpg") === null && formatOf("ohne") === null);

// --- Dateiname nach Konvention ---------------------------------------------

check(
	"Titel und Autor werden verbunden",
	targetName({ title: "Alexandria", author: "Paul Kingsnorth" }, "epub") ===
		"Alexandria - Paul Kingsnorth.epub",
	targetName({ title: "Alexandria", author: "Paul Kingsnorth" }, "epub"),
);
check(
	"ohne Autor nur der Titel",
	targetName({ title: "Der Ruf der Wildnis" }, "pdf") === "Der Ruf der Wildnis.pdf",
);
check(
	"ohne alles ein Notname",
	targetName({}, "epub") === "Ohne Titel.epub",
	targetName({}, "epub"),
);
// Doppelpunkte und Schrägstriche gehen in Dateinamen nicht.
check(
	"unerlaubte Zeichen fallen weg",
	targetName({ title: "The Body Electric: Life/Death", author: "Becker" }, "epub") ===
		"The Body Electric Life Death - Becker.epub",
	targetName({ title: "The Body Electric: Life/Death", author: "Becker" }, "epub"),
);

// --- Tags aus dem Zielordner ------------------------------------------------

check(
	"jedes Pfadsegment wird ein Tag",
	tagsForFolder("Sachbücher/Geschichte").join() === "sachbücher,geschichte",
	tagsForFolder("Sachbücher/Geschichte").join(),
);
check(
	"Umlaute bleiben, Leerzeichen werden Bindestriche",
	tagsForFolder("Alte Geschichte").join() === "alte-geschichte",
	tagsForFolder("Alte Geschichte").join(),
);
check("ohne Ordner keine Tags", tagsForFolder("").length === 0);

// --- Tags aus dem Eingabefeld ----------------------------------------------

check("Kommaliste wird zerlegt", cleanTags("krimis, klassiker").join() === "krimis,klassiker");
check("Leerraum und Groß-/Kleinschreibung werden geglättet", cleanTags(" Krimis ,  KLASSIKER ").join() === "krimis,klassiker");
check("Doppelte fallen weg", cleanTags("krimis, krimis").join() === "krimis");
check("Leeres ergibt nichts", cleanTags("  ,  ").length === 0);

console.log(failures === 0 ? "\nAlle Prüfungen bestanden." : `\n${failures} Prüfung(en) fehlgeschlagen.`);
process.exit(failures === 0 ? 0 : 1);
