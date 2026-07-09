/**
 * Canonicalise the corpus data: apply the Markit formatter to every .mit
 * file, and rewrite the dictionary shards (`data/dictionary/*.json`) in
 * canonical form — keys sorted, each in its right shard, minimal values, one
 * entry per line. This is the data half of the corpus's `fmt` / `fmt:check`
 * tasks (`deno fmt` covers the TypeScript). Pass `--check` to report files
 * that are not canonical and exit non-zero without writing; otherwise rewrite
 * them in place.
 *
 * Run with: deno task fmt (or deno task fmt:check).
 */

import { format } from "@earlytexts/markit";
import {
  parseDictionary,
  readDictionaryShards,
  shardDictionary,
} from "../src/dictionary.ts";
import { nodeCorpusFs } from "../src/fs.ts";
import { corpusRoot } from "./lib.ts";

const check = Deno.args.includes("--check");

let changed = 0;
let total = 0;
const unformatted: string[] = [];

const walk = async (dir: string): Promise<void> => {
  for (const entry of await nodeCorpusFs.readDir(dir)) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory) await walk(path);
    else if (entry.name.endsWith(".mit")) {
      total++;
      const text = await nodeCorpusFs.readFile(path);
      if (text === null) continue;
      const formatted = format(text);
      if (formatted === text) continue;
      changed++;
      if (check) unformatted.push(path);
      else await nodeCorpusFs.writeFile(path, formatted);
    }
  }
};

await walk(`${corpusRoot}/data/authors`);
await walk(`${corpusRoot}/data/works`);

// The dictionary shards. Entries that fail to parse cannot be rewritten
// without losing them, so they must be fixed by hand first; everything else
// (placement, ordering, whitespace, non-minimal values) canonicalises.
const shards = await readDictionaryShards(nodeCorpusFs, corpusRoot);
const { dictionary, problems } = parseDictionary(shards);
const dropped = problems.filter((problem) => problem.dropped);
if (dropped.length > 0) {
  console.error("cannot format data/dictionary (fix these first):");
  for (const problem of dropped) {
    console.error(
      `  ${problem.shard}` +
        `${problem.key !== undefined ? ` "${problem.key}"` : ""}: ` +
        problem.message,
    );
  }
  Deno.exit(1);
}
const canonical = shardDictionary(dictionary);
for (
  const name of [...new Set([...shards.keys(), ...canonical.keys()])].sort()
) {
  total++;
  const want = canonical.get(name);
  if (want === shards.get(name)) continue;
  changed++;
  const path = `${corpusRoot}/data/dictionary/${name}`;
  if (check) unformatted.push(path);
  else if (want === undefined) await nodeCorpusFs.remove(path);
  else await nodeCorpusFs.writeFile(path, want);
}

if (check) {
  if (unformatted.length > 0) {
    console.error(
      `${unformatted.length} of ${total} data files are not formatted:`,
    );
    for (const path of unformatted) console.error(`  ${path}`);
    Deno.exit(1);
  }
  console.log(`checked ${total} data files: all formatted`);
} else {
  console.log(`formatted ${changed} of ${total} files`);
}
