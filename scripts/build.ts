/**
 * Build the compiled catalogue the computer consumes: scan and compile the
 * corpus, compose borrowed children, and write the result to `catalogue/` (see
 * src/catalogue/write.ts for the layout). Run with: npm run build. The output is
 * gitignored; the computer reads it via CORPUS_DIR (dev), and in prod builds
 * it under Deno via its own wrapper (computer/scripts/build-corpus.ts), which
 * reuses these same runtime-neutral build functions.
 */

import { buildCatalogue } from "../src/catalogue/compile.ts";
import { writeCatalogue } from "../src/catalogue/write.ts";
import { nodeCorpusFs } from "../src/fs.ts";
import { corpusRoot } from "./lib.ts";

const t0 = performance.now();
const { catalogue, warnings } = await buildCatalogue(nodeCorpusFs, corpusRoot);
const { catalogue: written, documents } = await writeCatalogue(
  nodeCorpusFs,
  corpusRoot,
  catalogue,
  warnings,
);

const elapsed = Math.round(performance.now() - t0);
const authors = written.authors.length;
const works = Object.keys(written.works).length;
const editions = documents.size;
const entries = Object.keys(catalogue.dictionary).length;
console.log(
  `Built catalogue from ${corpusRoot} to ${corpusRoot}/catalogue in ${elapsed}ms\n` +
    `  ${authors} authors, ${works} works, ${editions} editions, ` +
    `${entries} dictionary entries`,
);
if (warnings.length > 0) {
  console.warn(`${warnings.length} corpus warnings:`);
  for (const warning of warnings) console.warn(`  - ${warning}`);
}
