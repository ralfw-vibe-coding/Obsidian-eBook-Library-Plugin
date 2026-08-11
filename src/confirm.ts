import { Modal, Setting, type App } from "obsidian";

/** Rückfrage vor etwas, das sich nicht von selbst zurücknimmt. */
export class ConfirmModal extends Modal {
	constructor(
		app: App,
		private heading: string,
		private detail: string,
		private confirmLabel: string,
		private onConfirm: () => void,
	) {
		super(app);
	}

	onOpen(): void {
		this.titleEl.setText(this.heading);
		this.contentEl.createEl("p", { text: this.detail });

		new Setting(this.contentEl)
			.addButton((button) =>
				button.setButtonText("Abbrechen").onClick(() => this.close()),
			)
			.addButton((button) =>
				button
					.setButtonText(this.confirmLabel)
					.setWarning()
					.onClick(() => {
						this.close();
						this.onConfirm();
					}),
			);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
