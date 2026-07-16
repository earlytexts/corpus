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
import { serializeCatalogue } from "../catalogue/serialize.ts";

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
