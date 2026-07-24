/**
 * The one-click equivalent of the corpus's `deno task fmt`: apply the Markit
 * formatter to every `.mit` file under `data/`, in place. Pure over the corpus
 * filesystem port — it walks, formats, and rewrites the changed files, then
 * reports the tally. The editor layer (commands/fixFormatting.ts) wraps this in
 * a progress notification and surfaces the count; the watcher revalidates once
 * the writes land.
 */

import { format } from "@jsr/earlytexts__markit";
import type { CorpusFsWrite } from "@earlytexts/corpus";

/** How the format sweep went: how many files were rewritten, of how many seen. */
export type FormatTally = { changed: number; total: number };

/** Format every `.mit` under `data/authors` and `data/works` in place, writing
 * back only the files the formatter actually changed. */
export const formatCorpus = async (
  fs: CorpusFsWrite,
  root: string,
): Promise<FormatTally> => {
  let changed = 0;
  let total = 0;
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await fs.readDir(dir)) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory) {
        await walk(path);
      } else if (entry.name.endsWith(".mit")) {
        total++;
        const text = await fs.readFile(path);
        if (text === null) continue;
        const formatted = format(text);
        if (formatted !== text) {
          await fs.writeFile(path, formatted);
          changed++;
        }
      }
    }
  };
  await walk(`${root}/data/authors`);
  await walk(`${root}/data/works`);
  return { changed, total };
};
