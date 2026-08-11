import type { App, TFile } from "obsidian";
import { extractEpub } from "./epub";
import { parseFileName } from "./filename";
import { sha256 } from "./hash";
import { mergeMeta } from "./merge";
import { normalizeCover } from "./cover";
import {
	FIELD,
	buildIndex,
	catalogNotes,
	clearOrphaned,
	createNote,
	frontmatterOf,
	markOrphaned,
	pathSizeKey,
	updateBookPath,
	writeCover,
	type CatalogIndex,
} from "./note";
import { extractPdf } from "./pdf";
import { tagsFromPath } from "./tags";
import {
	BOOK_EXTENSIONS,
	CATALOG_FOLDER,
	type BookFormat,
	type Extraction,
	type FoundFile,
	type ScanResult,
} from "./types";

export interface ScanOptions {
	/** Alles neu hashen, statt bekannte Pfad/Größe-Paare zu überspringen. */
	rehashAll?: boolean;
	onProgress?: (done: number, total: number, label: string) => void;
}

/**
 * Der einzige Vorgang im Plugin, der überhaupt Buchdateien anfasst.
 * Siehe KONZEPT.md, Abschnitt 6.
 */
export async function scanLibrary(app: App, options: ScanOptions = {}): Promise<ScanResult> {
	const result: ScanResult = {
		scanned: 0,
		skipped: 0,
		ingested: [],
		moved: [],
		orphaned: [],
		revived: [],
		problems: [],
	};

	const files = await listBookFiles(app);
	const index = buildIndex(app);
	const today = isoDate();

	/** Notizen, zu denen eine Datei gefunden wurde — alles andere ist verwaist. */
	const seenNotes = new Set<string>();

	result.scanned = files.length;

	for (const [position, file] of files.entries()) {
		options.onProgress?.(position, files.length, file.path);

		try {
			await processFile(app, file, index, seenNotes, result, today, options);
		} catch (error) {
			result.problems.push({ path: file.path, message: describe(error) });
		}

		// pdf.js rendert im Hauptthread; ohne Atempause friert die Oberfläche ein.
		await yieldToUi();
	}

	await markMissingAsOrphaned(app, index, seenNotes, result, today);

	return result;
}

async function processFile(
	app: App,
	file: FoundFile,
	index: CatalogIndex,
	seenNotes: Set<string>,
	result: ScanResult,
	today: string,
	options: ScanOptions,
): Promise<void> {
	// Die billige Frage zuerst: unveränderter Pfad bei unveränderter Größe.
	if (!options.rehashAll) {
		const known = index.byPathSize.get(pathSizeKey(file.path, file.size));
		if (known) {
			seenNotes.add(known.path);
			result.skipped++;
			return;
		}
	}

	const data = await app.vault.adapter.readBinary(file.path);
	const hash = await sha256(data);

	const existing = index.byHash.get(hash);
	if (existing) {
		seenNotes.add(existing.path);
		await reconcileExisting(app, existing, file, result);
		return;
	}

	const note = await ingest(app, file, hash, data, today, result);
	seenNotes.add(note.path);
	index.byHash.set(hash, note);
	index.byPathSize.set(pathSizeKey(file.path, file.size), note);
	result.ingested.push(file.path);
}

/**
 * Der Hash ist bekannt, das Buch wurde also nur umbenannt oder verschoben.
 * Kein neuer Ingest, kein Cover neu extrahieren, keine Tags anfassen.
 */
async function reconcileExisting(
	app: App,
	note: TFile,
	file: FoundFile,
	result: ScanResult,
): Promise<void> {
	const frontmatter = frontmatterOf(app, note);
	const previousPath = frontmatter?.[FIELD.file];

	if (previousPath !== file.path) {
		await updateBookPath(app, note, file.path);
		result.moved.push({ from: String(previousPath ?? "?"), to: file.path });
	}

	if (frontmatter?.[FIELD.orphaned]) {
		await clearOrphaned(app, note);
		result.revived.push(note.path);
	}
}

async function ingest(
	app: App,
	file: FoundFile,
	hash: string,
	data: ArrayBuffer,
	today: string,
	result: ScanResult,
): Promise<TFile> {
	const basename = file.path.split("/").pop() ?? file.path;

	let extraction: Extraction;
	try {
		extraction =
			file.format === "epub" ? extractEpub(data) : await extractPdf(data, basename);
	} catch (error) {
		extraction = { meta: {}, warnings: [`Extraktion fehlgeschlagen: ${describe(error)}`] };
	}

	for (const warning of extraction.warnings) {
		result.problems.push({ path: file.path, message: warning });
	}

	const meta = mergeMeta(extraction.meta, parseFileName(basename));
	const coverFileName = await storeCover(app, hash, extraction, file.path, result);

	return await createNote(app, {
		hash,
		bookPath: file.path,
		format: file.format,
		size: file.size,
		meta,
		tags: tagsFromPath(file.path),
		coverFileName,
		today,
	});
}

async function storeCover(
	app: App,
	hash: string,
	extraction: Extraction,
	bookPath: string,
	result: ScanResult,
): Promise<string | undefined> {
	if (!extraction.cover) return undefined;

	try {
		const jpeg = extraction.coverIsJpeg
			? extraction.cover
			: await normalizeCover(extraction.cover);
		return await writeCover(app, hash, jpeg);
	} catch (error) {
		result.problems.push({ path: bookPath, message: `Cover nicht verwertbar: ${describe(error)}` });
		return undefined;
	}
}

async function markMissingAsOrphaned(
	app: App,
	index: CatalogIndex,
	seenNotes: Set<string>,
	result: ScanResult,
	today: string,
): Promise<void> {
	for (const note of new Set(index.byHash.values())) {
		if (seenNotes.has(note.path)) continue;
		if (frontmatterOf(app, note)?.[FIELD.orphaned]) continue;

		await markOrphaned(app, note, today);
		result.orphaned.push(note.path);
	}
}

/**
 * Metadaten und Cover *aller* Bücher neu holen.
 *
 * Ein normaler Scan hilft dafür nicht: der überspringt unveränderte Dateien,
 * und auch das vollständige Neu-Hashen erkennt sie am Hash wieder und lässt
 * die Notiz in Ruhe. Nötig wird das, wenn die Extraktion im Plugin besser
 * geworden ist — die Bücher haben sich ja nicht geändert, nur das Auslesen.
 */
export async function reingestAll(app: App, options: ScanOptions = {}): Promise<ScanResult> {
	const result: ScanResult = {
		scanned: 0,
		skipped: 0,
		ingested: [],
		moved: [],
		orphaned: [],
		revived: [],
		problems: [],
	};

	const notes = catalogNotes(app).filter(
		(note) => typeof frontmatterOf(app, note)?.[FIELD.hash] === "string",
	);
	result.scanned = notes.length;

	for (const [position, note] of notes.entries()) {
		options.onProgress?.(position, notes.length, note.basename);

		try {
			const warnings = await reingestNote(app, note);
			result.ingested.push(note.path);
			for (const warning of warnings) {
				result.problems.push({ path: note.path, message: warning });
			}
		} catch (error) {
			result.problems.push({ path: note.path, message: describe(error) });
		}

		await yieldToUi();
	}

	return result;
}

/**
 * Metadaten und Cover einer einzelnen Notiz neu aus der Buchdatei holen.
 * Passiert ausschließlich auf ausdrücklichen Befehl — Tags und Notiztext
 * bleiben unangetastet. Siehe KONZEPT.md, Abschnitt 7.
 */
export async function reingestNote(app: App, note: TFile): Promise<string[]> {
	const frontmatter = frontmatterOf(app, note);
	const bookPath = frontmatter?.[FIELD.file];
	const hash = frontmatter?.[FIELD.hash];

	if (typeof bookPath !== "string" || typeof hash !== "string") {
		throw new Error("Das ist keine Katalog-Notiz (hash oder file fehlt).");
	}
	if (!(await app.vault.adapter.exists(bookPath))) {
		throw new Error(`Die Buchdatei ${bookPath} existiert nicht mehr.`);
	}

	const basename = bookPath.split("/").pop() ?? bookPath;
	const format: BookFormat = formatOf(bookPath) ?? "epub";
	const data = await app.vault.adapter.readBinary(bookPath);

	const extraction =
		format === "epub" ? extractEpub(data) : await extractPdf(data, basename);
	const meta = mergeMeta(extraction.meta, parseFileName(basename));

	let coverFileName: string | undefined;
	if (extraction.cover) {
		const jpeg = extraction.coverIsJpeg
			? extraction.cover
			: await normalizeCover(extraction.cover);
		coverFileName = await writeCover(app, hash, jpeg);
	}

	await app.fileManager.processFrontMatter(note, (target) => {
		target[FIELD.title] = meta.title ?? "";
		target[FIELD.author] = meta.author ?? "";
		target[FIELD.year] = meta.year ?? "";
		target[FIELD.language] = meta.language ?? "";
		if (coverFileName) target[FIELD.cover] = `[[${coverFileName}]]`;
	});

	return extraction.warnings;
}

async function listBookFiles(app: App): Promise<FoundFile[]> {
	const found: FoundFile[] = [];
	const adapter = app.vault.adapter;

	const walk = async (folder: string): Promise<void> => {
		const listing = await adapter.list(folder);

		for (const rawPath of listing.files) {
			const format = formatOf(rawPath);
			if (!format) continue;

			const stat = await adapter.stat(rawPath);
			if (!stat) continue;

			// macOS liefert Dateinamen zerlegt (NFD), Obsidian führt Pfade intern
			// zusammengesetzt (NFC). Ohne Angleichen schlüge der Pfadvergleich
			// beim nächsten Scan fehl und jedes Buch mit Umlaut sähe verschoben aus.
			found.push({ path: rawPath.normalize("NFC"), size: stat.size, format });
		}

		for (const subfolder of listing.folders) {
			const name = subfolder.split("/").pop() ?? "";
			if (name.startsWith(".")) continue;
			if (subfolder === CATALOG_FOLDER) continue;
			await walk(subfolder);
		}
	};

	await walk("");
	found.sort((a, b) => a.path.localeCompare(b.path));
	return found;
}

function formatOf(path: string): BookFormat | null {
	const extension = path.split(".").pop()?.toLowerCase();
	return BOOK_EXTENSIONS.includes(extension as BookFormat) ? (extension as BookFormat) : null;
}

function isoDate(): string {
	const now = new Date();
	const month = String(now.getMonth() + 1).padStart(2, "0");
	const day = String(now.getDate()).padStart(2, "0");
	return `${now.getFullYear()}-${month}-${day}`;
}

function yieldToUi(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

function describe(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
