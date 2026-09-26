/**
 * Build the compiled catalogue the computer consumes: scan and compile the
 * corpus, compose borrowed children, and write the result to `catalogue/` (see
 * src/build/write.ts for the layout). Run with: deno task build. The output is
 * gitignored; the computer reads it via CORPUS_DIR, and in prod builds it by
 * running this same task in its corpus checkout (computer/scripts/
 * build-corpus.ts).
 *
 * The catalogue only — no validation, no source positions, no Compositor
 * derivations (the Compositor builds and owns its own cache) — so the build
 * compiles each file once, plainly, and stays well inside a small build
 * machine's memory.
 */

import { buildCatalogue } from "../src/catalogue/compile.ts";
import { writeCatalogue } from "../src/build/write.ts";
import { nodeCorpusFs } from "../src/build/node.ts";
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
