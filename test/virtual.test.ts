/**
 * Prüft die Rechnung hinter dem virtualisierten Regalbrett — ohne DOM, ohne
 * Obsidian. Entscheidend ist, dass die Zahl der gezeichneten Zellen konstant
 * bleibt, egal ob der Katalog 20 oder 20000 Bücher hat.
 */
import { BUFFER_ROWS, columnsFor, rowCount, visibleRows } from "../src/virtual";

let failures = 0;

function check(label: string, condition: boolean, detail = ""): void {
	console.log(`${condition ? "✓" : "✗"} ${label}${!condition && detail ? ` — ${detail}` : ""}`);
	if (!condition) failures++;
}

// Spalten
check("volle Spalten passen", columnsFor(1000, 100, 18) === 8, String(columnsFor(1000, 100, 18)));
check("mindestens eine Spalte", columnsFor(40, 100, 18) === 1);
check("keine Division durch null", columnsFor(1000, 0, 18) === 1);

// Zeilen
check("Zeilen werden aufgerundet", rowCount(21, 8) === 3, String(rowCount(21, 8)));
check("leerer Katalog hat null Zeilen", rowCount(0, 8) === 0);

// Sichtfenster
const [first, last] = visibleRows(0, 800, 240, 500);
check("am Anfang beginnt es bei null", first === 0, String(first));
check(
	"am Anfang nur Sichtfenster plus Puffer",
	last === Math.ceil(800 / 240) + 2 * BUFFER_ROWS,
	String(last),
);

const [midFirst, midLast] = visibleRows(24000, 800, 240, 500);
check("mittendrin wird der Puffer abgezogen", midFirst === 100 - BUFFER_ROWS, String(midFirst));
check("Fensterbreite bleibt gleich", midLast - midFirst === last - first, `${midLast - midFirst}`);

const [endFirst, endLast] = visibleRows(500 * 240, 800, 240, 500);
check("am Ende wird nicht über die letzte Zeile hinaus gezeichnet", endLast === 500, String(endLast));
check("am Ende bleibt first <= last", endFirst <= endLast);

// Der eigentliche Punkt: konstante Last unabhängig von der Katalogröße.
const sizes = [20, 500, 5000, 50000];
const counts = sizes.map((size) => {
	const columns = columnsFor(1200, 100, 18);
	const rows = rowCount(size, columns);
	const [a, b] = visibleRows(Math.floor(rows / 2) * 240, 800, 240, rows);
	return (b - a) * columns;
});
check(
	"gezeichnete Zellen bleiben konstant",
	new Set(counts.slice(1)).size === 1,
	`${sizes.join("/")} -> ${counts.join("/")}`,
);
check("nie mehr als ein paar Dutzend Zellen", Math.max(...counts) <= 100, String(Math.max(...counts)));

// Randfälle
const [zeroFirst, zeroLast] = visibleRows(0, 800, 240, 0);
check("leerer Katalog ergibt leeres Fenster", zeroFirst === 0 && zeroLast === 0);
check("Zeilenhöhe null stürzt nicht ab", visibleRows(0, 800, 0, 10)[1] === 0);

console.log(failures === 0 ? "\nAlle Prüfungen bestanden." : `\n${failures} Prüfung(en) fehlgeschlagen.`);
process.exit(failures === 0 ? 0 : 1);
