import { normalizePath, type App } from "obsidian";
import { ensureFolder } from "./note";
import { CATALOG_FOLDER, REPORT_PATH, type ScanResult } from "./types";

/**
 * Fehler und Auffälligkeiten als Markdown, damit sie auch unterwegs über
 * Dropbox lesbar sind. Siehe KONZEPT.md, Abschnitt 9.
 */
export async function writeReport(app: App, result: ScanResult): Promise<void> {
	await ensureFolder(app, CATALOG_FOLDER);

	const path = normalizePath(REPORT_PATH);
	const content = renderReport(result);

	if (await app.vault.adapter.exists(path)) {
		await app.vault.adapter.write(path, content);
	} else {
		await app.vault.create(path, content);
	}
}

function renderReport(result: ScanResult): string {
	const lines: string[] = [
		"---",
		"generiert: true",
		"---",
		"",
		"# Ingest-Report",
		"",
		`Letzter Scan: ${new Date().toLocaleString("de-DE")}`,
		"",
		`- Gefundene Buchdateien: **${result.scanned}**`,
		`- Unverändert übersprungen: **${result.skipped}**`,
		`- Neu aufgenommen: **${result.ingested.length}**`,
		`- Umbenannt oder verschoben: **${result.moved.length}**`,
		`- Neu verwaist: **${result.orphaned.length}**`,
		`- Wieder aufgetaucht: **${result.revived.length}**`,
		`- Auffälligkeiten: **${result.problems.length}**`,
		"",
	];

	section(lines, "Neu aufgenommen", result.ingested.map(codeLine));
	section(
		lines,
		"Umbenannt oder verschoben",
		result.moved.map((move) => `\`${move.from}\` → \`${move.to}\``),
	);
	section(
		lines,
		"Verwaist",
		result.orphaned.map(
			(notePath) => `[[${notePath}]] — die Buchdatei ist verschwunden. Die Notiz bleibt erhalten.`,
		),
	);
	section(lines, "Wieder aufgetaucht", result.revived.map((notePath) => `[[${notePath}]]`));
	section(
		lines,
		"Auffälligkeiten",
		result.problems.map((problem) => `\`${problem.path}\`<br>${problem.message}`),
	);

	if (lines[lines.length - 1] !== "") lines.push("");
	return lines.join("\n");
}

function section(lines: string[], heading: string, entries: string[]): void {
	if (entries.length === 0) return;

	lines.push(`## ${heading}`, "");
	for (const entry of entries) lines.push(`- ${entry}`);
	lines.push("");
}

function codeLine(text: string): string {
	return `\`${text}\``;
}
