import { unzipSync } from "fflate";
import type { Extraction } from "./types";

/**
 * Metadaten und Cover aus einer EPUB-Datei.
 *
 * container.xml verweist auf die OPF-Datei, dort stehen die Dublin-Core-Felder
 * und das Manifest, über das sich das Cover finden lässt.
 * Siehe KONZEPT.md, Abschnitt 7.
 */

const DC_NS = "http://purl.org/dc/elements/1.1/";

export function extractEpub(data: ArrayBuffer): Extraction {
	const warnings: string[] = [];
	const bytes = new Uint8Array(data);

	const opfPath = findOpfPath(bytes);
	if (!opfPath) {
		return { meta: {}, warnings: ["Keine OPF-Datei gefunden (container.xml fehlt oder ist kaputt)"] };
	}

	const opfBytes = readEntry(bytes, opfPath);
	if (!opfBytes) {
		return { meta: {}, warnings: [`OPF-Datei ${opfPath} nicht im Archiv`] };
	}

	const opf = parseXml(decodeUtf8(opfBytes));
	if (!opf) {
		return { meta: {}, warnings: [`OPF-Datei ${opfPath} ist kein gültiges XML`] };
	}

	const meta = readMetadata(opf);

	const coverPath = findCoverPath(bytes, opf, opfPath);
	if (!coverPath) {
		warnings.push("Kein Cover im OPF-Manifest gefunden");
		return { meta, warnings };
	}

	const coverBytes = readEntry(bytes, coverPath);
	if (!coverBytes) {
		warnings.push(`Cover ${coverPath} angekündigt, aber nicht im Archiv`);
		return { meta, warnings };
	}

	return { meta, cover: toArrayBuffer(coverBytes), warnings };
}

function findOpfPath(bytes: Uint8Array): string | null {
	const containerBytes = readEntry(bytes, "META-INF/container.xml");
	if (!containerBytes) return null;

	const container = parseXml(decodeUtf8(containerBytes));
	if (!container) return null;

	const rootfile = byLocalName(container, "rootfile")[0];
	return rootfile?.getAttribute("full-path") ?? null;
}

function readMetadata(opf: Document) {
	const year = parseYear(dcText(opf, "date"));
	return {
		title: dcText(opf, "title") || undefined,
		// Mehrere Autoren stehen mal als eigene Elemente, mal mit Semikolon in
		// einem. Beides landet hier als Semikolonliste, die normalizeAuthor auflöst.
		author: dcTexts(opf, "creator").join("; ") || undefined,
		language: normalizeLanguage(dcText(opf, "language")),
		year,
	};
}

function dcText(opf: Document, name: string): string {
	return dcTexts(opf, name)[0] ?? "";
}

function dcTexts(opf: Document, name: string): string[] {
	const namespaced = Array.from(opf.getElementsByTagNameNS(DC_NS, name));
	// Manche EPUBs deklarieren den Namensraum nicht sauber.
	const elements = namespaced.length > 0 ? namespaced : byLocalName(opf, name);

	return elements
		.map((element) => (element.textContent ?? "").normalize("NFC").trim())
		.filter((text) => text.length > 0);
}

/**
 * Elemente über ihren lokalen Namen finden, unabhängig vom Präfix.
 *
 * Nötig, weil OPF-Dateien das Manifest mal als `<item>`, mal als `<opf:item>`
 * schreiben. `getElementsByTagName` vergleicht in XML den *qualifizierten*
 * Namen und findet die präfigierte Schreibweise nicht — dieses Manifest wäre
 * damit komplett unsichtbar, samt Cover.
 */
function byLocalName(root: Document | Element, name: string): Element[] {
	const anyNamespace = Array.from(root.getElementsByTagNameNS("*", name));
	if (anyNamespace.length > 0) return anyNamespace;

	return Array.from(root.getElementsByTagName(name));
}

function parseYear(date: string): number | undefined {
	const match = date.match(/\b(1[0-9]{3}|20[0-9]{2})\b/);
	if (!match) return undefined;
	return Number(match[1]);
}

/** Dreibuchstabige ISO-639-2-Codes, wie sie in EPUBs vorkommen. */
const LANGUAGE_ALIASES: Record<string, string> = {
	eng: "en",
	ger: "de",
	deu: "de",
	fre: "fr",
	fra: "fr",
	spa: "es",
	ita: "it",
	dut: "nl",
	nld: "nl",
	por: "pt",
	rus: "ru",
	swe: "sv",
	dan: "da",
	nor: "no",
	pol: "pl",
	lat: "la",
	gre: "el",
	ell: "el",
};

function normalizeLanguage(language: string): string | undefined {
	// `de-DE` -> `de`
	const code = language.trim().toLowerCase().split(/[-_]/)[0];
	if (!code) return undefined;
	return LANGUAGE_ALIASES[code] ?? code;
}

function findCoverPath(bytes: Uint8Array, opf: Document, opfPath: string): string | null {
	const fromManifest = findCoverHref(opf);
	if (fromManifest) return resolveRelative(opfPath, fromManifest);

	return findCoverViaCoverPage(bytes, opf, opfPath);
}

/**
 * Vierter Weg: manche EPUBs deklarieren kein Cover-*Bild*, sondern nur eine
 * Cover-*Seite* — im guide als `<reference type="cover">` oder schlicht als
 * erstes Dokument im spine. Dann steckt das Bild in deren `<img>` bzw. in einem
 * SVG-`<image>`.
 */
function findCoverViaCoverPage(bytes: Uint8Array, opf: Document, opfPath: string): string | null {
	const reference = byLocalName(opf, "reference").find(
		(element) => (element.getAttribute("type") ?? "").toLowerCase() === "cover",
	);

	const pageHref =
		reference?.getAttribute("href") ??
		manifestItems(opf).find((item) => {
			const href = (item.getAttribute("href") ?? "").toLowerCase();
			const mediaType = item.getAttribute("media-type") ?? "";
			return mediaType.includes("xhtml") && href.includes("cover");
		})?.getAttribute("href");

	if (!pageHref) return null;

	const pagePath = resolveRelative(opfPath, pageHref);
	const pageBytes = readEntry(bytes, pagePath);
	if (!pageBytes) return null;

	const page = parseXml(decodeUtf8(pageBytes));
	if (!page) return null;

	const source =
		byLocalName(page, "img")[0]?.getAttribute("src") ??
		byLocalName(page, "image")[0]?.getAttribute("xlink:href") ??
		byLocalName(page, "image")[0]?.getAttributeNS("http://www.w3.org/1999/xlink", "href");

	if (!source) return null;
	return resolveRelative(pagePath, source);
}

/**
 * Drei Wege zum Cover, in absteigender Verlässlichkeit:
 * `<meta name="cover" content="ID">`, `properties="cover-image"`, und als
 * letzter Ausweg ein Manifest-Eintrag, dessen id oder href nach Cover aussieht.
 */
function findCoverHref(opf: Document): string | null {
	const metaCover = byLocalName(opf, "meta").find(
		(element) => element.getAttribute("name") === "cover",
	);
	const coverId = metaCover?.getAttribute("content");
	if (coverId) {
		const item = findItemById(opf, coverId);
		const href = item?.getAttribute("href");
		if (href) return href;
	}

	for (const item of manifestItems(opf)) {
		const properties = item.getAttribute("properties") ?? "";
		if (properties.split(/\s+/).includes("cover-image")) {
			const href = item.getAttribute("href");
			if (href) return href;
		}
	}

	for (const item of manifestItems(opf)) {
		const mediaType = item.getAttribute("media-type") ?? "";
		if (!mediaType.startsWith("image/")) continue;

		const id = (item.getAttribute("id") ?? "").toLowerCase();
		const href = item.getAttribute("href") ?? "";
		if (id.includes("cover") || href.toLowerCase().includes("cover")) return href;
	}

	return null;
}

function manifestItems(opf: Document): Element[] {
	return byLocalName(opf, "item");
}

function findItemById(opf: Document, id: string): Element | undefined {
	return manifestItems(opf).find((item) => item.getAttribute("id") === id);
}

/** Hrefs im OPF sind relativ zum Verzeichnis der OPF-Datei. */
function resolveRelative(opfPath: string, href: string): string {
	const decoded = decodeHref(href);
	const base = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/")) : "";
	if (!base) return normalizePath(decoded);
	return normalizePath(`${base}/${decoded}`);
}

function decodeHref(href: string): string {
	const withoutFragment = href.split("#")[0];
	try {
		return decodeURIComponent(withoutFragment);
	} catch {
		return withoutFragment;
	}
}

function normalizePath(path: string): string {
	const result: string[] = [];
	for (const segment of path.split("/")) {
		if (segment === "" || segment === ".") continue;
		if (segment === "..") result.pop();
		else result.push(segment);
	}
	return result.join("/");
}

/**
 * Gezielt einen einzelnen Eintrag entpacken. fflate liest dabei nur das
 * Central Directory und dekomprimiert ausschließlich den Treffer — bei
 * 10-MB-EPUBs macht das den Unterschied.
 */
function readEntry(zip: Uint8Array, path: string): Uint8Array | null {
	try {
		const entries = unzipSync(zip, { filter: (file) => file.name === path });
		return entries[path] ?? null;
	} catch {
		return null;
	}
}

function decodeUtf8(bytes: Uint8Array): string {
	return new TextDecoder("utf-8").decode(bytes);
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
	return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function parseXml(text: string): Document | null {
	const document = new DOMParser().parseFromString(text, "application/xml");
	if (document.getElementsByTagName("parsererror").length > 0) return null;
	return document;
}
