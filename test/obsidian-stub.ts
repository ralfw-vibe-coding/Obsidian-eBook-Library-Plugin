/**
 * Minimaler Ersatz für die Obsidian-API, damit sich der Scanner in Node gegen
 * ein echtes Verzeichnis fahren lässt. Nur so viel, wie das Plugin benutzt.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

export function normalizePath(path: string): string {
	return path.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/|\/$/g, "");
}

export class TFile {
	constructor(
		public path: string,
		public root: string,
	) {}

	get name(): string {
		return this.path.split("/").pop() ?? this.path;
	}

	get basename(): string {
		return this.name.replace(/\.[^.]+$/, "");
	}

	get extension(): string {
		return this.name.split(".").pop() ?? "";
	}
}

export class Notice {
	constructor(public message: string) {}
	setMessage(): void {}
	hide(): void {}
}

export class Plugin {}

/** Der Prüfstand läuft in Node, nicht in Electron. */
export const Platform = {
	isDesktop: true,
	isDesktopApp: false,
	isMacOS: process.platform === "darwin",
	isWin: process.platform === "win32",
	isLinux: process.platform === "linux",
};

/**
 * Nur als Typ gebraucht: src/system.ts prüft mit `instanceof`, ob die Vault auf
 * Platte liegt. Im Prüfstand tut sie das nicht — also erbt der Ersatz-Adapter
 * bewusst nicht davon, und die Prüfung schlägt korrekt fehl.
 */
export class FileSystemAdapter {
	getFullPath(path: string): string {
		return path;
	}
}

class FakeAdapter {
	constructor(private root: string) {}

	private full(path: string): string {
		return join(this.root, path);
	}

	async list(path: string): Promise<{ files: string[]; folders: string[] }> {
		const files: string[] = [];
		const folders: string[] = [];

		for (const entry of readdirSync(this.full(path) || this.root)) {
			if (entry === ".DS_Store") continue;

			const relativePath = path ? `${path}/${entry}` : entry;
			if (statSync(this.full(relativePath)).isDirectory()) folders.push(relativePath);
			else files.push(relativePath);
		}
		return { files, folders };
	}

	async stat(path: string): Promise<{ size: number; mtime: number } | null> {
		if (!existsSync(this.full(path))) return null;
		const stats = statSync(this.full(path));
		return { size: stats.size, mtime: stats.mtimeMs };
	}

	async exists(path: string): Promise<boolean> {
		return existsSync(this.full(path));
	}

	async readBinary(path: string): Promise<ArrayBuffer> {
		const buffer = readFileSync(this.full(path));
		return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
	}

	async read(path: string): Promise<string> {
		return readFileSync(this.full(path), "utf8");
	}

	async write(path: string, content: string): Promise<void> {
		writeFileSync(this.full(path), content);
	}

	async writeBinary(path: string, data: ArrayBuffer): Promise<void> {
		writeFileSync(this.full(path), Buffer.from(data));
	}
}

export class App {
	adapter: FakeAdapter;
	vault: {
		adapter: FakeAdapter;
		getMarkdownFiles: () => TFile[];
		create: (path: string, content: string) => Promise<TFile>;
		createBinary: (path: string, data: ArrayBuffer) => Promise<TFile>;
		createFolder: (path: string) => Promise<void>;
	};
	metadataCache: { getFileCache: (file: TFile) => { frontmatter?: Record<string, unknown> } | null };
	fileManager: {
		processFrontMatter: (file: TFile, fn: (frontmatter: Record<string, unknown>) => void) => Promise<void>;
	};
	workspace = { getActiveFile: () => null, onLayoutReady: () => undefined };

	constructor(private root: string) {
		this.adapter = new FakeAdapter(root);
		const adapter = this.adapter;

		this.vault = {
			adapter,
			getMarkdownFiles: () => this.allMarkdownFiles(),
			create: async (path, content) => {
				mkdirSync(join(root, path, ".."), { recursive: true });
				writeFileSync(join(root, path), content);
				return new TFile(path, root);
			},
			createBinary: async (path, data) => {
				mkdirSync(join(root, path, ".."), { recursive: true });
				writeFileSync(join(root, path), Buffer.from(data));
				return new TFile(path, root);
			},
			createFolder: async (path) => {
				mkdirSync(join(root, path), { recursive: true });
			},
		};

		this.metadataCache = {
			getFileCache: (file) => ({ frontmatter: parseFrontMatter(readFileSync(join(root, file.path), "utf8")) }),
		};

		this.fileManager = {
			processFrontMatter: async (file, fn) => {
				const full = join(root, file.path);
				const content = readFileSync(full, "utf8");
				const frontmatter = parseFrontMatter(content) ?? {};
				fn(frontmatter);
				writeFileSync(full, replaceFrontMatter(content, frontmatter));
			},
		};
	}

	private allMarkdownFiles(): TFile[] {
		const found: TFile[] = [];
		const walk = (directory: string): void => {
			for (const entry of readdirSync(directory)) {
				if (entry.startsWith(".")) continue;

				const path = join(directory, entry);
				if (statSync(path).isDirectory()) walk(path);
				else if (entry.endsWith(".md")) found.push(new TFile(relative(this.root, path), this.root));
			}
		};
		walk(this.root);
		return found;
	}
}

/** Reicht für das Frontmatter, das dieses Plugin selbst schreibt. */
export function parseFrontMatter(content: string): Record<string, unknown> | undefined {
	const match = content.match(/^---\n([\s\S]*?)\n---/);
	if (!match) return undefined;

	const result: Record<string, unknown> = {};
	let listKey: string | null = null;

	for (const line of match[1].split("\n")) {
		const listItem = line.match(/^\s+-\s+(.*)$/);
		if (listItem && listKey) {
			(result[listKey] as string[]).push(unquote(listItem[1]));
			continue;
		}

		const pair = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
		if (!pair) continue;

		const [, key, rawValue] = pair;
		if (rawValue === "") {
			result[key] = [];
			listKey = key;
			continue;
		}

		listKey = null;
		result[key] = /^-?\d+$/.test(rawValue) ? Number(rawValue) : unquote(rawValue);
	}

	// Leere Werte sind keine Listen, sondern leere Felder.
	for (const [key, value] of Object.entries(result)) {
		if (Array.isArray(value) && value.length === 0 && key !== "tags") result[key] = "";
	}

	return result;
}

function replaceFrontMatter(content: string, frontmatter: Record<string, unknown>): string {
	const lines: string[] = [];
	for (const [key, value] of Object.entries(frontmatter)) {
		if (Array.isArray(value)) {
			lines.push(`${key}:`);
			for (const item of value) lines.push(`  - ${item}`);
		} else if (typeof value === "number") {
			lines.push(`${key}: ${value}`);
		} else {
			lines.push(`${key}: ${value === "" ? "" : `"${String(value).replace(/"/g, '\\"')}"`}`);
		}
	}

	const body = content.replace(/^---\n[\s\S]*?\n---\n?/, "");
	return `---\n${lines.join("\n")}\n---\n${body}`;
}

function unquote(value: string): string {
	const trimmed = value.trim();
	if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
		return trimmed.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
	}
	return trimmed;
}
