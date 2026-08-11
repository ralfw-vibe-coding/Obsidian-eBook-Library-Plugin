/**
 * Ordnerpfad -> Tags. Einmalig beim Ingest, danach nie wieder.
 * Siehe KONZEPT.md, Abschnitt 7.
 */
export function tagsFromPath(filePath: string): string[] {
	const segments = filePath.split("/");
	segments.pop(); // der Dateiname selbst

	const tags: string[] = [];
	for (const segment of segments) {
		const tag = normalizeTag(segment);
		if (tag && !tags.includes(tag)) tags.push(tag);
	}
	return tags;
}

export function normalizeTag(segment: string): string | null {
	const tag = segment
		// macOS und Dropbox liefern Dateinamen zerlegt (NFD): "ü" ist dort u +
		// kombinierendes Trema. Ohne Zusammenziehen fiele das Trema unter den
		// Zeichenfilter und aus "Abendlektüre" würde "abendlektu-re".
		.normalize("NFC")
		.trim()
		.toLowerCase()
		.replace(/\s+/g, "-")
		// Obsidian erlaubt in Tags Buchstaben, Ziffern, _ und -. Umlaute bleiben.
		.replace(/[^\p{L}\p{N}_-]+/gu, "-")
		.replace(/-{2,}/g, "-")
		.replace(/^-+|-+$/g, "");

	if (!tag) return null;
	// Rein numerische Tags akzeptiert Obsidian nicht.
	if (/^\d+$/.test(tag)) return null;

	return tag;
}
