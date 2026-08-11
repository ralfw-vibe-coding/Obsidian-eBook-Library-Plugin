/**
 * Erzeugt eine Wegwerf-Vault mit vielen Katalog-Notizen, um den View unter
 * realistischer Last anzusehen. Die Cover der Test-Vault werden reihum
 * wiederverwendet; echte EPUB- oder PDF-Dateien braucht der View nicht.
 *
 *   node test/make-big-vault.mjs "../Ebook Test Vault" "../Ebook Grosse Vault" 5000
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [source, target, countArg] = process.argv.slice(2);
if (!source || !target) {
	console.error('Aufruf: node test/make-big-vault.mjs <quell-vault> <ziel-vault> [anzahl]');
	process.exit(1);
}

const count = Number(countArg ?? 5000);
const TAGS = [
	"sachbücher", "belletristik", "geschichte", "biologie", "physik", "krimis",
	"klassiker", "abendlektüre", "philosophie", "reise", "kochen", "informatik",
	"psychologie", "kunst", "musik", "wirtschaft",
];
const WORDS = [
	"Schatten", "Licht", "Meer", "Berg", "Stadt", "Nacht", "Reise", "Haus", "Garten",
	"Brief", "Stimme", "Weg", "Feuer", "Wasser", "Stein", "Wind", "Traum", "Spiegel",
];
const NAMES = ["Berg", "Klein", "Weber", "Roth", "Falk", "Mayer", "Sturm", "Winter", "Lang", "Kern"];
const FIRST = ["Anna", "Jonas", "Clara", "Felix", "Mira", "Tobias", "Lena", "Ruben", "Ida", "Nils"];

/** Sieht aus wie ein SHA-256 und enthält Buchstaben — reine Ziffern läse YAML als Zahl. */
const fakeHash = (n) => `${n.toString(16)}`.padStart(8, "0").repeat(8).slice(0, 64);

/** Ohne Zufall, damit zwei Läufe dieselbe Vault ergeben. */
const pick = (list, n) => list[n % list.length];

rmSync(target, { recursive: true, force: true });
mkdirSync(join(target, "_catalog", "covers"), { recursive: true });

const sourceCovers = join(source, "_catalog", "covers");
const covers = existsSync(sourceCovers) ? readdirSync(sourceCovers).filter((f) => f.endsWith(".jpg")) : [];
for (const cover of covers) {
	copyFileSync(join(sourceCovers, cover), join(target, "_catalog", "covers", cover));
}
if (covers.length === 0) console.warn("Warnung: keine Cover in der Quell-Vault gefunden.");

for (let i = 0; i < count; i++) {
	const title = `${pick(WORDS, i)} ${pick(WORDS, i * 7 + 3)} ${i + 1}`;
	const author = `${pick(FIRST, i * 3)} ${pick(NAMES, i * 5)}`;
	const format = i % 7 === 0 ? "pdf" : "epub";
	const size = format === "pdf" ? 4_000_000 + (i % 40) * 1_100_000 : 200_000 + (i % 30) * 90_000;
	const tags = [pick(TAGS, i), pick(TAGS, i * 3 + 1), pick(TAGS, i * 11 + 5)];
	const cover = covers.length > 0 ? covers[i % covers.length] : null;

	const lines = [
		"---",
		`hash: "${fakeHash(i)}"`,
		`file: "Bücher/${title}.${format}"`,
		`format: ${format}`,
		`size: ${size}`,
		...(cover ? [`cover: "[[${cover}]]"`] : []),
		"ingested: 2026-08-11",
		`title: "${title}"`,
		`author: "${author}"`,
		`year: ${1950 + (i % 75)}`,
		"language: de",
		"tags:",
		...[...new Set(tags)].map((t) => `  - ${t}`),
		"---",
		"",
	];

	writeFileSync(join(target, "_catalog", `${title} - ${author}.md`), lines.join("\n"));
}

console.log(`${count} Notizen in ${target} erzeugt, ${covers.length} Cover wiederverwendet.`);
console.log("Diese Vault in Obsidian öffnen, Plugin aktivieren, Bibliothek öffnen.");
