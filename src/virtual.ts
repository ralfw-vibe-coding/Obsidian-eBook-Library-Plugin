/**
 * Die Rechnung hinter dem virtualisierten Regalbrett.
 *
 * Obsidian bringt dafür keinen Helfer mit — seine eigene Kartenansicht rechnet
 * das ebenfalls von Hand. Hier steht es getrennt vom DOM, damit es prüfbar ist.
 */

/** Zeilen über und unter dem Sichtfenster, damit beim Scrollen nichts aufblitzt. */
export const BUFFER_ROWS = 2;

export function columnsFor(containerWidth: number, coverWidth: number, gap: number): number {
	if (coverWidth <= 0) return 1;
	return Math.max(1, Math.floor((containerWidth + gap) / (coverWidth + gap)));
}

export function rowCount(itemCount: number, columns: number): number {
	return Math.ceil(itemCount / Math.max(1, columns));
}

/**
 * Welche Zeilen müssen im DOM stehen? Halboffenes Intervall [first, last).
 */
export function visibleRows(
	scrollTop: number,
	viewportHeight: number,
	rowHeight: number,
	totalRows: number,
): [number, number] {
	if (rowHeight <= 0 || totalRows <= 0) return [0, 0];

	const first = Math.max(0, Math.floor(scrollTop / rowHeight) - BUFFER_ROWS);
	const spanned = Math.ceil(viewportHeight / rowHeight) + 2 * BUFFER_ROWS;
	const last = Math.min(totalRows, first + spanned);

	return [Math.min(first, Math.max(0, last)), last];
}
