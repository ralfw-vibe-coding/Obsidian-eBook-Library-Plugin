import { Modal, Notice, Setting, SuggestModal, type App } from "obsidian";
import {
	bookFolders,
	cleanTags,
	suggestFolder,
	tagsForFolder,
	targetName,
	type Candidate,
	type ImportChoice,
} from "./import";

/** Ordnerauswahl über die vorhandenen Ordner, neue durch Eintippen. */
class FolderPicker extends SuggestModal<string> {
	constructor(
		app: App,
		private onPick: (folder: string) => void,
	) {
		super(app);
		this.setPlaceholder("Ordner wählen oder neuen Pfad eingeben …");
	}

	getSuggestions(query: string): string[] {
		const needle = query.trim().toLowerCase();
		const folders = bookFolders(this.app).filter(
			(folder) => !needle || folder.toLowerCase().includes(needle),
		);

		const exact = folders.some((folder) => folder.toLowerCase() === needle);
		if (needle && !exact) folders.unshift(query.trim());

		return folders;
	}

	renderSuggestion(folder: string, el: HTMLElement): void {
		el.createDiv({ text: folder });
	}

	onChooseSuggestion(folder: string): void {
		this.onPick(folder);
	}
}

interface Row {
	candidate: Candidate;
	choice: ImportChoice;
	/** Hat der Nutzer die Tags selbst angefasst? Dann nicht mehr überschreiben. */
	tagsTouched: boolean;
	refresh: () => void;
}

/**
 * Was importiert wird, bevor es importiert wird: je Buch Titel, Autor,
 * Zielordner und Tags. Erst „Importieren" schreibt in die Vault.
 */
export class ImportModal extends Modal {
	private rows: Row[] = [];

	constructor(
		app: App,
		private candidates: Candidate[],
		private onSubmit: (picks: { candidate: Candidate; choice: ImportChoice }[]) => void,
	) {
		super(app);
	}

	onOpen(): void {
		this.titleEl.setText(
			this.candidates.length === 1 ? "Buch importieren" : `${this.candidates.length} Bücher importieren`,
		);
		this.modalEl.addClass("ebook-import-modal");

		const list = this.contentEl.createDiv("ebook-import-list");
		let lastFolder: string | null = null;

		for (const candidate of this.candidates) {
			const folder: string = suggestFolder(this.app, candidate.meta, lastFolder) ?? "";
			if (folder) lastFolder = folder;

			const row: Row = {
				candidate,
				choice: {
					folder,
					meta: { ...candidate.meta },
					tags: folder ? tagsForFolder(folder) : [],
				},
				tagsTouched: false,
				refresh: () => undefined,
			};
			this.rows.push(row);
			this.renderRow(list, row);
		}

		this.renderFooter();
	}

	private renderRow(parent: HTMLElement, row: Row): void {
		const { candidate, choice } = row;
		const item = parent.createDiv("ebook-import-item");
		if (candidate.duplicateOf) item.addClass("is-duplicate");

		const cover = item.createDiv("ebook-import-cover");
		if (candidate.cover) {
			const blob = new Blob([candidate.cover], {
				type: candidate.coverIsJpeg ? "image/jpeg" : "application/octet-stream",
			});
			cover.createEl("img", { attr: { src: URL.createObjectURL(blob), alt: "" } });
		} else {
			cover.createDiv({ cls: "ebook-import-nocover", text: candidate.format.toUpperCase() });
		}

		const fields = item.createDiv("ebook-import-fields");

		if (candidate.duplicateOf) {
			fields.createDiv({
				cls: "ebook-import-warn",
				text: `Steht schon im Katalog als „${candidate.duplicateOf.basename}“ — wird übersprungen.`,
			});
		}

		const title = fields.createEl("input", {
			cls: "ebook-import-title",
			attr: { type: "text", placeholder: "Titel" },
		});
		title.value = choice.meta.title ?? "";
		title.addEventListener("input", () => {
			choice.meta.title = title.value;
			row.refresh();
		});

		const author = fields.createEl("input", {
			cls: "ebook-import-author",
			attr: { type: "text", placeholder: "Autor" },
		});
		author.value = choice.meta.author ?? "";
		author.addEventListener("input", () => {
			choice.meta.author = author.value;
			row.refresh();
		});

		const folderRow = fields.createDiv("ebook-import-folder");
		const folderButton = folderRow.createEl("button", { cls: "ebook-import-folder-button" });
		folderButton.addEventListener("click", () => {
			new FolderPicker(this.app, (picked) => {
				choice.folder = picked;
				if (!row.tagsTouched) {
					choice.tags = tagsForFolder(picked);
					tags.value = choice.tags.join(", ");
				}
				row.refresh();
			}).open();
		});

		const tags = fields.createEl("input", {
			cls: "ebook-import-tags",
			attr: { type: "text", placeholder: "Tags, durch Komma getrennt" },
		});
		tags.value = choice.tags.join(", ");
		tags.addEventListener("input", () => {
			row.tagsTouched = true;
			choice.tags = cleanTags(tags.value);
		});

		const target = fields.createDiv("ebook-import-target");

		row.refresh = () => {
			folderButton.setText(choice.folder || "Ordner wählen …");
			folderButton.toggleClass("is-empty", !choice.folder);
			target.setText(
				choice.folder
					? `${choice.folder}/${targetName(choice.meta, candidate.format)}`
					: `… /${targetName(choice.meta, candidate.format)}`,
			);
		};
		row.refresh();

		for (const warning of candidate.warnings) {
			fields.createDiv({ cls: "ebook-import-note", text: warning });
		}
	}

	private renderFooter(): void {
		const importable = () =>
			this.rows.filter((row) => !row.candidate.duplicateOf && row.choice.folder);

		new Setting(this.contentEl)
			.addButton((button) => button.setButtonText("Abbrechen").onClick(() => this.close()))
			.addButton((button) =>
				button
					.setButtonText("Importieren")
					.setCta()
					.onClick(() => {
						const picks = importable();
						if (picks.length === 0) {
							new Notice("Kein Buch bereit: Zielordner fehlt oder alles ist schon im Katalog.");
							return;
						}
						this.close();
						this.onSubmit(picks.map((row) => ({ candidate: row.candidate, choice: row.choice })));
					}),
			);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
