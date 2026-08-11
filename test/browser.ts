/**
 * Prüfstand für die Browser-Pfade: PDF-Rendering und Cover-Skalierung brauchen
 * OffscreenCanvas und pdf.js im Renderer, laufen also nicht in Node.
 *
 *   npm run browser-harness      (startet Bundle + Server, siehe package.json)
 */
import { normalizeCover } from "../src/cover";
import { extractEpub } from "../src/epub";
import { extractPdf } from "../src/pdf";
import { mergeMeta } from "../src/merge";
import { parseFileName } from "../src/filename";

const BOOKS = [
	"/Ebook Test Vault/Abendlektüre/Alle Menschen sind sterblich - Simone de Beauvoir.pdf",
	"/Ebook Test Vault/Sachbücher/Geschichte/A history of smoking -- Corti, Egon Caesar.pdf",
	"/Ebook Test Vault/Sachbücher/Geschichte/Atlantis - Eine Legende wird entziffert - Eberhardt Zangger.pdf",
	"/Ebook Test Vault/Abendlektüre/Alexandria (Paul Kingsnorth).epub",
];

const output = document.getElementById("output") as HTMLElement;

for (const url of BOOKS) {
	const basename = decodeURIComponent(url.split("/").pop() ?? url);
	const row = document.createElement("div");
	row.className = "row";
	row.innerHTML = `<h3>${basename}</h3><p class="status">läuft …</p>`;
	output.appendChild(row);

	try {
		console.log(`[${basename}] fetch …`);
		const response = await fetch(url);
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		const data = await response.arrayBuffer();
		console.log(`[${basename}] geladen: ${data.byteLength} Bytes, extrahiere …`);

		const isEpub = basename.toLowerCase().endsWith(".epub");
		const started = performance.now();
		const extraction = isEpub ? extractEpub(data) : await extractPdf(data, basename);
		console.log(`[${basename}] extrahiert in ${Math.round(performance.now() - started)} ms`);
		const meta = mergeMeta(extraction.meta, parseFileName(basename));

		let coverInfo = "kein Cover";
		if (extraction.cover) {
			const jpeg = extraction.coverIsJpeg ? extraction.cover : await normalizeCover(extraction.cover);
			const bitmap = await createImageBitmap(new Blob([jpeg]));
			coverInfo = `${bitmap.width}×${bitmap.height}, ${Math.round(jpeg.byteLength / 1024)} KB`;

			const image = document.createElement("img");
			image.src = URL.createObjectURL(new Blob([jpeg], { type: "image/jpeg" }));
			row.appendChild(image);
		}

		const status = row.querySelector(".status") as HTMLElement;
		status.className = "status ok";
		status.textContent = `OK — Titel: ${meta.title ?? "—"} | Autor: ${meta.author ?? "—"} | Cover: ${coverInfo}`;

		if (extraction.warnings.length > 0) {
			const warnings = document.createElement("p");
			warnings.className = "warn";
			warnings.textContent = `Anmerkungen: ${extraction.warnings.join(" / ")}`;
			row.appendChild(warnings);
		}
	} catch (error) {
		const status = row.querySelector(".status") as HTMLElement;
		status.className = "status fail";
		status.textContent = `FEHLER — ${error instanceof Error ? error.stack : String(error)}`;
	}
}

document.body.dataset.done = "true";
