/**
 * Apply the Markit formatter to every .mit file in place.
 * Run with: deno task fix
 */

import { format } from "@earlytexts/markit";
import { corpusRoot } from "../tests/lib.ts";

let changed = 0;
let total = 0;

const walk = async (dir: string): Promise<void> => {
  for await (const entry of Deno.readDir(dir)) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory) await walk(path);
    else if (entry.name.endsWith(".mit")) {
      total++;
      const text = await Deno.readTextFile(path);
      const formatted = format(text);
      if (formatted !== text) {
        await Deno.writeTextFile(path, formatted);
        changed++;
      }
    }
  }
};

await walk(`${corpusRoot}/authors`);
await walk(`${corpusRoot}/works`);
console.log(`formatted ${changed} of ${total} files`);
