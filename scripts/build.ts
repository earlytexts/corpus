/**
 * Build the compiled catalogue the computer consumes: scan and compile the
 * corpus, compose borrowed children, and write the result to `catalogue/` (see
 * src/build/write.ts for the layout). Run with: npm run build. The output is
 * gitignored; the computer reads it via CORPUS_DIR (dev), and in prod builds
 * it under Deno via its own wrapper (computer/scripts/build-corpus.ts), which
 * reuses these same runtime-neutral build functions.
 *
 * Alongside `catalogue/` it emits `catalogue/derivations.json` — the per-source
 * reductions the Compositor seeds from at cold start (build/derivations.ts).
 * The corpus is compiled once (loadCorpus) and those documents are handed to
 * the catalogue build, so the extra output costs one derivation/projection walk
 * per file, not a second compile. The computer ignores the derivations file.
 */

import { buildCatalogue } from "../src/catalogue/compile.ts";
import { writeCatalogue } from "../src/build/write.ts";
import {
  type DerivationRecord,
  derivationRecord,
  writeDerivations,
} from "../src/build/derivations.ts";
import { loadCorpus } from "../src/validation/rules.ts";
import { nodeCorpusFs } from "../src/build/node.ts";
import { normalizePath } from "../src/fs/paths.ts";
import { corpusRoot } from "./lib.ts";

const t0 = performance.now();
const files = await loadCorpus(nodeCorpusFs, corpusRoot);
// Hand the compiled documents to the catalogue build (keyed as buildCatalogue
// looks them up: normalised absolute paths), so it reuses them rather than
// compiling every file a second time.
const precompiled = new Map(
  files.map((f) => [normalizePath(`${corpusRoot}/data/${f.path}`), f.doc]),
);
const { catalogue, warnings } = await buildCatalogue(
  nodeCorpusFs,
  corpusRoot,
  precompiled,
);
const { catalogue: written, documents } = await writeCatalogue(
  nodeCorpusFs,
  corpusRoot,
  catalogue,
  warnings,
);
const records = await Promise.all(
  files.map(
    async (f): Promise<[string, DerivationRecord]> => [
      f.path,
      await derivationRecord(f, { fs: nodeCorpusFs, root: corpusRoot }),
    ],
  ),
);
await writeDerivations(nodeCorpusFs, corpusRoot, records);

const elapsed = Math.round(performance.now() - t0);
const authors = written.authors.length;
const works = Object.keys(written.works).length;
const editions = documents.size;
const entries = Object.keys(catalogue.dictionary).length;
console.log(
  `Built catalogue from ${corpusRoot} to ${corpusRoot}/catalogue in ${elapsed}ms\n` +
    `  ${authors} authors, ${works} works, ${editions} editions, ` +
    `${entries} dictionary entries, ${records.length} derivations`,
);
if (warnings.length > 0) {
  console.warn(`${warnings.length} corpus warnings:`);
  for (const warning of warnings) console.warn(`  - ${warning}`);
}
