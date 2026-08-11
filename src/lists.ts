import { normalizePath, type App, type TFile } from "obsidian";
import { CATALOG_FOLDER } from "./types";
import { ensureFolder, sanitizeFileName } from "./note";

/**
 * Leselisten: eine Markdown-Datei je Liste, der Dateiname ist der Titel.
 *
 * Die Reihenfolge ist der Kern der Sache — und eine Markdown-Liste ist von
 * Natur aus geordnet. Umsortieren schreibt genau eine Datei. Verweise sind
 * Wikilinks, weil Obsidian sie beim Umbenennen einer Buchnotiz selbst
 * nachzieht; mit Hashes müsste das Plugin das nachbauen.
 *
 * Geschrieben wird ausschließlich der zusammenhängende Block der
 * `- [[…]]`-Zeilen. Was darüber oder darunter steht, gehört dem Nutzer.
 */

export const LISTS_FOLDER = `${CATALOG_FOLDER}/readinglists`;

export interface ReadingList {
	file: TFile;
	/** Der Dateiname ohne Endung. */
	name: string;
	/** Die Buchnotizen in Listenreihenfolge. Nicht auflösbare Links fallen weg. */
	books: TFile[];
}

interface Parsed {
	before: string;
	links: string[];
	after: string;
}

export function isListFile(file: TFile): boolean {
	return file.path.startsWith(`${LISTS_FOLDER}/`) && file.extension === "md";
}

export function listFiles(app: App): TFile[] {
	return app.vault
		.getMarkdownFiles()
		.filter(isListFile)
		.sort((a, b) => a.basename.localeCompare(b.basename, "de"));
}

export async function readLists(app: App): Promise<ReadingList[]> {
	const lists: ReadingList[] = [];
	for (const file of listFiles(app)) lists.push(await readList(app, file));
	return lists;
}

export async function readList(app: App, file: TFile): Promise<ReadingList> {
	const parsed = parse(await app.vault.read(file));
	const books: TFile[] = [];

	for (const link of parsed.links) {
		const target = app.metadataCache.getFirstLinkpathDest(link, file.path);
		if (target && !books.includes(target)) books.push(target);
	}

	return { file, name: file.basename, books };
}

export async function createList(app: App, name: string): Promise<TFile> {
	await ensureFolder(app, CATALOG_FOLDER);
	await ensureFolder(app, LISTS_FOLDER);

	const base = sanitizeFileName(name);
	let path = normalizePath(`${LISTS_FOLDER}/${base}.md`);
	let counter = 2;
	while (await app.vault.adapter.exists(path)) {
		path = normalizePath(`${LISTS_FOLDER}/${base} ${counter}.md`);
		counter++;
	}

	return await app.vault.create(path, "");
}

export async function addToList(app: App, list: TFile, book: TFile): Promise<boolean> {
	const current = await readList(app, list);
	if (current.books.some((candidate) => candidate.path === book.path)) return false;

	await writeBooks(app, list, [...current.books, book]);
	return true;
}

export async function removeFromList(app: App, list: TFile, book: TFile): Promise<void> {
	const current = await readList(app, list);
	await writeBooks(
		app,
		list,
		current.books.filter((candidate) => candidate.path !== book.path),
	);
}

/** Verschiebt den Eintrag an `from` so, dass er vor dem bisherigen `to` steht. */
export async function moveInList(
	app: App,
	list: TFile,
	from: number,
	to: number,
): Promise<void> {
	const current = await readList(app, list);
	const books = [...current.books];
	if (from < 0 || from >= books.length) return;

	await writeBooks(app, list, reorder(books, from, to));
}

/**
 * Verschiebt den Eintrag an `from` vor die ursprüngliche Position `to`.
 * `to === items.length` bedeutet ans Ende.
 */
export function reorder<T>(items: T[], from: number, to: number): T[] {
	if (from < 0 || from >= items.length) return items;

	const result = [...items];
	const [moved] = result.splice(from, 1);
	const target = from < to ? to - 1 : to;
	result.splice(Math.max(0, Math.min(result.length, target)), 0, moved);

	return result;
}

async function writeBooks(app: App, list: TFile, books: TFile[]): Promise<void> {
	const parsed = parse(await app.vault.read(list));
	const lines = books.map((book) => `- [[${book.basename}]]`);
	await app.vault.modify(list, assemble(parsed, lines));
}

/**
 * Zerlegt die Datei in: alles vor dem Link-Block, die Links, alles danach.
 * Gibt es keinen Block, gilt der gesamte Inhalt als „davor".
 */
export function parse(content: string): Parsed {
	const lines = content.split("\n");
	const isLink = (line: string) => /^\s*[-*]\s*\[\[[^\]]+\]\]\s*$/.test(line);

	let first = lines.findIndex(isLink);
	if (first === -1) return { before: content, links: [], after: "" };

	let last = first;
	while (last + 1 < lines.length && (isLink(lines[last + 1]) || lines[last + 1].trim() === "")) {
		if (isLink(lines[last + 1])) last = last + 1;
		else break;
	}

	const links: string[] = [];
	for (let index = first; index <= last; index++) {
		const match = lines[index].match(/\[\[([^\]]+)\]\]/);
		if (match) links.push(match[1].split("|")[0].split("#")[0].trim());
	}

	return {
		before: lines.slice(0, first).join("\n"),
		links,
		after: lines.slice(last + 1).join("\n"),
	};
}

export function assemble(parsed: Parsed, lines: string[]): string {
	const before = parsed.before.replace(/\s+$/, "");
	const after = parsed.after.replace(/^\s+/, "");
	const block = lines.join("\n");

	const parts: string[] = [];
	if (before) parts.push(before, "");
	parts.push(block || "");
	if (after) parts.push("", after);

	return `${parts.join("\n").replace(/\n{3,}/g, "\n\n")}\n`;
}
