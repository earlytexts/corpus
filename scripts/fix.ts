/**
 * Apply the Markit formatter to every .mit file in place.
 * Run with: npm run fix
 */

import { format } from "@earlytexts/markit";
import { nodeCorpusFs } from "../src/fs.ts";
import { corpusRoot } from "./lib.ts";

let changed = 0;
let total = 0;

const walk = async (dir: string): Promise<void> => {
  for (const entry of await nodeCorpusFs.readDir(dir)) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory) await walk(path);
    else if (entry.name.endsWith(".mit")) {
      total++;
      const text = await nodeCorpusFs.readFile(path);
      if (text === null) continue;
      const formatted = format(text);
      if (formatted !== text) {
        await nodeCorpusFs.writeFile(path, formatted);
        changed++;
      }
    }
  }
};

await walk(`${corpusRoot}/data/authors`);
await walk(`${corpusRoot}/data/works`);
console.log(`formatted ${changed} of ${total} files`);
