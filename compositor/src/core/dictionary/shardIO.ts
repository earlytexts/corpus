/**
 * Reading and writing a single dictionary shard file through the corpus
 * filesystem port — the read-modify-write primitive shared by the two
 * dictionary write paths (the editor quick-fixes in
 * adapters/vscode/commands/dictionaryDiagnostics.ts and the panel in
 * adapters/vscode/dictionaryPanel.ts). The *what* to write is the corpus's
 * canonicalising `upsert*`/`remove*` (dictionary/edits.ts); this is only the
 * I/O around it. A missing shard reads as "" (a fresh one is written on
 * demand).
 *
 * Every write goes through `updateShard`/`updateShards`, which funnel the
 * whole read-modify-write through one FIFO serializer (serialize.ts). Without
 * it a second edit's read can land inside a first edit's (truncating) write
 * and see an empty file, so the second write would clobber the shard down to
 * its own lone entry. `readShardText`/`writeShardText` stay unserialized so
 * the update helpers can call them from inside the critical section without
 * deadlocking.
 *
 * The disk is reached only through the injected `CorpusFsWrite` (production:
 * `nodeCorpusFs`; tests: an in-memory fake), so the whole primitive is
 * editor-free and testable.
 */

import type { CorpusFsWrite } from "@earlytexts/corpus";
import { serial } from "../shared/serialize.ts";

/** The one queue every shard write runs through (see the module note). */
const runExclusive = serial();

/** The absolute path of a dictionary shard under a corpus root. */
export const shardPath = (root: string, shard: string): string =>
  `${root}/data/dictionary/${shard}`;

/**
 * Atomically rewrite one shard: read its current text, hand it to `transform`,
 * and write the result back — the whole sequence serialized against every other
 * shard write. `transform` may throw (a validation rejection) or return a
 * promise; on a throw nothing is written and the rejection propagates to the
 * caller, leaving the queue free for the next edit.
 */
export const updateShard = (
  fs: CorpusFsWrite,
  root: string,
  shard: string,
  transform: (current: string) => string | Promise<string>,
): Promise<void> =>
  runExclusive(async () => {
    const next = await transform(await readShardText(fs, root, shard));
    await writeShardText(fs, root, shard, next);
  });

/**
 * Run a multi-shard read-modify-write (the quick-fix cascade, which validates
 * every shard's new text before writing any) as one exclusive unit against
 * other edits. `op` uses `readShardText`/`writeShardText` directly — it is
 * already inside the critical section, so it must not call `updateShard*`.
 */
export const updateShards = (op: () => Promise<void>): Promise<void> =>
  runExclusive(op);

/** A shard's current text, or "" when it does not exist yet. */
export const readShardText = async (
  fs: CorpusFsWrite,
  root: string,
  shard: string,
): Promise<string> => (await fs.readFile(shardPath(root, shard))) ?? "";

/** Overwrite a shard with new canonical text. */
export const writeShardText = (
  fs: CorpusFsWrite,
  root: string,
  shard: string,
  text: string,
): Promise<void> => fs.writeFile(shardPath(root, shard), text);
