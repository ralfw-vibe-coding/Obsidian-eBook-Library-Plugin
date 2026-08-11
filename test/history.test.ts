/**
 * Prüft die Lauf-Historie: Zeitstempel, Zuordnung von Notizen zu Läufen und
 * das Kappen der Aufbewahrung.
 */
import { appendRun, belongsToRun, formatRunTime, recordOf, runId } from "../src/history";
import type { RunRecord } from "../src/history";
import type { ScanResult } from "../src/types";

let failures = 0;

function check(label: string, condition: boolean, detail = ""): void {
	console.log(`${condition ? "✓" : "✗"} ${label}${!condition && detail ? ` — ${detail}` : ""}`);
	if (!condition) failures++;
}

const id = runId(new Date(2026, 7, 11, 15, 42, 7));
check("Zeitstempel ist sortierbar", id === "2026-08-11T15:42:07", id);
check("Anzeige ist lesbar", formatRunTime(id) === "11.08.2026, 15:42", formatRunTime(id));
check("Anzeige verträgt reine Datumswerte", formatRunTime("2026-08-11") === "11.08.2026");

const run: RunRecord = {
	id,
	mode: "scan",
	scanned: 10,
	skipped: 8,
	ingested: 2,
	moved: 0,
	orphaned: 0,
	revived: 0,
	seconds: 1.2,
	problems: [],
	problemCount: 0,
};

check("Notiz desselben Laufs gehört dazu", belongsToRun(id, run));
check("Notiz eines anderen Laufs nicht", !belongsToRun("2026-08-11T09:00:00", run));
// Notizen aus der Zeit vor den Zeitstempeln tragen nur ein Datum.
check("altes Datum zählt zum Lauf desselben Tages", belongsToRun("2026-08-11", run));
check("altes Datum eines anderen Tages nicht", !belongsToRun("2026-08-10", run));
check("Leerwerte gehören nirgends dazu", !belongsToRun("", run) && !belongsToRun(undefined, run));

// Nur Fehlschläge werden im Einzelnen festgehalten, und nur begrenzt viele.
const result: ScanResult = {
	runId: id,
	scanned: 500,
	skipped: 400,
	ingested: Array.from({ length: 100 }, (_, n) => `buch-${n}.epub`),
	moved: [],
	orphaned: [],
	revived: [],
	problems: Array.from({ length: 250 }, (_, n) => ({ path: `x-${n}.pdf`, message: "kaputt" })),
};
const record = recordOf(result, "scan", 12.34);

check("Zahlen statt Listen für Erfolge", record.ingested === 100, String(record.ingested));
check("Dauer wird gerundet", record.seconds === 12.3, String(record.seconds));
check("Fehlschläge werden gekappt", record.problems.length === 100, String(record.problems.length));
check("die wahre Anzahl bleibt erhalten", record.problemCount === 250, String(record.problemCount));

let runs: RunRecord[] = [];
for (let n = 0; n < 40; n++) runs = appendRun(runs, { ...run, id: `run-${n}` });

check("neuester Lauf steht vorn", runs[0].id === "run-39", runs[0].id);
check("Historie wird begrenzt", runs.length === 30, String(runs.length));
check("ältester ist herausgefallen", !runs.some((r) => r.id === "run-9"));

console.log(failures === 0 ? "\nAlle Prüfungen bestanden." : `\n${failures} Prüfung(en) fehlgeschlagen.`);
process.exit(failures === 0 ? 0 : 1);
