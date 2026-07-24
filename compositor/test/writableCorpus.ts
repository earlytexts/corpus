/**
 * A writable in-memory `CorpusFsWrite` over a mutable path→text map. The read
 * half is the corpus harness's `memoryCorpus` (closing over the *same* map, so a
 * write is immediately visible to a read); the write half mutates the map. The
 * harness only publishes the read-only `memoryCorpus`, so the model and
 * shard-IO cores — which write back to `catalogue/` and `data/dictionary/` —
 * need this. It mirrors the corpus's own `writableCorpus` test helper.
 * `mkdir` is a no-op: directories are implied by the keys.
 */

import type { CorpusFsWrite } from "@earlytexts/corpus";
import { normalizePath } from "@earlytexts/corpus";
import { memoryCorpus } from "@earlytexts/corpus/test";

export const writableCorpus = (
  files: Record<string, string>,
): CorpusFsWrite => ({
  ...memoryCorpus(files),
  writeFile: (path, text) => {
    files[normalizePath(path)] = text;
    return Promise.resolve();
  },
  mkdir: () => Promise.resolve(),
  remove: (path) => {
    const prefix = normalizePath(path);
    for (const key of Object.keys(files)) {
      if (key === prefix || key.startsWith(`${prefix}/`)) delete files[key];
    }
    return Promise.resolve();
  },
});
