/**
 * Apply the Markit formatter to every .mit file. The `.mit` half of the corpus's
 * `fmt` / `fmt:check` tasks (`deno fmt` covers the TypeScript). Pass `--check` to
 * report files that are not canonically formatted and exit non-zero without
 * writing; otherwise rewrite them in place.
 *
 * Run with: deno task fmt (or deno task fmt:check).
 */

import { format } from "@earlytexts/markit";
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

if (check) {
  if (unformatted.length > 0) {
    console.error(
      `${unformatted.length} of ${total} .mit files are not formatted:`,
    );
    for (const path of unformatted) console.error(`  ${path}`);
    Deno.exit(1);
  }
  console.log(`checked ${total} .mit files: all formatted`);
} else {
  console.log(`formatted ${changed} of ${total} files`);
}
