import { canvasToJpeg } from "./cover";
import { COVER_MAX_WIDTH, type Extraction } from "./types";

/**
 * Metadaten und Cover aus einer PDF-Datei.
 *
 * PDFs haben kein eingebettetes Cover, die erste Seite muss gerendert werden.
 * Und ihre DocInfo ist erfahrungsgemäß unbrauchbar, deshalb der
 * Plausibilitätsfilter. Siehe KONZEPT.md, Abschnitt 7.
 */

interface PdfjsLike {
	GlobalWorkerOptions: { workerSrc: string };
	getDocument(options: unknown): { promise: Promise<PdfDocumentLike> };
}

interface PdfDocumentLike {
	numPages: number;
	getMetadata(): Promise<{ info?: Record<string, unknown> }>;
	getPage(pageNumber: number): Promise<PdfPageLike>;
	destroy(): Promise<void>;
}

interface PdfPageLike {
	getViewport(options: { scale: number }): { width: number; height: number };
	render(options: { canvasContext: unknown; viewport: unknown; intent: string }): {
		promise: Promise<void>;
	};
}

let pdfjsPromise: Promise<PdfjsLike> | null = null;

/**
 * pdf.js wird mitgebündelt statt Obsidians `window.pdfjsLib` zu benutzen — das
 * lädt Obsidian erst, sobald einmal ein PDF geöffnet wurde, und ist beim Scan
 * damit nicht verlässlich da.
 *
 * Der Worker-Quelltext liegt als Zeichenkette im Bündel (siehe
 * esbuild.config.mjs) und wird zur Laufzeit zu einer Blob-URL. Über die startet
 * pdf.js einen echten Worker; scheitert das, greift seine eigene Rückfalllösung,
 * die dieselbe URL als Modul importiert und im Hauptthread rendert.
 */
async function loadPdfjs(): Promise<PdfjsLike> {
	if (!pdfjsPromise) {
		pdfjsPromise = (async () => {
			const pdfjs = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as PdfjsLike;

			// Außerhalb eines Browsers (Node-Prüfstand) gibt es keine Blob-URLs.
			// Dann bleibt workerSrc leer und pdf.js greift auf den Worker in
			// globalThis.pdfjsWorker zurück, den der Prüfstand selbst setzt.
			if (typeof URL.createObjectURL === "function") {
				const source = (await import("pdfjs-worker-source")).default;
				pdfjs.GlobalWorkerOptions.workerSrc = URL.createObjectURL(
					new Blob([source], { type: "text/javascript" }),
				);
			}

			return pdfjs;
		})();
	}
	return pdfjsPromise;
}

export async function extractPdf(data: ArrayBuffer, basename: string): Promise<Extraction> {
	const warnings: string[] = [];
	const pdfjs = await loadPdfjs();

	let document: PdfDocumentLike | null = null;
	try {
		document = await pdfjs.getDocument({
			data,
			isEvalSupported: false,
			disableFontFace: true,
			verbosity: 0,
		}).promise;

		const meta = await readMetadata(document, basename, warnings);
		const cover = await renderFirstPage(document, warnings);

		return { meta, cover, coverIsJpeg: true, warnings };
	} finally {
		await document?.destroy().catch(() => undefined);
	}
}

async function readMetadata(
	document: PdfDocumentLike,
	basename: string,
	warnings: string[],
): Promise<Extraction["meta"]> {
	try {
		const { info } = await document.getMetadata();
		const rawTitle = asString(info?.Title);
		const rawAuthor = asString(info?.Author);

		const title = isPlausibleTitle(rawTitle, basename) ? rawTitle.trim() : undefined;
		const author = isPlausibleAuthor(rawAuthor) ? rawAuthor.trim() : undefined;
		if (rawTitle && !title) {
			warnings.push(`PDF-Titel "${rawTitle}" wirkt unbrauchbar, Dateiname wird bevorzugt`);
		}

		return { title, author, year: parseYear(asString(info?.CreationDate)) };
	} catch (error) {
		warnings.push(`PDF-Metadaten nicht lesbar: ${describe(error)}`);
		return {};
	}
}

async function renderFirstPage(
	document: PdfDocumentLike,
	warnings: string[],
): Promise<ArrayBuffer | undefined> {
	try {
		if (document.numPages < 1) {
			warnings.push("PDF hat keine Seiten");
			return undefined;
		}

		const page = await document.getPage(1);
		const unscaled = page.getViewport({ scale: 1 });
		const scale = Math.min(2, COVER_MAX_WIDTH / unscaled.width);
		const viewport = page.getViewport({ scale });

		const canvas = new OffscreenCanvas(Math.round(viewport.width), Math.round(viewport.height));
		const context = canvas.getContext("2d");
		if (!context) throw new Error("Kein 2D-Kontext verfügbar");

		// PDF-Seiten sind transparent; ohne weißen Grund wird das JPEG schwarz.
		context.fillStyle = "#ffffff";
		context.fillRect(0, 0, canvas.width, canvas.height);

		// `intent: "print"` ist hier kein Detail: beim Display-Rendering treibt
		// pdf.js den Vorgang mit requestAnimationFrame voran. Läuft der Ingest im
		// Hintergrund oder ist das Fenster verdeckt, feuert das nie und das
		// Rendern bleibt für immer stehen.
		await page.render({ canvasContext: context, viewport, intent: "print" }).promise;
		return await canvasToJpeg(canvas);
	} catch (error) {
		warnings.push(`Erste Seite nicht renderbar: ${describe(error)}`);
		return undefined;
	}
}

/**
 * Typische Ausgabe von Konvertern: "Microsoft Word - Dokument1", der reine
 * Dateiname, oder Platzhalter. Alles davon ist schlechter als der Dateiname,
 * den der Nutzer selbst vergeben hat.
 */
function isPlausibleTitle(title: string, basename: string): boolean {
	const trimmed = title.trim();
	if (trimmed.length < 2) return false;
	if (/^(microsoft (word|powerpoint|publisher)|untitled|unbenannt|dokument\d*|document\d*)\b/i.test(trimmed))
		return false;
	if (/\.(docx?|pdf|indd|tex|qxd|rtf|odt)$/i.test(trimmed)) return false;
	if (!/\p{L}/u.test(trimmed)) return false;

	// Wenn der Titel bloß der Dateiname ist, kommt die Dateinamen-Heuristik weiter,
	// weil sie daraus zusätzlich den Autor herausholt.
	const withoutExtension = basename.replace(/\.(epub|pdf)$/i, "");
	if (trimmed.toLowerCase() === withoutExtension.toLowerCase()) return false;

	return true;
}

function isPlausibleAuthor(author: string): boolean {
	const trimmed = author.trim();
	if (trimmed.length < 2) return false;
	if (/^(unknown|unbekannt|admin|administrator|user|benutzer|owner|guest|pc)$/i.test(trimmed)) return false;
	if (!/\p{L}/u.test(trimmed)) return false;
	return true;
}

function parseYear(date: string): number | undefined {
	// PDF-Datumsformat: D:20160315120000+01'00'
	const match = date.match(/\b(1[0-9]{3}|20[0-9]{2})\b/);
	if (!match) return undefined;
	return Number(match[1]);
}

function asString(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function describe(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
