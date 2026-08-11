import {
	ItemView,
	Menu,
	Notice,
	SearchComponent,
	TFile,
	WorkspaceLeaf,
	debounce,
	setIcon,
	setTooltip,
} from "obsidian";
import { ConfirmModal } from "./confirm";
import { belongsToRun, formatRunTime, type RunRecord } from "./history";
import { ListPicker } from "./list-picker";
import {
	addToList,
	createList,
	isListFile,
	moveInList,
	readList,
	readLists,
	removeFromList,
	type ReadingList,
} from "./lists";
import { LogModal } from "./log";
import { FIELD, catalogNotes, readHash } from "./note";
import { BOOK_EXTENSIONS, type BookFormat } from "./types";
import { columnsFor, rowCount, visibleRows } from "./virtual";

export const VIEW_TYPE_LIBRARY = "ebook-library-view";

/** Was der View vom Plugin braucht — hält die beiden Module voneinander frei. */
export interface LibraryHost {
	runScan(): Promise<void>;
	zoom: number;
	saveZoom(zoom: number): void;
	/** Protokoll der letzten Ingest-Läufe, neuester zuerst. */
	runs: RunRecord[];
}

interface Entry {
	note: TFile;
	title: string;
	author: string;
	tags: string[];
	format: BookFormat;
	size: number;
	/** Pfad der Buchdatei — für den Bezug aus dem Protokoll. */
	bookPath: string;
	/** Zeitstempel des Laufs, der das Buch aufgenommen hat. */
	ingested: string;
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
	/** Zeigt nur die Bücher eines bestimmten Ingest-Laufs. */
	private runFilter: RunRecord | null = null;
	/** Zeigt nur die Bücher einer Leseliste, in deren Reihenfolge. */
	private activeList: ReadingList | null = null;
	/** Position im Raster, von der aus gerade gezogen wird. */
	private dragFrom: number | null = null;

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
		this.registerDomEvent(this.countEl, "click", () => {
			if (this.activeList) {
				void this.setActiveList(null);
				return;
			}
			if (!this.runFilter) return;
			this.runFilter = null;
			this.applyFilters();
		});

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

		// Bewusst ein nacktes input statt SliderComponent: die zeigt ihren Wert
		// selbst noch einmal an und bringt einen klobigen Griff mit.
		const slider = zoomWrap.createEl("input", {
			cls: "ebook-slider",
			attr: { type: "range", min: "60", max: "260", step: "5", value: String(this.host.zoom) },
		});
		this.registerDomEvent(slider, "input", () => {
			const value = Number(slider.value);
			showZoom(value);
			this.applyZoom(value);
			this.host.saveZoom(value);
			this.renderedRange = [-1, -1];
			this.paint();
		});

		const lists = bar.createEl("button", { cls: "clickable-icon ebook-lists" });
		setTooltip(lists, "Leselisten");
		safeIcon(lists, "list-ordered", "Listen");
		this.registerDomEvent(lists, "click", (event) => void this.showListMenu(event));

		const history = bar.createEl("button", { cls: "clickable-icon ebook-history" });
		setTooltip(history, "Zugänge und Protokoll");
		safeIcon(history, "history", "Zugänge");
		this.registerDomEvent(history, "click", (event) => this.showRunMenu(event));

		const scan = bar.createEl("button", { cls: "clickable-icon ebook-scan" });
		setTooltip(scan, "Bibliothek scannen, neue Bücher aufnehmen");
		scanIcon(scan);
		this.registerDomEvent(scan, "click", () => {
			scan.toggleClass("is-busy", true);
			void this.host.runScan().finally(() => {
				scan.toggleClass("is-busy", false);
				this.reload();
			});
		});
	}

	/**
	 * Die Leselisten. Eine ausgewählt heißt: nur ihre Bücher, in ihrer
	 * Reihenfolge, und umsortierbar.
	 */
	private async showListMenu(event: MouseEvent): Promise<void> {
		const lists = await readLists(this.app);
		const menu = new Menu();

		menu.addItem((item) =>
			item
				.setTitle("Alle Bücher")
				.setIcon("library-big")
				.setChecked(this.activeList === null)
				.onClick(() => void this.setActiveList(null)),
		);

		if (lists.length > 0) {
			menu.addSeparator();
			for (const list of lists) {
				menu.addItem((item) =>
					item
						.setTitle(`${list.name} (${list.books.length})`)
						.setChecked(this.activeList?.file.path === list.file.path)
						.onClick(() => void this.setActiveList(list)),
				);
			}
		}

		// Löschen nur, wenn eine Liste aufgeschlagen ist — sonst wäre unklar,
		// welche gemeint ist. Neue Listen entstehen beim Hinzufügen eines Buchs,
		// dafür braucht es hier keinen Eintrag.
		const open = this.activeList;
		if (open) {
			menu.addSeparator();
			menu.addItem((item) =>
				item
					.setTitle(`„${open.name}“ löschen …`)
					.setIcon("trash-2")
					.onClick(() => this.confirmDeleteList(open)),
			);
		}

		menu.showAtMouseEvent(event);
	}

	/**
	 * Eine Liste wegzuwerfen ist der einzige Griff im Plugin, der etwas
	 * vernichtet — deshalb mit Rückfrage. Die Datei geht in den Papierkorb,
	 * die Bücher bleiben selbstverständlich unberührt.
	 */
	private confirmDeleteList(list: ReadingList): void {
		new ConfirmModal(
			this.app,
			`„${list.name}“ löschen?`,
			`Die Leseliste mit ${list.books.length} ${list.books.length === 1 ? "Buch" : "Büchern"} wandert in den Papierkorb. Die Bücher selbst bleiben unberührt.`,
			"Löschen",
			() => {
				void this.app.fileManager.trashFile(list.file).then(() => {
					new Notice(`„${list.name}“ gelöscht.`);
					void this.setActiveList(null);
				});
			},
		).open();
	}

	private async setActiveList(list: ReadingList | Promise<ReadingList> | null): Promise<void> {
		this.activeList = list ? await list : null;
		if (this.activeList) this.runFilter = null;

		this.contentEl.toggleClass("is-list-mode", this.activeList !== null);
		this.applyFilters();
	}

	/** Kontextmenü eines Buchs: Listenzugehörigkeit und Position. */
	private showBookMenu(event: MouseEvent, entry: Entry, position: number): void {
		event.preventDefault();
		const menu = new Menu();

		menu.addItem((item) =>
			item
				.setTitle("Zu Leseliste hinzufügen …")
				.setIcon("list-plus")
				.onClick(() => this.addToSomeList(entry)),
		);

		const list = this.activeList;
		if (list) {
			menu.addSeparator();
			if (position > 0) {
				menu.addItem((item) =>
					item
						.setTitle("An den Anfang")
						.setIcon("arrow-up")
						.onClick(() => void this.reorder(position, 0)),
				);
			}
			if (position < this.shown.length - 1) {
				menu.addItem((item) =>
					item
						.setTitle("Ans Ende")
						.setIcon("arrow-down")
						.onClick(() => void this.reorder(position, this.shown.length)),
				);
			}
			menu.addSeparator();
			menu.addItem((item) =>
				item
					.setTitle(`Aus „${list.name}“ entfernen`)
					.setIcon("trash-2")
					.onClick(() => {
						void removeFromList(this.app, list.file, entry.note).then(() =>
							this.setActiveList(readList(this.app, list.file)),
						);
					}),
			);
		}

		menu.showAtMouseEvent(event);
	}

	private addToSomeList(entry: Entry): void {
		new ListPicker(this.app, "Zu Leseliste hinzufügen", (file, newName) => {
			const target = file ? Promise.resolve(file) : createList(this.app, newName ?? "Leseliste");
			void target.then(async (list) => {
				const added = await addToList(this.app, list, entry.note);
				new Notice(
					added
						? `„${entry.title}“ zu „${list.basename}“ hinzugefügt.`
						: `„${entry.title}“ steht schon in „${list.basename}“.`,
				);
				if (this.activeList?.file.path === list.path) {
					await this.setActiveList(readList(this.app, list));
				}
			});
		}).open();
	}

	private async reorder(from: number, to: number): Promise<void> {
		const list = this.activeList;
		if (!list) return;

		await moveInList(this.app, list.file, from, to);
		await this.setActiveList(readList(this.app, list.file));
	}

	/**
	 * Die Zugänge: welcher Lauf hat was gebracht. Ein Lauf ausgewählt heißt,
	 * nur dessen Bücher zu sehen — der Katalog bleibt der Katalog.
	 */
	private showRunMenu(event: MouseEvent): void {
		const menu = new Menu();

		menu.addItem((item) =>
			item
				.setTitle("Alle Bücher")
				.setIcon("library-big")
				.setChecked(this.runFilter === null)
				.onClick(() => {
					this.runFilter = null;
					this.applyFilters();
				}),
		);

		const withNew = this.host.runs.filter((run) => run.ingested > 0);
		if (withNew.length > 0) {
			menu.addSeparator();
			for (const run of withNew) {
				menu.addItem((item) =>
					item
						.setTitle(
							`${formatRunTime(run.id)} · ${run.ingested} ${run.ingested === 1 ? "Buch" : "Bücher"}`,
						)
						.setChecked(this.runFilter?.id === run.id)
						.onClick(() => {
							this.runFilter = run;
							this.applyFilters();
						}),
				);
			}
		}

		menu.addSeparator();
		menu.addItem((item) =>
			item
				.setTitle("Protokoll …")
				.setIcon("scroll-text")
				.onClick(() => this.openLog()),
		);

		menu.showAtMouseEvent(event);
	}

	private openLog(): void {
		if (this.host.runs.length === 0) {
			new Notice("Es hat noch kein Ingest stattgefunden.");
			return;
		}

		new LogModal(
			this.app,
			this.host.runs,
			(bookPath) => this.openBook(bookPath),
			this.runFilter?.id,
		).open();
	}

	/** Aus dem Protokoll zum Buch springen — sofern es eine Notiz dazu gibt. */
	private openBook(bookPath: string): void {
		const entry = this.entries.find((candidate) => candidate.bookPath === bookPath);
		if (!entry) {
			new Notice("Zu dieser Datei gibt es keine Katalog-Notiz.");
			return;
		}
		void this.app.workspace.getLeaf("tab").openFile(entry.note);
	}

	private applyZoom(zoom: number): void {
		const width = Math.round(zoom);
		const fontSize = Math.min(15, Math.max(11, Math.round(11 * (zoom / 100) ** 0.4)));
		const lineHeight = Math.round(fontSize * 1.35);

		// Tags und Größe laufen kleiner als Titel und Autor.
		const smallSize = Math.max(9, Math.round(fontSize * 0.82));
		const smallLine = Math.round(smallSize * 1.45);

		this.contentEl.style.setProperty("--ebook-cover-width", `${width}px`);
		this.contentEl.style.setProperty("--ebook-font-size", `${fontSize}px`);
		this.contentEl.style.setProperty("--ebook-line-height", `${lineHeight}px`);
		this.contentEl.style.setProperty("--ebook-small-size", `${smallSize}px`);
		this.contentEl.style.setProperty("--ebook-small-line", `${smallLine}px`);

		// Mindestens drei Tags sollen ganz sichtbar sein; die zweite Zeile fängt
		// auf, was bei schmalen Covern nicht nebeneinander passt.
		this.tagLimit = Math.min(6, Math.max(3, Math.floor(width / 48)));

		// Die PDF-Marke wächst gedämpft mit: bei kleinen Covern muss sie lesbar
		// bleiben, bei großen soll sie nicht ins Bild drängen.
		const mark = Math.round(Math.min(38, Math.max(20, width * 0.22)));
		this.contentEl.style.setProperty("--ebook-mark-width", `${mark}px`);
		this.contentEl.style.setProperty("--ebook-mark-height", `${Math.round(mark * 34 / 30)}px`);

		// Feste Höhe je Zelle — sonst lässt sich nicht ausrechnen, welche Zeilen
		// gerade sichtbar sind, und die Virtualisierung fällt in sich zusammen.
		// Zwei Zeilen Titel, eine Autor, bis zu zwei für die Tags, eine für die
		// Größe. Ungenutzter Platz fällt ans Zellenende, nicht zwischen die Zeilen.
		const meta = 3 * lineHeight + 3 * smallLine + 4;
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
			if (isListFile(note)) continue;

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
				bookPath: String(frontmatter[FIELD.file] ?? ""),
				ingested: String(frontmatter[FIELD.ingested] ?? ""),
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

		// Im Listenmodus bestimmt die Liste, welche Bücher es gibt und in welcher
		// Reihenfolge; Suche und Filter grenzen darin weiter ein.
		const positions = this.activeList
			? new Map(this.activeList.books.map((book, index) => [book.path, index]))
			: null;

		this.shown = this.entries.filter((entry) => {
			if (positions && !positions.has(entry.note.path)) return false;
			if (this.runFilter && !belongsToRun(entry.ingested, this.runFilter)) return false;
			if (!this.formats.has(entry.format)) return false;
			for (const tag of this.selectedTags) if (!entry.tags.includes(tag)) return false;
			for (const word of words) if (!entry.haystack.includes(word)) return false;
			return true;
		});

		if (positions) {
			this.shown.sort(
				(a, b) => (positions.get(a.note.path) ?? 0) - (positions.get(b.note.path) ?? 0),
			);
		}

		this.renderCount();

		this.scrollEl.scrollTop = 0;
		this.renderedRange = [-1, -1];
		this.paint();
	}

	/** Ist ein Zugang gewählt, sagt die Zeile das — und hebt ihn per Klick auf. */
	private renderCount(): void {
		const total = this.entries.length;
		this.countEl.empty();
		this.countEl.toggleClass("is-filtered", this.runFilter !== null || this.activeList !== null);

		if (this.activeList) {
			this.countEl.setText(`${this.activeList.name} · ${this.shown.length}`);
			setTooltip(this.countEl, "Leseliste verlassen");
			return;
		}

		if (this.runFilter) {
			this.countEl.setText(
				`Zugang ${formatRunTime(this.runFilter.id)} · ${this.shown.length}`,
			);
			setTooltip(this.countEl, "Zugangsfilter aufheben");
			return;
		}

		setTooltip(this.countEl, "");
		this.countEl.setText(
			this.shown.length === total
				? `${total} ${total === 1 ? "Buch" : "Bücher"}`
				: `${this.shown.length} von ${total} Büchern`,
		);
	}

	/**
	 * Zeichnet nur die Zeilen, die gerade zu sehen sind. Bei mehreren tausend
	 * Büchern hängen dadurch nie mehr als ein paar Dutzend Zellen im DOM.
	 */
	private paint(): void {
		// Im Listenmodus ohne Virtualisierung: der Zwang dazu kam von tausenden
		// Büchern, eine Leseliste hat Dutzende. Alle Zellen wirklich im DOM zu
		// haben, macht Ziehen und Ablegen erst unkompliziert.
		if (this.activeList) {
			this.paintAll();
			return;
		}

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
			if (entry) this.renderCell(this.windowEl, entry, index);
		}

		this.renderEmptyHint();
	}

	private paintAll(): void {
		this.sizerEl.style.height = "auto";
		this.windowEl.style.transform = "none";
		this.windowEl.empty();
		this.renderedRange = [-1, -1];

		this.shown.forEach((entry, index) => this.renderCell(this.windowEl, entry, index));
		this.renderEmptyHint();
	}

	private renderEmptyHint(): void {
		if (this.shown.length > 0) return;

		this.windowEl.createDiv({
			cls: "ebook-empty",
			text: this.activeList
				? `„${this.activeList.name}“ ist leer. Bücher über das Kontextmenü hinzufügen.`
				: this.entries.length === 0
					? "Der Katalog ist leer. Mit „Scannen“ die Bibliothek einlesen."
					: "Kein Buch passt zu diesen Filtern.",
		});
	}

	private renderCell(parent: HTMLElement, entry: Entry, position: number): void {
		const cell = parent.createDiv("ebook-cell");
		cell.toggleClass("is-orphaned", entry.orphaned);

		const cover = cell.createDiv("ebook-cover");
		if (entry.coverUrl) {
			cover.createEl("img", { attr: { src: entry.coverUrl, alt: "", loading: "lazy" } });
		} else {
			cover.createDiv({ cls: "ebook-nocover", text: entry.title });
		}
		if (entry.format === "pdf") pdfMark(cover);
		if (this.activeList) cover.createSpan({ cls: "ebook-position", text: String(position + 1) });
		if (entry.orphaned) setTooltip(cell, "Die Buchdatei ist verschwunden");

		// Titel, Autor, Tags, Größe fließen ohne Zwischenraum untereinander.
		const meta = cell.createDiv("ebook-meta");

		const title = meta.createDiv({ cls: "ebook-title", text: entry.title });
		setTooltip(title, entry.author ? `${entry.title}\n${entry.author}` : entry.title, {
			delay: 300,
		});

		meta.createDiv({ cls: "ebook-author", text: entry.author || "—" });

		// Tags als Chips, die bei Bedarf in eine zweite Zeile umbrechen — so sind
		// auch bei schmalen Covern drei ganze Chips zu sehen. Was darüber hinaus
		// geht, steht als Zahl am Ende; der Tooltip nennt alle.
		const tagRow = meta.createDiv("ebook-tagrow");
		for (const tag of entry.tags.slice(0, this.tagLimit)) {
			tagRow.createSpan({ cls: "ebook-minichip", text: tag });
		}
		const hidden = entry.tags.length - this.tagLimit;
		if (hidden > 0) tagRow.createSpan({ cls: "ebook-minichip is-more", text: `+${hidden}` });
		if (entry.tags.length > 0) setTooltip(tagRow, entry.tags.join(", "));

		meta.createDiv({ cls: "ebook-size", text: megabytes(entry.size) });

		this.registerDomEvent(cell, "click", () => {
			void this.app.workspace.getLeaf("tab").openFile(entry.note);
		});

		this.registerDomEvent(cell, "contextmenu", (event) =>
			this.showBookMenu(event, entry, position),
		);

		if (this.activeList) this.makeDraggable(cell, position);
	}

	/** Umsortieren im Listenmodus. */
	private makeDraggable(cell: HTMLElement, position: number): void {
		cell.draggable = true;

		this.registerDomEvent(cell, "dragstart", (event) => {
			this.dragFrom = position;
			cell.addClass("is-dragging");
			event.dataTransfer?.setData("text/plain", String(position));
			if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
		});

		this.registerDomEvent(cell, "dragend", () => {
			this.dragFrom = null;
			this.clearDropMarks();
		});

		this.registerDomEvent(cell, "dragover", (event) => {
			if (this.dragFrom === null) return;
			event.preventDefault();
			if (event.dataTransfer) event.dataTransfer.dropEffect = "move";

			const rect = cell.getBoundingClientRect();
			const before = event.clientX < rect.left + rect.width / 2;
			this.clearDropMarks();
			cell.addClass(before ? "is-drop-before" : "is-drop-after");
		});

		this.registerDomEvent(cell, "drop", (event) => {
			if (this.dragFrom === null) return;
			event.preventDefault();

			const rect = cell.getBoundingClientRect();
			const before = event.clientX < rect.left + rect.width / 2;
			const from = this.dragFrom;

			this.dragFrom = null;
			this.clearDropMarks();
			void this.reorder(from, before ? position : position + 1);
		});
	}

	private clearDropMarks(): void {
		for (const marked of Array.from(
			this.windowEl.querySelectorAll(".is-drop-before, .is-drop-after, .is-dragging"),
		)) {
			marked.removeClasses(["is-drop-before", "is-drop-after", "is-dragging"]);
		}
	}
}

/**
 * Symbol setzen — und wenn Obsidian den Namen nicht kennt, wenigstens Text.
 *
 * `setIcon` mit einem unbekannten Namen zeichnet wortlos nichts; übrig bleibt
 * ein leerer, unsichtbarer Knopf. Genau das ist mit `inbox` passiert, das es in
 * Obsidians Lucide-Satz nicht gibt.
 */
function safeIcon(button: HTMLElement, icon: string, fallback: string): void {
	setIcon(button, icon);
	if (button.querySelector("svg")) return;

	button.addClass("ebook-icon-fallback");
	button.setText(fallback);
}

/**
 * Lucides `refresh-cw` mit einem Plus in der Mitte: einlesen, was neu ist.
 * Selbst gezeichnet, weil es die Kombination als fertiges Icon nicht gibt.
 */
function scanIcon(parent: HTMLElement): void {
	const svg = parent.createSvg("svg", {
		cls: "ebook-scan-icon",
		attr: { viewBox: "0 0 24 24", "aria-label": "Scannen" },
	});

	for (const d of [
		"M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8",
		"M21 3v5h-5",
		"M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16",
		"M8 16H3v5",
		"M12 9.2v5.6",
		"M9.2 12h5.6",
	]) {
		svg.createSvg("path", { attr: { d } });
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
