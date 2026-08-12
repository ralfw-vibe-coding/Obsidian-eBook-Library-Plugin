import { normalizePath, type App, type TFile } from "obsidian";
import { normalizeCover } from "./cover";
import { extractEpub } from "./epub";
import { parseFileName } from "./filename";
import { sha256 } from "./hash";
import { mergeMeta } from "./merge";
import {
	FIELD,
	buildIndex,
	createNote,
	ensureFolder,
	sanitizeFileName,
	writeCover,
} from "./note";
import { extractPdf } from "./pdf";
import { normalizeTag, tagsFromPath } from "./tags";
import { BOOK_EXTENSIONS, CATALOG_FOLDER, type BookFormat, type BookMeta } from "./types";

/**
 * Bücher von außerhalb in die Vault holen.
 *
 * Gelesen wird zuerst nur in den Speicher: Hash, Metadaten, Cover. Erst wenn
 * bestätigt ist, landet etwas in der Vault. Ein Scan ist danach nicht nötig —
 * der Import schreibt die Notiz selbst.
 */

export interface Candidate {
	/** Name, wie die Datei beim Nutzer heißt. */
	sourceName: string;
	/** Absoluter Pfad, sofern Electron ihn hergibt — nur fürs spätere Wegräumen. */
	sourcePath: string | null;
	format: BookFormat;
	bytes: ArrayBuffer;
	size: number;
	hash: string;
	meta: BookMeta;
	cover?: ArrayBuffer;
	coverIsJpeg?: boolean;
	warnings: string[];
	/** Steht dieses Buch schon im Katalog? Dann ist der Import gesperrt. */
	duplicateOf: TFile | null;
}

export interface ImportChoice {
	folder: string;
	meta: BookMeta;
	tags: string[];
}

export function formatOf(name: string): BookFormat | null {
	const extension = name.split(".").pop()?.toLowerCase();
	return BOOK_EXTENSIONS.includes(extension as BookFormat) ? (extension as BookFormat) : null;
}

/** Liest die Dateien aus, ohne etwas zu schreiben. */
export async function prepare(app: App, files: File[]): Promise<Candidate[]> {
	const index = buildIndex(app);
	const candidates: Candidate[] = [];

	for (const file of files) {
		const format = formatOf(file.name);
		if (!format) continue;

		const bytes = await file.arrayBuffer();
		const hash = await sha256(bytes);

		let extraction;
		try {
			extraction =
				format === "epub" ? extractEpub(bytes) : await extractPdf(bytes, file.name);
		} catch (error) {
			extraction = {
				meta: {},
				warnings: [`Auslesen fehlgeschlagen: ${error instanceof Error ? error.message : String(error)}`],
			};
		}

		candidates.push({
			sourceName: file.name,
			sourcePath: pathOf(file),
			format,
			bytes,
			size: bytes.byteLength,
			hash,
			meta: mergeMeta(extraction.meta, parseFileName(file.name)),
			cover: extraction.cover,
			coverIsJpeg: extraction.coverIsJpeg,
			warnings: extraction.warnings,
			duplicateOf: index.byHash.get(hash) ?? null,
		});
	}

	return candidates;
}

/**
 * Wohin gehört das Buch? Stärkstes Signal ist der Autor: steht schon etwas von
 * ihm im Katalog, kommt das neue Buch in denselben Ordner.
 */
export function suggestFolder(app: App, meta: BookMeta, fallback: string | null): string | null {
	const author = (meta.author ?? "").trim().toLowerCase();
	if (author) {
		const index = buildIndex(app);
		for (const note of new Set(index.byHash.values())) {
			const frontmatter = app.metadataCache.getFileCache(note)?.frontmatter;
			if (String(frontmatter?.[FIELD.author] ?? "").trim().toLowerCase() !== author) continue;

			const bookPath = String(frontmatter?.[FIELD.file] ?? "");
			const folder = bookPath.includes("/") ? bookPath.slice(0, bookPath.lastIndexOf("/")) : "";
			if (folder) return folder;
		}
	}

	return fallback;
}

/** Alle Ordner der Vault, in denen Bücher liegen dürfen. */
export function bookFolders(app: App): string[] {
	const folders = new Set<string>();

	for (const file of app.vault.getFiles()) {
		if (!file.path.includes("/")) continue;
		const folder = file.path.slice(0, file.path.lastIndexOf("/"));
		if (folder.startsWith(CATALOG_FOLDER) || folder.startsWith(".")) continue;

		// Auch die Elternordner anbieten, nicht nur die tiefsten.
		const parts = folder.split("/");
		for (let depth = 1; depth <= parts.length; depth++) {
			folders.add(parts.slice(0, depth).join("/"));
		}
	}

	return [...folders].sort((a, b) => a.localeCompare(b, "de"));
}

/** Tags, die aus einem Zielordner folgen würden. */
export function tagsForFolder(folder: string): string[] {
	return tagsFromPath(`${folder}/x.epub`);
}

export function cleanTags(input: string): string[] {
	const tags: string[] = [];
	for (const raw of input.split(",")) {
		const tag = normalizeTag(raw);
		if (tag && !tags.includes(tag)) tags.push(tag);
	}
	return tags;
}

/** Der Dateiname nach der Konvention `Titel - Autor.epub`. */
export function targetName(meta: BookMeta, format: BookFormat): string {
	const base = sanitizeFileName(
		[meta.title || "Ohne Titel", meta.author].filter(Boolean).join(" - "),
	);
	return `${base}.${format}`;
}

export async function freeTargetPath(app: App, folder: string, name: string): Promise<string> {
	const dot = name.lastIndexOf(".");
	const base = name.slice(0, dot);
	const extension = name.slice(dot);

	let candidate = normalizePath(`${folder}/${base}${extension}`);
	let counter = 2;
	while (await app.vault.adapter.exists(candidate)) {
		candidate = normalizePath(`${folder}/${base} ${counter}${extension}`);
		counter++;
	}
	return candidate;
}

/** Kopiert die Datei in die Vault und legt die Notiz an. */
export async function importOne(
	app: App,
	candidate: Candidate,
	choice: ImportChoice,
	runId: string,
): Promise<string> {
	await ensureFolder(app, choice.folder);

	const path = await freeTargetPath(app, choice.folder, targetName(choice.meta, candidate.format));
	await app.vault.createBinary(path, candidate.bytes);

	let coverFileName: string | undefined;
	if (candidate.cover) {
		const jpeg = candidate.coverIsJpeg ? candidate.cover : await normalizeCover(candidate.cover);
		coverFileName = await writeCover(app, candidate.hash, jpeg);
	}

	await createNote(app, {
		hash: candidate.hash,
		bookPath: path,
		format: candidate.format,
		size: candidate.size,
		meta: choice.meta,
		tags: choice.tags,
		coverFileName,
		ingestedAt: runId,
	});

	return path;
}

/**
 * Die Quelldatei in den Papierkorb des Systems. Nicht endgültig löschen — wenn
 * beim Import doch etwas schiefging, will man sie zurückholen können.
 */
export async function trashSource(path: string): Promise<void> {
	const electron = requireElectron();
	if (!electron?.shell?.trashItem) throw new Error("Der Papierkorb ist von hier nicht erreichbar.");
	await electron.shell.trashItem(path);
}

export function canTrashSources(): boolean {
	return Boolean(requireElectron()?.shell?.trashItem);
}

/**
 * Electron gibt den echten Pfad einer gewählten Datei nur noch über webUtils
 * heraus; `File.path` ist in neueren Versionen fort. Ohne Pfad lässt sich die
 * Quelle hinterher nicht wegräumen — der Import selbst braucht ihn nicht.
 */
function pathOf(file: File): string | null {
	const electron = requireElectron();
	try {
		const viaUtils = electron?.webUtils?.getPathForFile?.(file);
		if (viaUtils) return viaUtils;
	} catch {
		// Fällt unten auf die alte Eigenschaft zurück.
	}

	const legacy = (file as File & { path?: string }).path;
	return legacy || null;
}

interface ElectronBits {
	shell?: { trashItem?: (path: string) => Promise<void> };
	webUtils?: { getPathForFile?: (file: File) => string };
}

function requireElectron(): ElectronBits | null {
	try {
		return (window as Window & { require?: (id: string) => ElectronBits }).require?.("electron") ?? null;
	} catch {
		return null;
	}
}
