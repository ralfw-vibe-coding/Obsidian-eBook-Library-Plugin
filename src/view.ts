import {
	ButtonComponent,
	ItemView,
	SearchComponent,
	SliderComponent,
	TFile,
	WorkspaceLeaf,
	debounce,
	setIcon,
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
	private tagLimit = 2;
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

		this.countEl = bar.createDiv("ebook-count");

		const formatGroup = bar.createDiv("ebook-formats");
		for (const format of BOOK_EXTENSIONS) {
			const chip = formatGroup.createEl("button", {
				cls: "ebook-chip is-on",
				text: format.toUpperCase(),
			});
			setTooltip(chip, `${format.toUpperCase()}-Bücher zeigen`);
			this.registerDomEvent(chip, "click", () => {
				if (this.formats.has(format)) this.formats.delete(format);
				else this.formats.add(format);
				chip.toggleClass("is-on", this.formats.has(format));
				this.applyFilters();
			});
		}

		const zoomWrap = bar.createDiv("ebook-zoom");
		setTooltip(zoomWrap, "Größe der Cover");
		setIcon(zoomWrap.createSpan("ebook-zoom-icon"), "zoom-in");

		const readout = zoomWrap.createSpan({ cls: "ebook-zoom-value" });
		const showZoom = (value: number) => readout.setText(`${value} %`);
		showZoom(this.host.zoom);

		new SliderComponent(zoomWrap)
			.setLimits(60, 260, 5)
			.setValue(this.host.zoom)
			.onChange((value) => {
				showZoom(value);
				this.applyZoom(value);
				this.host.saveZoom(value);
				this.renderedRange = [-1, -1];
				this.paint();
			});

		const scan = new ButtonComponent(bar)
			.setIcon("refresh-cw")
			.setClass("ebook-scan")
			.setTooltip("Bibliothek scannen, neue Bücher aufnehmen");
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

		// Die PDF-Marke wächst gedämpft mit: bei kleinen Covern muss sie lesbar
		// bleiben, bei großen soll sie nicht ins Bild drängen.
		// Wie viele Tag-Chips nebeneinander passen, hängt an der Coverbreite.
		// Konservativ gerechnet, mit Platz für das „+n" am Ende — ein halb
		// abgeschnittener Chip sieht schlimmer aus als einer weniger.
		this.tagLimit = Math.min(4, Math.max(1, Math.floor((width - 30) / 70)));

		const mark = Math.round(Math.min(38, Math.max(20, width * 0.22)));
		this.contentEl.style.setProperty("--ebook-mark-width", `${mark}px`);
		this.contentEl.style.setProperty("--ebook-mark-height", `${Math.round(mark * 34 / 30)}px`);

		// Feste Höhe je Zelle — sonst lässt sich nicht ausrechnen, welche Zeilen
		// gerade sichtbar sind, und die Virtualisierung fällt in sich zusammen.
		// Zwei Zeilen Titel, je eine für Autor, Tags und Größe.
		const meta = 5 * lineHeight + 8;
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

		// Titel und Autor fließen unmittelbar untereinander; Tags und Größe
		// hängen am unteren Rand, damit sie über alle Zellen auf einer Linie
		// liegen, egal wie lang der Titel ist.
		const meta = cell.createDiv("ebook-meta");

		const title = meta.createDiv({ cls: "ebook-title", text: entry.title });
		setTooltip(title, entry.author ? `${entry.title}\n${entry.author}` : entry.title, {
			delay: 300,
		});

		meta.createDiv({ cls: "ebook-author", text: entry.author || "—" });

		// Lieber wenige ganze Chips als viele abgeschnittene: was nicht passt,
		// wird als Zahl angedeutet statt auf zwei Buchstaben gestutzt.
		const tagRow = meta.createDiv("ebook-tagrow");
		for (const tag of entry.tags.slice(0, this.tagLimit)) {
			tagRow.createSpan({ cls: "ebook-minichip", text: tag });
		}
		const hidden = entry.tags.length - this.tagLimit;
		if (hidden > 0) {
			const more = tagRow.createSpan({ cls: "ebook-minichip is-more", text: `+${hidden}` });
			setTooltip(more, entry.tags.join(", "));
		}

		meta.createDiv({ cls: "ebook-size", text: megabytes(entry.size) });

		this.registerDomEvent(cell, "click", () => {
			void this.app.workspace.getLeaf("tab").openFile(entry.note);
		});
	}
}

/**
 * PDF-Symbol unten rechts auf dem Cover: weißes Blatt mit gekappter Ecke,
 * grauen Textlinien und rotem Balken. Die weiße Fläche und der Schlagschatten
 * halten es auch auf dunklen Covern lesbar.
 */
function pdfMark(parent: HTMLElement): void {
	const svg = parent.createSvg("svg", {
		cls: "ebook-pdf",
		attr: { viewBox: "0 0 30 34", "aria-label": "PDF" },
	});

	svg.createSvg("path", {
		attr: {
			d: "M10.6 1.4h11.2l6.8 6.8v22a2.4 2.4 0 0 1-2.4 2.4h-15.6a2.4 2.4 0 0 1-2.4-2.4v-26.4a2.4 2.4 0 0 1 2.4-2.4z",
			class: "ebook-pdf-sheet",
		},
	});

	for (const y of [9.5, 12.6, 15.7, 18.8, 21.9]) {
		svg.createSvg("line", {
			attr: { x1: "11.8", y1: String(y), x2: "24.6", y2: String(y), class: "ebook-pdf-rule" },
		});
	}

	svg.createSvg("rect", {
		attr: { x: "2.2", y: "17.6", width: "17.6", height: "9.8", rx: "1.4", class: "ebook-pdf-tab" },
	});
	svg.createSvg("text", {
		attr: { x: "11", y: "24.9", "text-anchor": "middle", class: "ebook-pdf-text" },
	}).setText("PDF");
}

function megabytes(bytes: number): string {
	return `${(bytes / 1048576).toFixed(1).replace(".", ",")} MB`;
}
