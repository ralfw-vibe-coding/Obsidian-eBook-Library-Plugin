import { Notice, Plugin, TFile } from "obsidian";
import { frontmatterOf, readHash } from "./note";
import { appendRun, recordOf, runId, type RunRecord } from "./history";
import { ConfirmModal } from "./confirm";
import { ImportModal } from "./import-modal";
import { importOne, prepare, type Candidate, type ImportChoice } from "./import";
import { canTrashSources, trashSource } from "./system";
import { reingestAll, reingestNote, scanLibrary } from "./scan";
import type { ScanResult } from "./types";
import { LibraryView, VIEW_TYPE_LIBRARY, type LibraryHost, type SortMode } from "./view";

type ScanMode = "scan" | "rehash" | "reingest";

interface Settings {
	/** Cover-Breite im Katalog-View, in Pixeln. */
	zoom: number;
	/** Protokoll der letzten Ingest-Läufe, neuester zuerst. */
	runs: RunRecord[];
	/** Die zuletzt gewählte Sicht auf den Katalog. */
	sort: SortMode;
}

// Nach Zugang ist die sinnvollere Vorgabe: was zuletzt dazukam, will man sehen.
const DEFAULTS: Settings = { zoom: 100, runs: [], sort: "recent" };

export default class EbookLibraryPlugin extends Plugin implements LibraryHost {
	private scanning = false;
	private config: Settings = { ...DEFAULTS };

	get zoom(): number {
		return this.config.zoom;
	}

	get runs(): RunRecord[] {
		return this.config.runs;
	}

	async onload(): Promise<void> {
		this.config = { ...DEFAULTS, ...((await this.loadData()) ?? {}) };

		this.registerView(VIEW_TYPE_LIBRARY, (leaf) => new LibraryView(leaf, this));

		// Nur der View bekommt ein Ribbon-Icon; alles Weitere steuert man von dort.
		this.addRibbonIcon("library-big", "eBook Library", () => void this.openLibrary());

		this.addCommand({
			id: "open-library",
			name: "Bibliothek öffnen",
			callback: () => void this.openLibrary(),
		});

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
	}

	get sort(): SortMode {
		return this.config.sort;
	}

	saveSort(sort: SortMode): void {
		this.config.sort = sort;
		void this.saveData(this.config);
	}

	saveZoom(zoom: number): void {
		this.config.zoom = zoom;
		void this.saveData(this.config);
	}

	async runScan(): Promise<void> {
		await this.scan({ mode: "scan" });
	}

	/**
	 * Bücher von außerhalb hereinholen. Gelesen wird zuerst nur in den Speicher;
	 * der Dialog zeigt, was ankäme, und erst danach wird geschrieben.
	 */
	async runImport(): Promise<void> {
		const files = await pickFiles();
		if (files.length === 0) return;

		const notice = new Notice("Dateien werden gelesen …", 0);
		let candidates: Candidate[];
		try {
			candidates = await prepare(this.app, files);
		} finally {
			notice.hide();
		}

		if (candidates.length === 0) {
			new Notice("Keine EPUB- oder PDF-Datei dabei.");
			return;
		}

		new ImportModal(this.app, candidates, (picks) => void this.performImport(picks)).open();
	}

	private async performImport(
		picks: { candidate: Candidate; choice: ImportChoice }[],
	): Promise<void> {
		const started = Date.now();
		const id = runId(new Date());
		const result: ScanResult = {
			runId: id,
			scanned: picks.length,
			skipped: 0,
			ingested: [],
			moved: [],
			orphaned: [],
			revived: [],
			problems: [],
		};

		const notice = new Notice("Wird importiert …", 0);
		const imported: Candidate[] = [];

		try {
			for (const [position, pick] of picks.entries()) {
				notice.setMessage(`Wird importiert … ${position + 1}/${picks.length}\n${pick.candidate.sourceName}`);
				try {
					result.ingested.push(await importOne(this.app, pick.candidate, pick.choice, id));
					imported.push(pick.candidate);
					for (const warning of pick.candidate.warnings) {
						result.problems.push({ path: pick.candidate.sourceName, message: warning });
					}
				} catch (error) {
					result.problems.push({ path: pick.candidate.sourceName, message: describe(error) });
				}
			}
		} finally {
			notice.hide();
		}

		this.config.runs = appendRun(
			this.config.runs,
			recordOf(result, "import", (Date.now() - started) / 1000),
		);
		await this.saveData(this.config);

		new Notice(
			`${result.ingested.length} von ${picks.length} importiert` +
				(result.problems.length > 0 ? `, ${result.problems.length} Auffälligkeiten.` : "."),
			8000,
		);

		this.offerToTrash(imported, result.problems.length === 0);
	}

	/**
	 * Erst wenn alles geklappt hat, nach den Quelldateien fragen — und sie in
	 * den Papierkorb legen statt zu löschen.
	 */
	private offerToTrash(imported: Candidate[], clean: boolean): void {
		if (!clean || !canTrashSources()) return;

		const removable = imported.filter((candidate) => candidate.sourcePath);
		if (removable.length === 0) return;

		new ConfirmModal(
			this.app,
			"Quelldateien wegräumen?",
			`${removable.length} ${removable.length === 1 ? "Datei wurde" : "Dateien wurden"} in die Bibliothek kopiert. ` +
				`${removable.length === 1 ? "Soll das Original" : "Sollen die Originale"} in den Papierkorb?`,
			"In den Papierkorb",
			() => {
				void Promise.allSettled(
					removable.map((candidate) => trashSource(candidate.sourcePath as string)),
				).then((results) => {
					const failed = results.filter((entry) => entry.status === "rejected").length;
					new Notice(
						failed === 0
							? `${removable.length} Quelldatei${removable.length === 1 ? "" : "en"} in den Papierkorb gelegt.`
							: `${removable.length - failed} weggeräumt, ${failed} nicht erreichbar.`,
					);
				});
			},
		).open();
	}

	private async openLibrary(): Promise<void> {
		const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_LIBRARY);
		if (existing.length > 0) {
			await this.app.workspace.revealLeaf(existing[0]);
			return;
		}

		const leaf = this.app.workspace.getLeaf(true);
		await leaf.setViewState({ type: VIEW_TYPE_LIBRARY, active: true });
	}

	private activeCatalogNote(): TFile | null {
		const file = this.app.workspace.getActiveFile();
		if (!file || file.extension !== "md") return null;
		if (!readHash(frontmatterOf(this.app, file))) return null;

		return file;
	}

	private async scan(options: { mode: ScanMode }): Promise<void> {
		if (this.scanning) {
			new Notice("Es läuft bereits ein Scan.");
			return;
		}

		this.scanning = true;
		const heading =
			options.mode === "reingest" ? "Metadaten werden neu eingelesen" : "Bibliothek wird gescannt";
		const notice = new Notice(`${heading} …`, 0);

		try {
			const onProgress = (done: number, total: number, label: string) => {
				notice.setMessage(`${heading} … ${done + 1}/${total}\n${label}`);
			};

			const started = Date.now();
			const result =
				options.mode === "reingest"
					? await reingestAll(this.app, { onProgress })
					: await scanLibrary(this.app, { rehashAll: options.mode === "rehash", onProgress });

			this.config.runs = appendRun(
				this.config.runs,
				recordOf(result, options.mode, (Date.now() - started) / 1000),
			);
			await this.saveData(this.config);

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

/** Dateiauswahl über ein verstecktes Eingabefeld — kein Electron-Dialog nötig. */
function pickFiles(): Promise<File[]> {
	return new Promise((resolve) => {
		const input = document.createElement("input");
		input.type = "file";
		input.multiple = true;
		input.accept = ".epub,.pdf";
		input.addEventListener("change", () => resolve(Array.from(input.files ?? [])));
		input.addEventListener("cancel", () => resolve([]));
		input.click();
	});
}

function describe(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
