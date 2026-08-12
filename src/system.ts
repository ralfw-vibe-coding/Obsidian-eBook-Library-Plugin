import { FileSystemAdapter, Platform, type App } from "obsidian";

/**
 * Die wenigen Stellen, an denen das Plugin über die Vault hinausgreift.
 *
 * Alles hier ist optional: fehlt Electron, entfallen die Möglichkeiten
 * stillschweigend, statt dass etwas abbricht.
 */

interface ElectronBits {
	shell?: {
		trashItem?: (path: string) => Promise<void>;
		showItemInFolder?: (path: string) => void;
	};
	webUtils?: { getPathForFile?: (file: File) => string };
}

function requireElectron(): ElectronBits | null {
	try {
		return (window as Window & { require?: (id: string) => ElectronBits }).require?.("electron") ?? null;
	} catch {
		return null;
	}
}

/** Absoluter Pfad einer Datei in der Vault, sofern die Vault auf Platte liegt. */
export function fullPathOf(app: App, vaultPath: string): string | null {
	const adapter = app.vault.adapter;
	return adapter instanceof FileSystemAdapter ? adapter.getFullPath(vaultPath) : null;
}

export function canReveal(app: App): boolean {
	return Boolean(requireElectron()?.shell?.showItemInFolder) && fullPathOf(app, "") !== null;
}

/** Zeigt die Datei im Dateimanager des Systems. */
export function reveal(app: App, vaultPath: string): void {
	const full = fullPathOf(app, vaultPath);
	const shell = requireElectron()?.shell;
	if (!full || !shell?.showItemInFolder) throw new Error("Der Dateimanager ist von hier nicht erreichbar.");

	shell.showItemInFolder(full);
}

/** Wie der Dateimanager beim Nutzer heißt. */
export function fileManagerName(): string {
	if (Platform.isMacOS) return "Finder";
	if (Platform.isWin) return "Explorer";
	return "Dateimanager";
}

/**
 * Eine Datei außerhalb der Vault in den Papierkorb des Systems — nicht
 * endgültig löschen, damit ein Fehlgriff zurückholbar bleibt.
 */
export async function trashSource(path: string): Promise<void> {
	const shell = requireElectron()?.shell;
	if (!shell?.trashItem) throw new Error("Der Papierkorb ist von hier nicht erreichbar.");
	await shell.trashItem(path);
}

export function canTrashSources(): boolean {
	return Boolean(requireElectron()?.shell?.trashItem);
}

/**
 * Electron gibt den echten Pfad einer gewählten Datei nur noch über webUtils
 * heraus; `File.path` ist in neueren Versionen fort. Ohne Pfad lässt sich die
 * Quelle hinterher nicht wegräumen — der Import selbst braucht ihn nicht.
 */
export function sourcePathOf(file: File): string | null {
	try {
		const viaUtils = requireElectron()?.webUtils?.getPathForFile?.(file);
		if (viaUtils) return viaUtils;
	} catch {
		// Fällt unten auf die alte Eigenschaft zurück.
	}

	return (file as File & { path?: string }).path || null;
}
