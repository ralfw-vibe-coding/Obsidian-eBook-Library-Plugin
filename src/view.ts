import {
	ButtonComponent,
	ItemView,
	SearchComponent,
	SliderComponent,
	TFile,
	WorkspaceLeaf,
	debounce,
	setTooltip,
} from "obsidian";
import { FIELD, catalogNotes, readHash } from "./note";
import { BOOK_EXTENSIONS, type BookFormat } from "./types";
import { columnsFor, rowCount, visibleRows } from "./virtual";

export const VIEW_TYPE_LIBRARY = "ebook-library-view";

/** Was der View vom Plugin braucht — hält die beiden Module voneinander frei. */
export interface LibraryHost {
	runScan(): Promise<void>;
	zoom: number;
	saveZoom(zoom: number): void;
}

interface Entry {
	note: TFile;
	title: string;
	author: string;
	tags: string[];
	format: BookFormat;
	size: number;
	coverUrl: string | null;
	orphaned: boolean;
	/** Kleingeschrieben, für die Suche. Einmal beim Einlesen gebaut. */
	haystack: string;
}

const GAP = 18;

export class LibraryView extends ItemView {
	private entries: Entry[] = [];
	private shown: Entry[] = [];

	private query = "";
	private formats = new Set<BookFormat>(BOOK_EXTENSIONS);
	private selectedTags = new Set<string>();

	private tagsEl!: HTMLElement;
	private countEl!: HTMLElement;
	private scrollEl!: HTMLElement;
	private sizerEl!: HTMLElement;
	private windowEl!: HTMLElement;

	private columns = 1;
	private rowHeight = 240;
	private renderedRange: [number, number] = [-1, -1];

	constructor(
		leaf: WorkspaceLeaf,
		private host: LibraryHost,
	) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE_LIBRARY;
	}

	getDisplayText(): string {
		return "eBook Library";
	}

	getIcon(): string {
		return "library-big";
	}

	async onOpen(): Promise<void> {
		this.contentEl.empty();
		this.contentEl.addClass("ebook-library");

		this.buildToolbar();
		this.tagsEl = this.contentEl.createDiv("ebook-tags");
		this.countEl = this.contentEl.createDiv("ebook-count");

		this.scrollEl = this.contentEl.createDiv("ebook-scroll");
		this.sizerEl = this.scrollEl.createDiv("ebook-sizer");
		this.windowEl = this.sizerEl.createDiv("ebook-window");

		this.registerDomEvent(this.scrollEl, "scroll", () => this.paint());

		// Der Katalog kann sich unter dem View verändern — durch einen Scan, durch
		// eigene Bearbeitung einer Notiz, durch Löschen.
		const refresh = debounce(() => this.reload(), 400, true);
		this.registerEvent(this.app.metadataCache.on("resolved", refresh));
		this.registerEvent(this.app.vault.on("delete", refresh));
		this.registerEvent(this.app.vault.on("rename", refresh));

		this.applyZoom(this.host.zoom);
		this.reload();
	}

	onResize(): void {
		this.measure();
		this.renderedRange = [-1, -1];
		this.paint();
	}

	private buildToolbar(): void {
		const bar = this.contentEl.createDiv("ebook-toolbar");

		const search = new SearchComponent(bar.createDiv("ebook-search"));
		search.setPlaceholder("Titel oder Autor suchen …");
		search.onChange(
			debounce(
				(value: string) => {
					this.query = value.trim().toLowerCase();
					this.applyFilters();
				},
				150,
				true,
			),
		);

		const formatGroup = bar.createDiv("ebook-formats");
		for (const format of BOOK_EXTENSIONS) {
			const button = new ButtonComponent(formatGroup)
				.setButtonText(format.toUpperCase())
				.setClass("ebook-toggle")
				.setCta();
			button.onClick(() => {
				const on = !this.formats.has(format);
				if (on) this.formats.add(format);
				else this.formats.delete(format);
				if (on) button.setCta();
				else button.removeCta();
				this.applyFilters();
			});
		}

		const zoomWrap = bar.createDiv("ebook-zoom");
		setTooltip(zoomWrap, "Größe der Cover");
		zoomWrap.createSpan({ cls: "ebook-zoom-icon", text: "A" });
		new SliderComponent(zoomWrap)
			.setLimits(60, 260, 5)
			.setValue(this.host.zoom)
			.onChange((value) => {
				this.applyZoom(value);
				this.host.saveZoom(value);
				this.renderedRange = [-1, -1];
				this.paint();
			});

		const scan = new ButtonComponent(bar)
			.setButtonText("Scannen")
			.setClass("ebook-scan")
			.setTooltip("Neue Bücher in den Katalog aufnehmen");
		scan.onClick(() => {
			scan.setDisabled(true);
			void this.host.runScan().finally(() => {
				scan.setDisabled(false);
				this.reload();
			});
		});
	}

	private applyZoom(zoom: number): void {
		const width = Math.round(zoom);
		const fontSize = Math.min(15, Math.max(11, Math.round(11 * (zoom / 100) ** 0.4)));
		const lineHeight = Math.round(fontSize * 1.35);

		this.contentEl.style.setProperty("--ebook-cover-width", `${width}px`);
		this.contentEl.style.setProperty("--ebook-font-size", `${fontSize}px`);
		this.contentEl.style.setProperty("--ebook-line-height", `${lineHeight}px`);

		// Feste Höhe je Zelle — sonst lässt sich nicht ausrechnen, welche Zeilen
		// gerade sichtbar sind, und die Virtualisierung fällt in sich zusammen.
		const meta = 4 * lineHeight + 10;
		this.contentEl.style.setProperty("--ebook-meta-height", `${meta}px`);
		this.rowHeight = Math.round(width * 1.5) + meta + GAP;
		this.measure();
	}

	private measure(): void {
		const width = this.scrollEl?.clientWidth ?? 0;
		const cover = Number.parseFloat(
			getComputedStyle(this.contentEl).getPropertyValue("--ebook-cover-width"),
		);
		this.columns = columnsFor(width, cover || 100, GAP);
	}

	private reload(): void {
		this.entries = this.readCatalog();
		this.renderTagChips();
		this.applyFilters();
	}

	private readCatalog(): Entry[] {
		const entries: Entry[] = [];

		for (const note of catalogNotes(this.app)) {
			const frontmatter = this.app.metadataCache.getFileCache(note)?.frontmatter;
			if (!frontmatter || !readHash(frontmatter)) continue;

			const title = String(frontmatter[FIELD.title] ?? note.basename);
			const author = String(frontmatter[FIELD.author] ?? "");
			const rawTags = frontmatter[FIELD.tags];
			const tags = Array.isArray(rawTags) ? rawTags.map(String) : [];
			const format = frontmatter[FIELD.format] === "pdf" ? "pdf" : "epub";

			entries.push({
				note,
				title,
				author,
				tags,
				format,
				size: Number(frontmatter[FIELD.size]) || 0,
				coverUrl: this.resolveCover(frontmatter[FIELD.cover], note),
				orphaned: Boolean(frontmatter[FIELD.orphaned]),
				haystack: `${title} ${author}`.toLowerCase(),
			});
		}

		entries.sort((a, b) => a.title.localeCompare(b.title, "de"));
		return entries;
	}

	private resolveCover(value: unknown, note: TFile): string | null {
		if (typeof value !== "string") return null;

		const linkpath = value.replace(/^!?\[\[/, "").replace(/\]\]$/, "").split("|")[0].trim();
		if (!linkpath) return null;

		const file = this.app.metadataCache.getFirstLinkpathDest(linkpath, note.path);
		return file ? this.app.vault.getResourcePath(file) : null;
	}

	/** Alle Tags des Katalogs als Chips, häufigste zuerst, mit Trefferzahl. */
	private renderTagChips(): void {
		const counts = new Map<string, number>();
		for (const entry of this.entries) {
			for (const tag of entry.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
		}

		const sorted = [...counts.entries()].sort(
			(a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "de"),
		);

		this.tagsEl.empty();
		for (const [tag, count] of sorted) {
			const chip = this.tagsEl.createEl("button", { cls: "ebook-chip" });
			chip.createSpan({ text: tag });
			chip.createSpan({ cls: "ebook-chip-count", text: String(count) });
			chip.toggleClass("is-on", this.selectedTags.has(tag));

			this.registerDomEvent(chip, "click", () => {
				if (this.selectedTags.has(tag)) this.selectedTags.delete(tag);
				else this.selectedTags.add(tag);
				chip.toggleClass("is-on", this.selectedTags.has(tag));
				this.applyFilters();
			});
		}

		if (sorted.length === 0) this.tagsEl.createSpan({ cls: "ebook-hint", text: "Noch keine Tags" });
	}

	private applyFilters(): void {
		const words = this.query.split(/\s+/).filter(Boolean);

		this.shown = this.entries.filter((entry) => {
			if (!this.formats.has(entry.format)) return false;
			for (const tag of this.selectedTags) if (!entry.tags.includes(tag)) return false;
			for (const word of words) if (!entry.haystack.includes(word)) return false;
			return true;
		});

		const total = this.entries.length;
		this.countEl.setText(
			this.shown.length === total
				? `${total} ${total === 1 ? "Buch" : "Bücher"}`
				: `${this.shown.length} von ${total} Büchern`,
		);

		this.scrollEl.scrollTop = 0;
		this.renderedRange = [-1, -1];
		this.paint();
	}

	/**
	 * Zeichnet nur die Zeilen, die gerade zu sehen sind. Bei mehreren tausend
	 * Büchern hängen dadurch nie mehr als ein paar Dutzend Zellen im DOM.
	 */
	private paint(): void {
		const rows = rowCount(this.shown.length, this.columns);
		this.sizerEl.style.height = `${rows * this.rowHeight}px`;

		const [first, last] = visibleRows(
			this.scrollEl.scrollTop,
			this.scrollEl.clientHeight,
			this.rowHeight,
			rows,
		);

		if (this.renderedRange[0] === first && this.renderedRange[1] === last) return;
		this.renderedRange = [first, last];

		this.windowEl.style.transform = `translateY(${first * this.rowHeight}px)`;
		this.windowEl.empty();

		for (let index = first * this.columns; index < last * this.columns; index++) {
			const entry = this.shown[index];
			if (entry) this.renderCell(this.windowEl, entry);
		}

		if (this.shown.length === 0) {
			this.windowEl.createDiv({
				cls: "ebook-empty",
				text:
					this.entries.length === 0
						? "Der Katalog ist leer. Mit „Scannen“ die Bibliothek einlesen."
						: "Kein Buch passt zu diesen Filtern.",
			});
		}
	}

	private renderCell(parent: HTMLElement, entry: Entry): void {
		const cell = parent.createDiv("ebook-cell");
		cell.toggleClass("is-orphaned", entry.orphaned);

		const cover = cell.createDiv("ebook-cover");
		if (entry.coverUrl) {
			cover.createEl("img", { attr: { src: entry.coverUrl, alt: "", loading: "lazy" } });
		} else {
			cover.createDiv({ cls: "ebook-nocover", text: entry.title });
		}
		if (entry.format === "pdf") pdfMark(cover);
		if (entry.orphaned) setTooltip(cell, "Die Buchdatei ist verschwunden");

		const title = cell.createDiv({ cls: "ebook-title", text: entry.title });
		setTooltip(title, entry.author ? `${entry.title}\n${entry.author}` : entry.title, {
			delay: 300,
		});

		cell.createDiv({ cls: "ebook-author", text: entry.author || "—" });

		const foot = cell.createDiv("ebook-foot");
		foot.createSpan({ cls: "ebook-size", text: megabytes(entry.size) });
		for (const tag of entry.tags.slice(0, 2)) {
			foot.createSpan({ cls: "ebook-minitag", text: tag });
		}

		this.registerDomEvent(cell, "click", () => {
			void this.app.workspace.getLeaf("tab").openFile(entry.note);
		});
	}
}

/**
 * Eigenes PDF-Symbol, unten rechts auf dem Cover. Der helle Rand hält es auch
 * auf dunklen Covern lesbar.
 */
function pdfMark(parent: HTMLElement): void {
	const svg = parent.createSvg("svg", {
		cls: "ebook-pdf",
		attr: { viewBox: "0 0 26 30", "aria-label": "PDF" },
	});
	svg.createSvg("path", {
		attr: {
			d: "M3.5 1.5h12l7 7v20a1.5 1.5 0 0 1-1.5 1.5h-17.5a1.5 1.5 0 0 1-1.5-1.5v-25.5a1.5 1.5 0 0 1 1.5-1.5z",
			class: "ebook-pdf-sheet",
		},
	});
	svg.createSvg("path", { attr: { d: "M15.5 1.5v7h7", class: "ebook-pdf-fold" } });
	svg.createSvg("rect", {
		attr: { x: "0.5", y: "13.5", width: "19", height: "10", rx: "1.5", class: "ebook-pdf-tab" },
	});
	svg.createSvg("text", {
		attr: { x: "10", y: "21", "text-anchor": "middle", class: "ebook-pdf-text" },
	}).setText("PDF");
}

function megabytes(bytes: number): string {
	return `${(bytes / 1048576).toFixed(1).replace(".", ",")} MB`;
}
