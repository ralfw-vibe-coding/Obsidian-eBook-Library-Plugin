/** Wo der Katalog liegt. Siehe KONZEPT.md, Abschnitt 4. */
export const CATALOG_FOLDER = "_catalog";
export const COVERS_FOLDER = `${CATALOG_FOLDER}/covers`;
export const REPORT_PATH = `${CATALOG_FOLDER}/_ingest-report.md`;

export const BOOK_EXTENSIONS = ["epub", "pdf"] as const;
export type BookFormat = (typeof BOOK_EXTENSIONS)[number];

/** Breite, auf die Cover heruntergerechnet werden. */
export const COVER_MAX_WIDTH = 400;

/** Bibliographische Angaben, wie sie aus einer Buchdatei zu holen sind. */
export interface BookMeta {
	title?: string;
	author?: string;
	year?: number;
	language?: string;
}

/** Ergebnis des einmaligen Öffnens einer Buchdatei. */
export interface Extraction {
	meta: BookMeta;
	/** Rohbytes des Covers, so wie im Buch gefunden. Noch nicht skaliert. */
	cover?: ArrayBuffer;
	/** Bereits fertiges JPEG (PDF-Rendering liefert das direkt). */
	coverIsJpeg?: boolean;
	warnings: string[];
}

/** Eine Buchdatei, wie der Scanner sie im Dateisystem vorfindet. */
export interface FoundFile {
	path: string;
	size: number;
	format: BookFormat;
}

export interface ScanResult {
	scanned: number;
	skipped: number;
	ingested: string[];
	moved: { from: string; to: string }[];
	orphaned: string[];
	revived: string[];
	problems: { path: string; message: string }[];
}
