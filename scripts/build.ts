/**
 * Build the compiled catalogue the computer consumes. Scans and compiles the
 * corpus, composes borrowed children, and writes the result to `dist/`:
 *
 *   dist/catalogue.json              the structure + metadata (+ warnings)
 *   dist/documents/<docKey>.json     one (uncomposed) document per edition
 *
 * Run with: deno task build. The output is gitignored; the computer reads it
 * via CORPUS_DIR (dev) or after running this build (prod).
 */

import { buildCatalog } from "../src/catalogue.ts";
import { serializeCatalogue } from "../src/serialize.ts";
import { denoCorpusFs } from "../src/fs.ts";
import { corpusRoot } from "./lib.ts";

const distDir = `${corpusRoot}/dist`;

const t0 = performance.now();
const root = await Deno.realPath(corpusRoot);
const { catalog, warnings } = await buildCatalog(denoCorpusFs, corpusRoot);
const { catalogue, documents } = serializeCatalogue(catalog, warnings, root);

// Replace dist/ wholesale so a stale document file can never linger.
await Deno.remove(distDir, { recursive: true }).catch(() => {});
await Deno.mkdir(`${distDir}/documents`, { recursive: true });
await Deno.writeTextFile(
  `${distDir}/catalogue.json`,
  JSON.stringify(catalogue),
);
for (const [docKey, json] of documents) {
  const path = `${distDir}/documents/${docKey}.json`;
  await Deno.mkdir(path.slice(0, path.lastIndexOf("/")), { recursive: true });
  await Deno.writeTextFile(path, json);
}

const elapsed = Math.round(performance.now() - t0);
const authors = catalogue.authors.length;
const works = Object.keys(catalogue.works).length;
const editions = documents.size;
console.log(
  `Built catalogue from ${corpusRoot} to ${distDir} in ${elapsed}ms\n` +
    `  ${authors} authors, ${works} works, ${editions} editions`,
);
if (warnings.length > 0) {
  console.warn(`${warnings.length} corpus warnings:`);
  for (const warning of warnings) console.warn(`  - ${warning}`);
}
