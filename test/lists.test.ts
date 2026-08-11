/**
 * Prüft das Lesen und Schreiben der Leselisten-Dateien.
 *
 * Der heikle Teil ist nicht die Reihenfolge, sondern das Drumherum: Text, den
 * der Nutzer über oder unter die Liste schreibt, muss stehen bleiben.
 */
import { assemble, parse, reorder } from "../src/lists";

let failures = 0;

function check(label: string, condition: boolean, detail = ""): void {
	console.log(`${condition ? "✓" : "✗"} ${label}${!condition && detail ? ` — ${detail}` : ""}`);
	if (!condition) failures++;
}

// --- Lesen -----------------------------------------------------------------

const plain = "- [[A]]\n- [[B]]\n- [[C]]\n";
check("Links werden in Reihenfolge gelesen", parse(plain).links.join() === "A,B,C");

const framed = "Erst Mukherjee.\n\n- [[A]]\n- [[B]]\n\nDanach was Leichtes.\n";
const parsedFramed = parse(framed);
check("Text davor bleibt erhalten", parsedFramed.before === "Erst Mukherjee.\n", JSON.stringify(parsedFramed.before));
check("Text danach bleibt erhalten", parsedFramed.after.includes("Danach was Leichtes."));
check("dazwischen die Links", parsedFramed.links.join() === "A,B");

check("Alias wird abgeschnitten", parse("- [[A|Anderer Name]]\n").links.join() === "A");
check("Sprungmarke wird abgeschnitten", parse("- [[A#Kapitel]]\n").links.join() === "A");
check("Sternchen zählt auch als Aufzählung", parse("* [[A]]\n").links.join() === "A");

const noLinks = "Nur Text, noch keine Bücher.\n";
check("ohne Links gilt alles als davor", parse(noLinks).before === noLinks && parse(noLinks).links.length === 0);

// --- Schreiben -------------------------------------------------------------

const rewritten = assemble(parsedFramed, ["- [[B]]", "- [[A]]"]);
check("Umsortiert geschrieben", rewritten.includes("- [[B]]\n- [[A]]"), JSON.stringify(rewritten));
check("Text davor überlebt das Schreiben", rewritten.startsWith("Erst Mukherjee."));
check("Text danach überlebt das Schreiben", rewritten.trimEnd().endsWith("Danach was Leichtes."));
check("keine Leerzeilenhalde", !rewritten.includes("\n\n\n"), JSON.stringify(rewritten));

const emptied = assemble(parsedFramed, []);
check("leere Liste laesst den Text stehen",
	emptied.includes("Erst Mukherjee.") && emptied.includes("Danach was Leichtes."),
	JSON.stringify(emptied));

// Runde: lesen, schreiben, wieder lesen ergibt dasselbe.
const roundTrip = parse(assemble(parse(plain), ["- [[A]]", "- [[B]]", "- [[C]]"]));
check("Hin und zurück ändert nichts", roundTrip.links.join() === "A,B,C");

// --- Umsortieren -----------------------------------------------------------

const items = ["A", "B", "C", "D"];
check("nach vorn", reorder(items, 2, 0).join() === "C,A,B,D", reorder(items, 2, 0).join());
check("nach hinten", reorder(items, 0, 3).join() === "B,C,A,D", reorder(items, 0, 3).join());
check("ans Ende", reorder(items, 0, 4).join() === "B,C,D,A", reorder(items, 0, 4).join());
check("an die eigene Stelle ändert nichts", reorder(items, 1, 1).join() === "A,B,C,D");
check("direkt dahinter ändert nichts", reorder(items, 1, 2).join() === "A,B,C,D");
check("das Original bleibt unberührt", items.join() === "A,B,C,D");
check("unsinnige Position ändert nichts", reorder(items, 9, 0).join() === "A,B,C,D");

console.log(failures === 0 ? "\nAlle Prüfungen bestanden." : `\n${failures} Prüfung(en) fehlgeschlagen.`);
process.exit(failures === 0 ? 0 : 1);
