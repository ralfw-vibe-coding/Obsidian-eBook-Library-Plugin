import { normalizePath, type App, type TFile } from "obsidian";
import { CATALOG_FOLDER, COVERS_FOLDER, type BookFormat, type BookMeta } from "./types";

/**
 * Lesen und Schreiben der Katalog-Notizen.
 *
 * Nach dem Anlegen schreibt das Plugin nur noch `file` und `orphaned`.
 * Alles andere gehört dem Nutzer. Siehe KONZEPT.md, Abschnitt 7.
 */

export const FIELD = {
	hash: "hash",
	file: "file",
	format: "format",
	size: "size",
	cover: "cover",
	ingested: "ingested",
	title: "title",
	author: "author",
	year: "year",
	language: "language",
	tags: "tags",
	orphaned: "orphaned",
} as const;

/** Nachschlagetabelle für einen Scan. Wird aus den Notizen abgeleitet, nicht persistiert. */
export interface CatalogIndex {
	byHash: Map<string, TFile>;
	/** Schlüssel: `pfad\0größe`. Die billige Frage, die kein Dateilesen braucht. */
	byPathSize: Map<string, TFile>;
	/** Buchpfad -> Notiz, für die Verwaisten-Erkennung. */
	byBookPath: Map<string, TFile>;
}

export function pathSizeKey(path: string, size: number): string {
	return `${path}\u0000${size}`;
}

/**
 * Den Hash aus dem Frontmatter lesen.
 *
 * Zahlen werden mit übernommen: ein Hash aus lauter Ziffern liest YAML als
 * Zahl statt als Zeichenkette. Beim Schreiben wird er deshalb quotiert — aber
 * ältere und von Hand erzeugte Notizen müssen weiter gelesen werden können.
 */
export function readHash(frontmatter: Record<string, unknown> | undefined): string | null {
	const value = frontmatter?.[FIELD.hash];
	if (typeof value === "string") return value.trim() || null;
	if (typeof value === "number" && Number.isFinite(value)) return String(value);
	return null;
}

/**
 * Der Aufbau kostet keine Dateizugriffe: Obsidian hält das Frontmatter aller
 * Markdown-Dateien ohnehin im metadataCache. Siehe KONZEPT.md, Abschnitt 6.
 */
export function buildIndex(app: App): CatalogIndex {
	const index: CatalogIndex = {
		byHash: new Map(),
		byPathSize: new Map(),
		byBookPath: new Map(),
	};

	for (const note of catalogNotes(app)) {
		const frontmatter = app.metadataCache.getFileCache(note)?.frontmatter;
		const hash = readHash(frontmatter);
		const bookPath = frontmatter?.[FIELD.file];
		const size = frontmatter?.[FIELD.size];
		if (!hash) continue;

		index.byHash.set(hash, note);
		if (typeof bookPath === "string" && bookPath) {
			index.byBookPath.set(bookPath, note);
			if (typeof size === "number") {
				index.byPathSize.set(pathSizeKey(bookPath, size), note);
			}
		}
	}

	return index;
}

export function catalogNotes(app: App): TFile[] {
	const prefix = `${CATALOG_FOLDER}/`;
	return app.vault
		.getMarkdownFiles()
		.filter((file) => file.path.startsWith(prefix) && !file.name.startsWith("_"));
}

export function frontmatterOf(app: App, note: TFile): Record<string, unknown> | undefined {
	return app.metadataCache.getFileCache(note)?.frontmatter;
}

export interface NewNote {
	hash: string;
	bookPath: string;
	format: BookFormat;
	size: number;
	meta: BookMeta;
	tags: string[];
	coverFileName?: string;
	/** Zeitstempel des Laufs, der dieses Buch aufgenommen hat. */
	ingestedAt: string;
}

export async function createNote(app: App, note: NewNote): Promise<TFile> {
	await ensureFolder(app, CATALOG_FOLDER);

	const path = await uniqueNotePath(app, note.meta);
	const content = renderNote(note);
	return await app.vault.create(path, content);
}

function renderNote(note: NewNote): string {
	const lines: string[] = ["---"];

	// Quotiert, damit YAML einen Hash aus lauter Ziffern nicht als Zahl liest.
	lines.push(`${FIELD.hash}: ${yamlString(note.hash)}`);
	lines.push(`${FIELD.file}: ${yamlString(note.bookPath)}`);
	lines.push(`${FIELD.format}: ${note.format}`);
	lines.push(`${FIELD.size}: ${note.size}`);
	if (note.coverFileName) {
		lines.push(`${FIELD.cover}: ${yamlString(`[[${note.coverFileName}]]`)}`);
	}
	lines.push(`${FIELD.ingested}: ${yamlString(note.ingestedAt)}`);

	lines.push(`${FIELD.title}: ${yamlString(note.meta.title ?? "")}`);
	lines.push(`${FIELD.author}: ${note.meta.author ? yamlString(note.meta.author) : ""}`);
	lines.push(`${FIELD.year}: ${note.meta.year ?? ""}`);
	lines.push(`${FIELD.language}: ${note.meta.language ?? ""}`);

	lines.push(`${FIELD.tags}:`);
	for (const tag of note.tags) lines.push(`  - ${tag}`);

	lines.push("---", "");
	return lines.join("\n");
}

/**
 * Der Dateiname ist reine Bequemlichkeit — identifiziert wird über den Hash.
 * Er darf jederzeit von Hand geändert werden. Siehe KONZEPT.md, Abschnitt 4.
 */
export async function uniqueNotePath(app: App, meta: BookMeta): Promise<string> {
	const base = sanitizeFileName(
		[meta.title || "Ohne Titel", meta.author].filter(Boolean).join(" - "),
	);

	let candidate = normalizePath(`${CATALOG_FOLDER}/${base}.md`);
	let counter = 2;
	while (await app.vault.adapter.exists(candidate)) {
		candidate = normalizePath(`${CATALOG_FOLDER}/${base} ${counter}.md`);
		counter++;
	}
	return candidate;
}

export function sanitizeFileName(name: string): string {
	const cleaned = name
		.replace(/[\\/:*?"<>|#^[\]]/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.replace(/^\.+/, "")
		.replace(/\.+$/, "")
		.trim();

	const limited = cleaned.length > 150 ? cleaned.slice(0, 150).trim() : cleaned;
	return limited || "Ohne Titel";
}

export async function writeCover(app: App, hash: string, jpeg: ArrayBuffer): Promise<string> {
	await ensureFolder(app, COVERS_FOLDER);

	const fileName = `${hash}.jpg`;
	const path = normalizePath(`${COVERS_FOLDER}/${fileName}`);
	if (await app.vault.adapter.exists(path)) {
		await app.vault.adapter.writeBinary(path, jpeg);
	} else {
		await app.vault.createBinary(path, jpeg);
	}
	return fileName;
}

/** Das Buch wurde umbenannt oder verschoben: nur der Pfad wandert mit. */
export async function updateBookPath(app: App, note: TFile, bookPath: string): Promise<void> {
	await app.fileManager.processFrontMatter(note, (frontmatter) => {
		frontmatter[FIELD.file] = bookPath;
	});
}

/**
 * Verwaiste Notizen werden markiert, nie gelöscht — sonst könnte ein
 * versehentlich verschobener Ordner handgeschriebene Rezensionen vernichten.
 */
export async function markOrphaned(app: App, note: TFile, today: string): Promise<void> {
	await app.fileManager.processFrontMatter(note, (frontmatter) => {
		if (!frontmatter[FIELD.orphaned]) frontmatter[FIELD.orphaned] = today;
	});
}

export async function clearOrphaned(app: App, note: TFile): Promise<void> {
	await app.fileManager.processFrontMatter(note, (frontmatter) => {
		delete frontmatter[FIELD.orphaned];
	});
}

export async function ensureFolder(app: App, folder: string): Promise<void> {
	const path = normalizePath(folder);
	if (await app.vault.adapter.exists(path)) return;
	await app.vault.createFolder(path).catch(() => undefined);
}

function yamlString(value: string): string {
	return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
