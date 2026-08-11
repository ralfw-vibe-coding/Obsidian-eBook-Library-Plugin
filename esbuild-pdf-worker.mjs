import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

/**
 * Stellt den pdf.js-Worker als Zeichenkette bereit. Das Plugin baut daraus zur
 * Laufzeit eine Blob-URL und startet damit einen echten Worker — sonst müsste
 * pdf.js im Hauptthread rendern und würde Obsidian beim Ingest einfrieren.
 */
export const pdfWorkerSource = {
	name: "pdf-worker-source",
	setup(build) {
		build.onResolve({ filter: /^pdfjs-worker-source$/ }, () => ({
			path: resolve("node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs"),
			namespace: "pdf-worker-source",
		}));
		build.onLoad({ filter: /.*/, namespace: "pdf-worker-source" }, async (args) => ({
			contents: await readFile(args.path, "utf8"),
			loader: "text",
		}));
	},
};
