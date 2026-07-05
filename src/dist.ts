/**
 * Write the compiled catalogue to `dist/` — the corpus's build output, read by
 * the computer (via CORPUS_DIR) and used by the Compositor as a startup cache:
 *
 *   dist/catalogue.json              the structure + metadata (+ warnings)
 *   dist/documents/<docKey>.json     one (uncomposed) document per edition
 *
 * Runtime-neutral: the Deno build script (../scripts/build.ts) and the Node
 * Compositor both call this with a `CorpusFsWrite` binding. `dist/` is
 * replaced wholesale so a stale document file can never linger.
 */

import type { Catalogue, CatalogueFile, CorpusFsWrite } from "./types.ts";
import { serializeCatalogue } from "./serialize.ts";

export const writeDist = async (
  fs: CorpusFsWrite,
  root: string,
  catalogue: Catalogue,
  warnings: string[],
): Promise<{ catalogue: CatalogueFile; documents: Map<string, string> }> => {
  const real = await fs.realPath(root);
  const serialized = serializeCatalogue(catalogue, warnings, real);
  const distDir = `${real}/dist`;
  await fs.remove(distDir);
  await fs.mkdir(`${distDir}/documents`);
  await fs.writeFile(
    `${distDir}/catalogue.json`,
    JSON.stringify(serialized.catalogue),
  );
  for (const [docKey, json] of serialized.documents) {
    const path = `${distDir}/documents/${docKey}.json`;
    await fs.mkdir(path.slice(0, path.lastIndexOf("/")));
    await fs.writeFile(path, json);
  }
  return serialized;
};
