import type { BookMeta } from "./types";

/**
 * Titel/Autor aus dem Dateinamen raten.
 *
 * Die Sammlung ist überwiegend nach `Titel - Autor` benannt. Wo die
 * eingebetteten Metadaten nichts hergeben (bei PDFs der Normalfall), ist der
 * Dateiname die bessere Quelle. Siehe KONZEPT.md, Abschnitt 7.
 */

const ARTICLES = ["The", "A", "An", "Der", "Die", "Das", "Le", "La", "Les", "El", "Il"];

/** Ab so vielen Wörtern ist der Teil hinter dem Trenner kein Autor mehr, sondern Untertitel. */
const MAX_AUTHOR_WORDS = 5;

export function parseFileName(basename: string): BookMeta {
	const cleaned = stripExtension(basename).trim();

	const withParens = splitTrailingParens(cleaned);
	if (withParens) return finish(withParens.title, withParens.author);

	for (const separator of [" -- ", " - "]) {
		const split = splitAtLast(cleaned, separator);
		if (split && wordCount(split.author) <= MAX_AUTHOR_WORDS) {
			return finish(split.title, split.author);
		}
	}

	return finish(cleaned, undefined);
}

function finish(rawTitle: string, rawAuthor: string | undefined): BookMeta {
	const meta: BookMeta = { title: normalizeTitle(rawTitle) };
	const author = rawAuthor ? normalizeAuthor(rawAuthor) : undefined;
	if (author) meta.author = author;
	return meta;
}

function stripExtension(name: string): string {
	return name.replace(/\.(epub|pdf)$/i, "");
}

/**
 * `Titel (Autor)` bzw. `Titel (Autor [Nachname, Vorname])`.
 * Nur eine Klammer ganz am Ende zählt als Autorangabe.
 */
function splitTrailingParens(name: string): { title: string; author: string } | null {
	const match = name.match(/^(.*?)\s*\(([^()]+)\)$/);
	if (!match) return null;

	const title = match[1].trim();
	// `Samantha Sotto [Sotto, Samantha]` -> `Samantha Sotto`
	const author = match[2].replace(/\s*\[[^\]]*\]\s*$/, "").trim();
	if (!title || !author) return null;
	if (wordCount(author) > MAX_AUTHOR_WORDS + 2) return null;

	return { title, author };
}

/**
 * Am *letzten* Vorkommen trennen: `Atlantis - Eine Legende wird entziffert -
 * Eberhardt Zangger` soll den Untertitel beim Titel lassen.
 */
function splitAtLast(name: string, separator: string): { title: string; author: string } | null {
	const index = name.lastIndexOf(separator);
	if (index <= 0) return null;

	const title = name.slice(0, index).trim();
	const author = name.slice(index + separator.length).trim();
	if (!title || !author) return null;

	return { title, author };
}

export function normalizeTitle(title: string): string {
	let result = title.trim();

	// `Against the Grain_ A Deep History` — der Unterstrich stand mal für einen Doppelpunkt.
	result = result.replace(/_\s+/g, ": ");

	// `Beautiful, The` -> `The Beautiful`
	const trailingArticle = result.match(/^(.*),\s*([A-Za-zÄÖÜäöü]+)$/);
	if (trailingArticle && ARTICLES.includes(trailingArticle[2])) {
		result = `${trailingArticle[2]} ${trailingArticle[1]}`;
	}

	return collapseSpaces(result);
}

/**
 * Mehrere Autoren stehen semikolongetrennt; jeder wird für sich normalisiert.
 * Doppelte kommen vor — manche EPUBs führen denselben Namen sowohl in einer
 * Sammelangabe als auch noch einmal einzeln.
 */
export function normalizeAuthor(author: string): string {
	const names: string[] = [];
	const seen = new Set<string>();

	for (const part of author.normalize("NFC").split(";")) {
		const name = normalizeSingleAuthor(part);
		if (!name) continue;

		const key = name.toLowerCase();
		if (seen.has(key)) continue;

		seen.add(key);
		names.push(name);
	}

	return names.join(", ");
}

function normalizeSingleAuthor(author: string): string {
	let result = collapseSpaces(stripLifeDates(author));

	// `Milton, John` -> `John Milton`, aber `Robert O. Becker, Gary Selden` bleibt.
	// Unterscheidungsmerkmal: vor dem Komma steht genau ein Wort, dann ist es ein Nachname.
	const parts = result.split(",");
	if (parts.length === 2 && wordCount(parts[0]) === 1 && wordCount(parts[1]) <= 3) {
		result = `${parts[1].trim()} ${parts[0].trim()}`;
	}

	return collapseSpaces(result);
}

/** Bibliothekskataloge hängen Lebensdaten an: `Corti, Egon Caesar, 1886-1953`. */
function stripLifeDates(author: string): string {
	return author.replace(/,?\s*\d{4}\s*[-–]\s*\d{0,4}\.?\s*$/, "").trim();
}

/**
 * Katalogisate wie `Corti, Egon Caesar, Conte, 1886-1953` haben mehr Kommas,
 * als ein Name hergibt. Sie sind schlechter als das, was im Dateinamen steht.
 */
export function looksLikeCatalogEntry(author: string): boolean {
	if (author.includes(";")) return false;
	return (stripLifeDates(author).match(/,/g) ?? []).length >= 2;
}

function wordCount(text: string): number {
	const trimmed = text.trim();
	return trimmed ? trimmed.split(/\s+/).length : 0;
}

function collapseSpaces(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}
