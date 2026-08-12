import esbuild from "esbuild";
import { pdfWorkerSource } from "../esbuild-pdf-worker.mjs";

/** Baut beide Prüfstände: den für Node und den für den Browser. */
await esbuild.build({
	entryPoints: ["test/harness.ts"],
	bundle: true,
	platform: "node",
	format: "esm",
	packages: "external",
	outfile: "test/.harness.mjs",
	logLevel: "warning",
	plugins: [pdfWorkerSource],
});

await esbuild.build({
	entryPoints: ["test/virtual.test.ts", "test/history.test.ts"],
	bundle: true,
	platform: "node",
	format: "esm",
	packages: "external",
	outdir: "test",
	entryNames: ".[name]",
	outExtension: { ".js": ".mjs" },
	logLevel: "warning",
});

await esbuild.build({
	entryPoints: ["test/scan.test.ts", "test/lists.test.ts", "test/import.test.ts"],
	bundle: true,
	platform: "node",
	format: "esm",
	packages: "external",
	outdir: "test",
	entryNames: ".[name]",
	outExtension: { ".js": ".mjs" },
	logLevel: "warning",
	// Der Scanner spricht die Obsidian-API an; hier tritt der Ersatz an ihre Stelle.
	alias: { obsidian: "./test/obsidian-stub.ts" },
	plugins: [pdfWorkerSource],
});

await esbuild.build({
	entryPoints: ["test/browser.ts"],
	bundle: true,
	format: "esm",
	target: "es2022",
	outfile: "test/browser/bundle.js",
	logLevel: "warning",
	plugins: [pdfWorkerSource],
});
