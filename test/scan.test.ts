/**
 * Fährt den echten Scanner gegen eine Wegwerf-Kopie der Test-Vault und prüft
 * die vier Zweige aus KONZEPT.md, Abschnitt 6: Ingest, Überspringen,
 * Verschieben, Verwaisen.
 */
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DOMParser } from "@xmldom/xmldom";

(globalThis as Record<string, unknown>).DOMParser = DOMParser;

const { scanLibrary } = await import("../src/scan");
const { App, parseFrontMatter } = await import("./obsidian-stub");

const source = process.argv[2];
assert.ok(source, "Aufruf: node test/.scan.test.mjs <pfad zur test-vault>");

const root = mkdtempSync(join(tmpdir(), "ebook-library-"));
cpSync(source, root, { recursive: true });
// Die Kopie muss jungfräulich sein: weder Obsidian-Konfiguration noch ein
// Katalog aus einem früheren echten Lauf dürfen mitkommen.
rmSync(join(root, ".obsidian"), { recursive: true, force: true });
rmSync(join(root, "_catalog"), { recursive: true, force: true });

const app = new App(root) as never;
let failures = 0;

function check(label: string, condition: boolean, detail = ""): void {
	console.log(`${condition ? "✓" : "✗"} ${label}${detail && !condition ? ` — ${detail}` : ""}`);
	if (!condition) failures++;
}

// ---------------------------------------------------------------- erster Scan
const first = await scanLibrary(app);
check("erster Scan nimmt alle Bücher auf", first.ingested.length === first.scanned,
	`${first.ingested.length} von ${first.scanned}`);
check("erster Scan überspringt nichts", first.skipped === 0, `${first.skipped}`);
check("erster Scan meldet keine Verwaisten", first.orphaned.length === 0);

const notes = readdirSync(join(root, "_catalog")).filter((name) => name.endsWith(".md"));
check("eine Notiz je Buch", notes.length === first.scanned, `${notes.length} Notizen`);

// Cover brauchen Canvas-APIs, die es in Node nicht gibt — die prüft der
// Browser-Prüfstand (test/browser.ts). Hier zählt nur, dass der Ingest
// trotzdem sauber durchläuft und der Ordner richtig benannt wäre.
const coversFolder = join(root, "_catalog", "covers");
if (existsSync(coversFolder)) {
	const covers = readdirSync(coversFolder);
	check("Cover heißen nach dem Hash", covers.every((name) => /^[0-9a-f]{64}\.jpg$/.test(name)));
} else {
	console.log("· Cover-Prüfung übersprungen (kein Canvas in Node)");
}

const sample = frontmatterOf(notes.find((name) => name.startsWith("Alexandria"))!);
check("Titel im Frontmatter", sample.title === "Alexandria", String(sample.title));
check("Autor im Frontmatter", sample.author === "Paul Kingsnorth", String(sample.author));
check("Größe ist eine Zahl", typeof sample.size === "number", typeof sample.size);
check("Hash ist ein SHA-256", /^[0-9a-f]{64}$/.test(String(sample.hash)));
check("Tags aus dem Pfad", Array.isArray(sample.tags) && sample.tags.includes("abendlektüre"),
	JSON.stringify(sample.tags));

// --------------------------------------------------------------- zweiter Scan
const second = await scanLibrary(app);
check("zweiter Scan überspringt alles", second.skipped === second.scanned,
	`${second.skipped} von ${second.scanned}`);
check("zweiter Scan legt nichts neu an", second.ingested.length === 0);
check("zweiter Scan meldet keine Verwaisten", second.orphaned.length === 0,
	JSON.stringify(second.orphaned));

// ------------------------------------------------------------------ Umbenennen
const before = frontmatterOf(notes.find((name) => name.startsWith("Alexandria"))!);
renameSync(
	join(root, "Abendlektüre/Alexandria (Paul Kingsnorth).epub"),
	join(root, "Sachbücher/Umbenannt.epub"),
);

const third = await scanLibrary(app);
check("Verschieben wird erkannt", third.moved.length === 1, JSON.stringify(third.moved));
check("Verschieben legt nichts neu an", third.ingested.length === 0);
check("Verschieben meldet keine Verwaisten", third.orphaned.length === 0);

const after = frontmatterOf(notes.find((name) => name.startsWith("Alexandria"))!);
check("Pfad wurde nachgezogen", after.file === "Sachbücher/Umbenannt.epub", String(after.file));
check("Tags bleiben unangetastet", JSON.stringify(after.tags) === JSON.stringify(before.tags),
	`${JSON.stringify(before.tags)} -> ${JSON.stringify(after.tags)}`);
check("Hash bleibt gleich", after.hash === before.hash);

// -------------------------------------------------------------------- Löschen
rmSync(join(root, "Sachbücher/Umbenannt.epub"));

const fourth = await scanLibrary(app);
check("Fehlende Datei wird verwaist gemeldet", fourth.orphaned.length === 1,
	JSON.stringify(fourth.orphaned));
check("Notiz bleibt erhalten", readdirSync(join(root, "_catalog")).includes(notes.find((n) => n.startsWith("Alexandria"))!));

const orphaned = frontmatterOf(notes.find((name) => name.startsWith("Alexandria"))!);
check("Verwaist-Markierung gesetzt", typeof orphaned.orphaned === "string" && orphaned.orphaned !== "",
	String(orphaned.orphaned));
check("Notiztext ist noch da", readFileSync(join(root, "_catalog", notes.find((n) => n.startsWith("Alexandria"))!), "utf8").includes("---"));

// ---------------------------------------------------------- Wiederauftauchen
cpSync(
	join(source, "Abendlektüre/Alexandria (Paul Kingsnorth).epub"),
	join(root, "Abendlektüre/Alexandria (Paul Kingsnorth).epub"),
);

const fifth = await scanLibrary(app);
check("Wiederaufgetauchtes Buch wird erkannt", fifth.revived.length === 1, JSON.stringify(fifth.revived));
check("Wiederauftauchen legt nichts neu an", fifth.ingested.length === 0);
check("Verwaist-Markierung entfernt",
	frontmatterOf(notes.find((name) => name.startsWith("Alexandria"))!).orphaned === undefined);

rmSync(root, { recursive: true, force: true });
console.log(failures === 0 ? "\nAlle Prüfungen bestanden." : `\n${failures} Prüfung(en) fehlgeschlagen.`);
process.exit(failures === 0 ? 0 : 1);

function frontmatterOf(noteName: string): Record<string, unknown> {
	return parseFrontMatter(readFileSync(join(root, "_catalog", noteName), "utf8")) ?? {};
}
