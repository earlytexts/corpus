/**
 * Write the compiled catalogue to `catalogue/` — the corpus's build output, read
 * by the computer (via CORPUS_DIR) and used by the Compositor as a startup cache:
 *
 *   catalogue/catalogue.json              the structure + metadata (+ warnings)
 *   catalogue/documents/<docKey>.json     one (uncomposed) document per edition
 *   catalogue/dictionary.json             the dictionary, expanded
 *
 * Runtime-neutral: the Deno build script (../scripts/build.ts) and the Node
 * Compositor both call this with a `CorpusFsWrite` binding. `catalogue/` is
 * replaced wholesale so a stale document file can never linger.
 */

import type { Catalogue, CatalogueFile } from "../catalogue/types.ts";
import type { CorpusFsWrite } from "../fs/ports.ts";
import { serializeCatalogue, sourceDocKeys } from "../catalogue/serialize.ts";

export const writeCatalogue = async (
  fs: CorpusFsWrite,
  root: string,
  catalogue: Catalogue,
  warnings: string[],
): Promise<{
  catalogue: CatalogueFile;
  documents: Map<string, string>;
  dictionary: string;
}> => {
  const real = await fs.realPath(root);
  const serialized = serializeCatalogue(catalogue, warnings, real);
  const catalogueDir = `${real}/catalogue`;
  await fs.remove(catalogueDir);
  await fs.mkdir(`${catalogueDir}/documents`);
  await fs.writeFile(
    `${catalogueDir}/catalogue.json`,
    JSON.stringify(serialized.catalogue),
  );
  await fs.writeFile(
    `${catalogueDir}/dictionary.json`,
    serialized.dictionary,
  );
  for (const [docKey, json] of serialized.documents) {
    const path = `${catalogueDir}/documents/${docKey}.json`;
    await fs.mkdir(path.slice(0, path.lastIndexOf("/")));
    await fs.writeFile(path, json);
  }
  return serialized;
};

/**
 * Refresh only the parts of `catalogue/` a dictionary edit can change —
 * `catalogue.json` (its warnings may mention dropped entries) and
 * `dictionary.json` — leaving `documents/` untouched. Only sound over a
 * `catalogue/` whose documents are already current, i.e. after a full
 * `writeCatalogue` of the same compiled documents; the caller owns that
 * guarantee (see the Compositor's corpusModel).
 */
export const writeCatalogueDictionary = async (
  fs: CorpusFsWrite,
  root: string,
  catalogue: Catalogue,
  warnings: string[],
): Promise<void> => {
  const real = await fs.realPath(root);
  const serialized = serializeCatalogue(catalogue, warnings, real, false);
  await fs.writeFile(
    `${real}/catalogue/catalogue.json`,
    JSON.stringify(serialized.catalogue),
  );
  await fs.writeFile(
    `${real}/catalogue/dictionary.json`,
    serialized.dictionary,
  );
};

/**
 * Refresh `catalogue.json`, `dictionary.json`, and only the `documents/` files
 * for the given changed source `.mit` files (root-relative, e.g.
 * `data/works/hume/enquiry/1748.mit`) — the incremental write behind a single
 * document save, so a save no longer serialises and rewrites all ~1300
 * documents (the memory spike that ran the extension host out of memory). Like
 * `writeCatalogueDictionary`, only sound over a `catalogue/` whose *other*
 * documents are already current; a deleted or renamed source is not covered
 * (its stale document file would linger), so the caller forces a full
 * `writeCatalogue` then (see the Compositor's corpusModel).
 */
export const writeCatalogueSources = async (
  fs: CorpusFsWrite,
  root: string,
  catalogue: Catalogue,
  warnings: string[],
  sources: ReadonlySet<string>,
): Promise<void> => {
  const real = await fs.realPath(root);
  const bySource = sourceDocKeys(catalogue, real);
  const docKeys = new Set<string>();
  for (const source of sources) {
    const docKey = bySource.get(source);
    if (docKey !== undefined) docKeys.add(docKey);
  }
  const serialized = serializeCatalogue(
    catalogue,
    warnings,
    real,
    (docKey) => docKeys.has(docKey),
  );
  const catalogueDir = `${real}/catalogue`;
  await fs.writeFile(
    `${catalogueDir}/catalogue.json`,
    JSON.stringify(serialized.catalogue),
  );
  await fs.writeFile(`${catalogueDir}/dictionary.json`, serialized.dictionary);
  for (const [docKey, json] of serialized.documents) {
    const path = `${catalogueDir}/documents/${docKey}.json`;
    await fs.mkdir(path.slice(0, path.lastIndexOf("/")));
    await fs.writeFile(path, json);
  }
};
