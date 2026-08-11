import { normalizePath, type App } from "obsidian";
import { ensureFolder } from "./note";
import { BASE_PATH, CATALOG_FOLDER } from "./types";

/**
 * Die Katalogansicht ist zunächst eine mitgelieferte Bases-Datei statt eines
 * eigenen ItemView. Siehe KONZEPT.md, Abschnitt 9.
 *
 * Wird nur angelegt, wenn sie fehlt — eigene Anpassungen bleiben erhalten.
 */
const BASE_CONTENT = `filters:
  and:
    - file.hasProperty("hash")
views:
  - type: cards
    name: Galerie
    image: cover
    imageAspectRatio: 1.5
    imageFit: cover
    cardSize: 180
    order:
      - title
      - author
    sort:
      - property: title
        direction: ASC
  - type: table
    name: Liste
    order:
      - title
      - author
      - year
      - tags
      - format
      - size
    sort:
      - property: title
        direction: ASC
`;

export async function ensureBaseFile(app: App): Promise<void> {
	await ensureFolder(app, CATALOG_FOLDER);

	const path = normalizePath(BASE_PATH);
	if (await app.vault.adapter.exists(path)) return;

	await app.vault.create(path, BASE_CONTENT);
}
