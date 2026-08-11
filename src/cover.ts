import { COVER_MAX_WIDTH } from "./types";

/**
 * Cover auf eine vernünftige Breite herunterrechnen und als JPEG ablegen.
 * Bei 1000 Büchern macht das den Unterschied zwischen ~30 MB und mehreren
 * hundert. Siehe KONZEPT.md, Abschnitt 7.
 */
export async function normalizeCover(raw: ArrayBuffer): Promise<ArrayBuffer> {
	const bitmap = await createImageBitmap(new Blob([raw]));
	try {
		const scale = Math.min(1, COVER_MAX_WIDTH / bitmap.width);
		const width = Math.max(1, Math.round(bitmap.width * scale));
		const height = Math.max(1, Math.round(bitmap.height * scale));

		const canvas = new OffscreenCanvas(width, height);
		const context = canvas.getContext("2d");
		if (!context) throw new Error("Kein 2D-Kontext für die Cover-Skalierung verfügbar");

		context.drawImage(bitmap, 0, 0, width, height);
		return await canvasToJpeg(canvas);
	} finally {
		bitmap.close();
	}
}

export async function canvasToJpeg(canvas: OffscreenCanvas): Promise<ArrayBuffer> {
	const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.82 });
	return await blob.arrayBuffer();
}
