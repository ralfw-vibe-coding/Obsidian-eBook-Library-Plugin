import { App, Modal } from "obsidian";
import { formatRunTime, type RunRecord } from "./history";

/**
 * Das Protokoll eines Ingest-Laufs.
 *
 * Erfolg steht in einer Zeile — die Zahlen sagen alles. Ausführlich wird es nur
 * bei Fehlschlägen: was schiefging und bei welchem Buch.
 */
export class LogModal extends Modal {
	private current: RunRecord;

	constructor(
		app: App,
		private runs: RunRecord[],
		private openBook: (path: string) => void,
		start?: string,
	) {
		super(app);
		this.current = runs.find((run) => run.id === start) ?? runs[0];
	}

	onOpen(): void {
		this.titleEl.setText("Ingest-Protokoll");
		this.modalEl.addClass("ebook-log-modal");
		this.render();
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();

		if (!this.current) {
			contentEl.createDiv({ cls: "ebook-log-empty", text: "Es hat noch kein Ingest stattgefunden." });
			return;
		}

		if (this.runs.length > 1) this.renderPicker(contentEl);
		this.renderSummary(contentEl);
		this.renderProblems(contentEl);
	}

	private renderPicker(parent: HTMLElement): void {
		const picker = parent.createEl("select", { cls: "dropdown ebook-log-picker" });
		for (const run of this.runs) {
			picker.createEl("option", {
				value: run.id,
				text: `${formatRunTime(run.id)} — ${describeMode(run)}`,
			});
		}
		picker.value = this.current.id;
		picker.addEventListener("change", () => {
			const found = this.runs.find((run) => run.id === picker.value);
			if (found) {
				this.current = found;
				this.render();
			}
		});
	}

	private renderSummary(parent: HTMLElement): void {
		const run = this.current;
		const line = parent.createDiv("ebook-log-summary");

		const parts =
			run.mode === "reingest"
				? [`${run.ingested} von ${run.scanned} Büchern neu eingelesen`]
				: [
						`${run.scanned} Dateien geprüft`,
						`${run.ingested} neu`,
						`${run.skipped} unverändert`,
						...(run.moved > 0 ? [`${run.moved} verschoben`] : []),
						...(run.orphaned > 0 ? [`${run.orphaned} verwaist`] : []),
						...(run.revived > 0 ? [`${run.revived} wieder da`] : []),
					];

		line.createSpan({ text: parts.join(", ") });
		line.createSpan({ cls: "ebook-log-time", text: ` · ${run.seconds} s` });
	}

	private renderProblems(parent: HTMLElement): void {
		const run = this.current;

		if (run.problemCount === 0) {
			parent.createDiv({ cls: "ebook-log-clean", text: "Ohne Auffälligkeiten." });
			return;
		}

		parent.createDiv({
			cls: "ebook-log-heading",
			text:
				run.problemCount === 1
					? "1 Auffälligkeit"
					: `${run.problemCount} Auffälligkeiten`,
		});

		const list = parent.createDiv("ebook-log-list");
		for (const problem of run.problems) {
			const item = list.createDiv("ebook-log-item");

			const link = item.createDiv({ cls: "ebook-log-book", text: basename(problem.path) });
			link.addEventListener("click", () => this.openBook(problem.path));

			item.createDiv({ cls: "ebook-log-path", text: problem.path });
			item.createDiv({ cls: "ebook-log-message", text: problem.message });
		}

		if (run.problemCount > run.problems.length) {
			list.createDiv({
				cls: "ebook-log-more",
				text: `… und ${run.problemCount - run.problems.length} weitere`,
			});
		}
	}
}

function describeMode(run: RunRecord): string {
	if (run.mode === "reingest") return `${run.ingested} neu eingelesen`;
	if (run.ingested === 0) return "nichts Neues";
	return run.ingested === 1 ? "1 neues Buch" : `${run.ingested} neue Bücher`;
}

function basename(path: string): string {
	return path.split("/").pop() ?? path;
}
