/**
 * Virtuelles Modul: der esbuild-Plugin in esbuild.config.mjs liefert hier den
 * Quelltext des pdf.js-Workers als Zeichenkette. Siehe src/pdf.ts.
 */
declare module "pdfjs-worker-source" {
	const source: string;
	export default source;
}
