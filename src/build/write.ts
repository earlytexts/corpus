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

import type { MarkitDocument } from "@earlytexts/markit";
import type { Catalogue, CatalogueFile } from "../catalogue/types.ts";
import type { CorpusFsWrite } from "../fs/ports.ts";
import {
  serializeCatalogue,
  serializeSourceDoc,
  sourceDocKeys,
} from "../catalogue/serialize.ts";

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
 * for the given changed edition sources — the incremental write behind a save,
 * so a save no longer serialises and rewrites all ~1300 documents (the memory
 * spike that ran the extension host out of memory).
 *
 * `changed` maps each touched source `.mit` (root-relative, e.g.
 * `data/works/hume/enquiry/1748.mit`) to its freshly compiled **standalone**
 * document — the edition's own file, with borrowed children still `## <ref>`
 * placeholders. The Compositor holds a *body-free* catalogue (every edition's
 * `document` is a block-empty stub), so it cannot serialise the bodies off the
 * catalogue; it hands the recompiled standalone docs here, and
 * `serializeSourceDoc` turns them into the same wire form the full build writes
 * (placeholder children resolved to `{ __ref }`). A source with no edition
 * docKey (an author file, a work stub) writes no document.
 *
 * `removedDocKeys` are editions whose source was deleted this save: their
 * `documents/<docKey>.json` is removed, so a delete no longer forces a full
 * `writeCatalogue`. Like `writeCatalogueDictionary`, this is only sound over a
 * `catalogue/` whose *other* documents are already current — the caller owns
 * that (see the Compositor's corpusModel).
 */
export const writeCatalogueSources = async (
  fs: CorpusFsWrite,
  root: string,
  catalogue: Catalogue,
  warnings: string[],
  changed: ReadonlyMap<string, MarkitDocument>,
  removedDocKeys: ReadonlySet<string> = new Set(),
): Promise<void> => {
  const real = await fs.realPath(root);
  // catalogue.json + dictionary.json refresh every save (the structure,
  // warnings, and dictionary are all body-free); the documents do not (that is
  // the whole point), so `false` emits none of them here.
  const serialized = serializeCatalogue(catalogue, warnings, real, false);
  const catalogueDir = `${real}/catalogue`;
  await fs.writeFile(
    `${catalogueDir}/catalogue.json`,
    JSON.stringify(serialized.catalogue),
  );
  await fs.writeFile(`${catalogueDir}/dictionary.json`, serialized.dictionary);

  const bySource = sourceDocKeys(catalogue, real);
  for (const [source, doc] of changed) {
    const docKey = bySource.get(source);
    if (docKey === undefined) continue; // not an edition (author file / stub)
    const path = `${catalogueDir}/documents/${docKey}.json`;
    await fs.mkdir(path.slice(0, path.lastIndexOf("/")));
    await fs.writeFile(
      path,
      JSON.stringify(await serializeSourceDoc(fs, real, bySource, doc)),
    );
  }
  for (const docKey of removedDocKeys) {
    await fs.remove(`${catalogueDir}/documents/${docKey}.json`);
  }
};
