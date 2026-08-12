import type { ScanResult } from "./types";

/**
 * Was von einem Ingest-Lauf übrig bleibt.
 *
 * Liegt in der data.json des Plugins, nicht als Markdown in der Vault: die
 * Notizen sind Datenhaltung, das Protokoll ist Bedienoberfläche.
 */
export interface RunRecord {
	/** Zeitstempel des Laufs, zugleich der Wert im `ingested`-Feld der Notizen. */
	id: string;
	mode: "scan" | "rehash" | "reingest" | "import";
	scanned: number;
	skipped: number;
	ingested: number;
	moved: number;
	orphaned: number;
	revived: number;
	/** Dauer in Sekunden. */
	seconds: number;
	/** Nur die Fehlschläge — Erfolge stehen in den Zahlen. */
	problems: { path: string; message: string }[];
	/** Kann größer sein als `problems.length`, wenn gekappt wurde. */
	problemCount: number;
}

/** So viele Läufe werden aufgehoben. */
const MAX_RUNS = 30;
/** So viele Fehlschläge je Lauf werden im Einzelnen festgehalten. */
const MAX_PROBLEMS = 100;

/** Sortierbar und lesbar, ohne Zeitzone: `2026-08-11T15:42:07`. */
export function runId(when: Date): string {
	const pad = (value: number) => String(value).padStart(2, "0");
	return (
		`${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}` +
		`T${pad(when.getHours())}:${pad(when.getMinutes())}:${pad(when.getSeconds())}`
	);
}

export function recordOf(
	result: ScanResult,
	mode: RunRecord["mode"],
	seconds: number,
): RunRecord {
	return {
		id: result.runId,
		mode,
		scanned: result.scanned,
		skipped: result.skipped,
		ingested: result.ingested.length,
		moved: result.moved.length,
		orphaned: result.orphaned.length,
		revived: result.revived.length,
		seconds: Math.round(seconds * 10) / 10,
		problems: result.problems.slice(0, MAX_PROBLEMS),
		problemCount: result.problems.length,
	};
}

export function appendRun(runs: RunRecord[], record: RunRecord): RunRecord[] {
	return [record, ...runs].slice(0, MAX_RUNS);
}

/**
 * Gehört diese Notiz zu diesem Lauf? Nur bei genauer Übereinstimmung.
 *
 * Notizen aus der Zeit vor den Zeitstempeln tragen nur ein Datum. Die auf den
 * Tag genau zuzuordnen wäre falsch: sie gehörten dann zu *jedem* Lauf dieses
 * Tages — ein Zugang von zwei Büchern zeigte plötzlich fünftausend. Zu welchem
 * Lauf sie kamen, ist schlicht nicht überliefert; sie gehören zu keinem.
 */
export function belongsToRun(ingested: unknown, run: RunRecord): boolean {
	const value = String(ingested ?? "").trim();
	return value !== "" && value === run.id;
}

/** `11.08.2026, 15:42` */
export function formatRunTime(id: string): string {
	const [date, time] = id.split("T");
	const [year, month, day] = date.split("-");
	if (!year || !month || !day) return id;
	return time ? `${day}.${month}.${year}, ${time.slice(0, 5)}` : `${day}.${month}.${year}`;
}
