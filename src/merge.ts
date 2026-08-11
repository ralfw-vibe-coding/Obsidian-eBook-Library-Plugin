import { looksLikeCatalogEntry, normalizeAuthor } from "./filename";
import type { BookMeta } from "./types";

/**
 * Feldweise: was im Buch steht, gewinnt; sonst greift der Dateiname.
 * Siehe KONZEPT.md, Abschnitt 7.
 *
 * Mit zwei Ausnahmen, die der Prüfstand an der echten Sammlung zutage
 * gefördert hat — Fälle, in denen die eingebettete Angabe nachweislich
 * schlechter ist als der selbst vergebene Dateiname.
 */
export function mergeMeta(fromBook: BookMeta, fromName: BookMeta): BookMeta {
	const title = chooseTitle(fromBook.title, fromName.title);
	const author = chooseAuthor(fromBook.author, fromName.author);

	return {
		title,
		// Manche EPUBs tragen den Titel als Autor ein. Dann lieber gar kein Autor.
		author: author && author !== title ? author : undefined,
		year: fromBook.year,
		language: fromBook.language,
	};
}

/**
 * Calibre stellt Reihe und Nummer voran: `Chief Inspector Armand Gamache 18 -
 * A World of Curiosities`, `50 - Schneewittchen-Party`. Wenn der Titel aus dem
 * Dateinamen genau der Rest hinter so einem Präfix ist, ist er der bessere.
 */
function chooseTitle(fromBook: string | undefined, fromName: string | undefined): string | undefined {
	if (!fromBook) return fromName;
	if (!fromName) return fromBook;

	const suffix = ` - ${fromName.toLowerCase()}`;
	if (fromBook.toLowerCase().endsWith(suffix)) return fromName;

	return fromBook;
}

function chooseAuthor(fromBook: string | undefined, fromName: string | undefined): string | undefined {
	if (!fromBook) return fromName;
	if (fromName && looksLikeCatalogEntry(fromBook)) return fromName;

	return normalizeAuthor(fromBook) || fromName;
}
