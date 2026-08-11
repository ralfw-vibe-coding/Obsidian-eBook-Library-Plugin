import { SuggestModal, type App, type TFile } from "obsidian";
import { listFiles } from "./lists";

interface Choice {
	file: TFile | null;
	label: string;
	/** Nur gesetzt, wenn die Liste erst noch angelegt werden muss. */
	newName?: string;
}

/**
 * Auswahl einer Leseliste, mit der Möglichkeit, im selben Zug eine neue
 * anzulegen. Untermenüs wären hübscher, gibt das Obsidian-API aber nicht her.
 */
export class ListPicker extends SuggestModal<Choice> {
	constructor(
		app: App,
		private title: string,
		private onChoose: (file: TFile | null, newName?: string) => void,
	) {
		super(app);
		this.setPlaceholder("Leseliste wählen oder neuen Namen eingeben …");
	}

	onOpen(): void {
		super.onOpen();
		this.titleEl?.setText(this.title);
	}

	getSuggestions(query: string): Choice[] {
		const needle = query.trim().toLowerCase();

		const existing: Choice[] = listFiles(this.app)
			.filter((file) => !needle || file.basename.toLowerCase().includes(needle))
			.map((file) => ({ file, label: file.basename }));

		const exact = listFiles(this.app).some(
			(file) => file.basename.toLowerCase() === needle,
		);
		if (needle && !exact) {
			existing.push({ file: null, label: `Neue Liste: ${query.trim()}`, newName: query.trim() });
		}

		return existing;
	}

	renderSuggestion(choice: Choice, el: HTMLElement): void {
		el.createDiv({ text: choice.label });
	}

	onChooseSuggestion(choice: Choice): void {
		this.onChoose(choice.file, choice.newName);
	}
}
