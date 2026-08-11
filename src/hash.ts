/**
 * SHA-256 als Hex. Der Hash ist die Identität eines Buchs — er überlebt
 * Umbenennen und Verschieben. Siehe KONZEPT.md, Abschnitt 6.
 */
export async function sha256(data: ArrayBuffer): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", data);
	const bytes = new Uint8Array(digest);
	let hex = "";
	for (const b of bytes) hex += b.toString(16).padStart(2, "0");
	return hex;
}
