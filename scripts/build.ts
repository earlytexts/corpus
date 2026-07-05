/**
 * Build the compiled catalogue the computer consumes: scan and compile the
 * corpus, compose borrowed children, and write the result to `dist/` (see
 * src/dist.ts for the layout). Run with: deno task build. The output is
 * gitignored; the computer reads it via CORPUS_DIR (dev) or after running
 * this build (prod).
 */

import { buildCatalogue } from "../src/catalogue.ts";
import { writeDist } from "../src/dist.ts";
import { nodeCorpusFs } from "../src/fs.ts";
import { corpusRoot } from "./lib.ts";

const t0 = performance.now();
const { catalogue, warnings } = await buildCatalogue(nodeCorpusFs, corpusRoot);
const { catalogue: written, documents } = await writeDist(
  nodeCorpusFs,
  corpusRoot,
  catalogue,
  warnings,
);

const elapsed = Math.round(performance.now() - t0);
const authors = written.authors.length;
const works = Object.keys(written.works).length;
const editions = documents.size;
console.log(
  `Built catalogue from ${corpusRoot} to ${corpusRoot}/dist in ${elapsed}ms\n` +
    `  ${authors} authors, ${works} works, ${editions} editions`,
);
if (warnings.length > 0) {
  console.warn(`${warnings.length} corpus warnings:`);
  for (const warning of warnings) console.warn(`  - ${warning}`);
}
