import { Notice, Plugin, TFile } from "obsidian";
import { ensureBaseFile } from "./base";
import { FIELD, frontmatterOf } from "./note";
import { writeReport } from "./report";
import { reingestAll, reingestNote, scanLibrary } from "./scan";
import type { ScanResult } from "./types";

type ScanMode = "scan" | "rehash" | "reingest";

export default class EbookLibraryPlugin extends Plugin {
	private scanning = false;

	async onload(): Promise<void> {
		this.addCommand({
			id: "scan",
			name: "Bibliothek scannen, neue Bücher in den Katalog aufnehmen",
			callback: () => void this.scan({ mode: "scan" }),
		});

		this.addCommand({
			id: "rescan-all",
			name: "Alle Buchdateien neu hashen",
			callback: () => void this.scan({ mode: "rehash" }),
		});

		this.addCommand({
			id: "reingest-all",
			name: "Metadaten und Cover aller Bücher neu einlesen",
			callback: () => void this.scan({ mode: "reingest" }),
		});

		// Bewusst ohne checkCallback: der Befehl soll auch dann in der Palette
		// stehen, wenn gerade keine Katalog-Notiz offen ist — sonst sucht man ihn
		// und findet ihn nicht. Statt zu verschwinden, sagt er, was fehlt.
		this.addCommand({
			id: "reingest-note",
			name: "Metadaten und Cover dieses Buchs neu einlesen",
			callback: () => {
				const note = this.activeCatalogNote();
				if (!note) {
					new Notice("Dafür muss die Notiz eines Buchs geöffnet sein.", 5000);
					return;
				}
				void this.reingest(note);
			},
		});

		this.addRibbonIcon("library-big", "Bibliothek scannen", () => void this.scan({ mode: "scan" }));

		this.app.workspace.onLayoutReady(() => void ensureBaseFile(this.app));
	}

	private activeCatalogNote(): TFile | null {
		const file = this.app.workspace.getActiveFile();
		if (!file || file.extension !== "md") return null;

		const frontmatter = frontmatterOf(this.app, file);
		if (typeof frontmatter?.[FIELD.hash] !== "string") return null;

		return file;
	}

	private async scan(options: { mode: ScanMode }): Promise<void> {
		if (this.scanning) {
			new Notice("Es läuft bereits ein Scan.");
			return;
		}

		this.scanning = true;
		const heading = options.mode === "reingest" ? "Metadaten werden neu eingelesen" : "Bibliothek wird gescannt";
		const notice = new Notice(`${heading} …`, 0);

		try {
			const onProgress = (done: number, total: number, label: string) => {
				notice.setMessage(`${heading} … ${done + 1}/${total}\n${label}`);
			};

			const result =
				options.mode === "reingest"
					? await reingestAll(this.app, { onProgress })
					: await scanLibrary(this.app, { rehashAll: options.mode === "rehash", onProgress });

			await writeReport(this.app, result);
			await ensureBaseFile(this.app);

			notice.hide();
			new Notice(summarize(result, options.mode), 10000);
		} catch (error) {
			notice.hide();
			new Notice(`Fehlgeschlagen: ${describe(error)}`, 10000);
			console.error("eBook Library: Scan fehlgeschlagen", error);
		} finally {
			this.scanning = false;
		}
	}

	private async reingest(note: TFile): Promise<void> {
		try {
			const warnings = await reingestNote(this.app, note);
			new Notice(
				warnings.length > 0
					? `Neu eingelesen, mit Anmerkungen:\n${warnings.join("\n")}`
					: "Metadaten und Cover neu eingelesen.",
				8000,
			);
		} catch (error) {
			new Notice(`Neu einlesen fehlgeschlagen: ${describe(error)}`, 8000);
		}
	}
}

function summarize(result: ScanResult, mode: ScanMode): string {
	if (mode === "reingest") {
		const summary = `Neu eingelesen: ${result.ingested.length} von ${result.scanned} Büchern`;
		return result.problems.length > 0
			? `${summary}, ${result.problems.length} Auffälligkeiten.`
			: `${summary}.`;
	}

	const parts = [
		`${result.scanned} Dateien geprüft`,
		`${result.ingested.length} neu`,
		`${result.skipped} unverändert`,
	];
	if (result.moved.length > 0) parts.push(`${result.moved.length} verschoben`);
	if (result.orphaned.length > 0) parts.push(`${result.orphaned.length} verwaist`);
	if (result.revived.length > 0) parts.push(`${result.revived.length} wieder da`);
	if (result.problems.length > 0) parts.push(`${result.problems.length} Auffälligkeiten`);

	return `Scan fertig: ${parts.join(", ")}.`;
}

function describe(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
