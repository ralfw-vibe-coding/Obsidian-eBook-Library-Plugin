/**
 * Prüfstand für die Extraktion — läuft in Node gegen die echten Bücher, ohne
 * Obsidian. Cover-Skalierung und PDF-Rendering brauchen Browser-APIs und
 * fehlen hier absichtlich; getestet wird, was an Metadaten herauskommt.
 *
 *   npm run harness -- "<pfad zum bücher-ordner>"
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { DOMParser } from "@xmldom/xmldom";

(globalThis as Record<string, unknown>).DOMParser = DOMParser;

// In Node läuft pdf.js im Hauptthread; das Rendern der ersten Seite scheitert
// hier ohnehin mangels Canvas, die Metadaten kommen aber durch.
(globalThis as Record<string, unknown>).pdfjsWorker = await import(
	"pdfjs-dist/legacy/build/pdf.worker.mjs"
);

const { extractEpub } = await import("../src/epub");
const { extractPdf } = await import("../src/pdf");
const { parseFileName } = await import("../src/filename");
const { mergeMeta } = await import("../src/merge");
const { tagsFromPath } = await import("../src/tags");

const root = process.argv[2];
if (!root) {
	console.error("Aufruf: npm run harness -- <ordner>");
	process.exit(1);
}

for (const file of walk(root)) {
	const basename = file.split("/").pop() ?? file;
	const isEpub = basename.toLowerCase().endsWith(".epub");
	const data = toArrayBuffer(readFileSync(file));

	let extraction;
	try {
		extraction = isEpub ? extractEpub(data) : await extractPdf(data, basename);
	} catch (error) {
		console.log(`\n✗ ${relative(root, file)}\n   Extraktion geworfen: ${String(error)}`);
		continue;
	}

	const fromName = parseFileName(basename);
	const merged = mergeMeta(extraction.meta, fromName);

	console.log(`\n${relative(root, file)}`);
	console.log(`   Titel   ${show(merged.title)}   ${source(extraction.meta.title, fromName.title)}`);
	console.log(`   Autor   ${show(merged.author)}   ${source(extraction.meta.author, fromName.author)}`);
	console.log(`   Jahr    ${show(merged.year)}    Sprache ${show(merged.language)}`);
	console.log(`   Tags    ${tagsFromPath(relative(root, file)).join(", ") || "—"}`);
	console.log(`   Cover   ${describeCover(extraction.cover)}`);

	for (const warning of extraction.warnings) {
		if (warning.startsWith("Erste Seite nicht renderbar")) continue; // im Node-Lauf erwartet
		console.log(`   ! ${warning}`);
	}
}

function walk(directory: string): string[] {
	const found: string[] = [];
	for (const entry of readdirSync(directory)) {
		if (entry.startsWith(".") || entry.startsWith("_")) continue;

		const path = join(directory, entry);
		if (statSync(path).isDirectory()) found.push(...walk(path));
		else if (/\.(epub|pdf)$/i.test(entry)) found.push(path);
	}
	return found.sort();
}

function show(value: unknown): string {
	return value === undefined || value === "" ? "—" : String(value);
}

function source(fromBook: unknown, fromName: unknown): string {
	if (fromBook) return "(Buch)";
	if (fromName) return "(Dateiname)";
	return "";
}

function describeCover(cover: ArrayBuffer | undefined): string {
	if (!cover) return "—";

	const bytes = new Uint8Array(cover.slice(0, 4));
	const kind =
		bytes[0] === 0xff && bytes[1] === 0xd8
			? "jpeg"
			: bytes[0] === 0x89 && bytes[1] === 0x50
				? "png"
				: "unbekannt";
	return `${kind}, ${Math.round(cover.byteLength / 1024)} KB`;
}

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
	return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}
