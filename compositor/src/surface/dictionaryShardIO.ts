/**
 * Reading and writing a single dictionary shard file through the vscode
 * filesystem — the read-modify-write primitive shared by the two dictionary
 * write paths (the editor quick-fixes in commands/dictionaryDiagnostics.ts and
 * the panel in dictionaryPanel.ts). The *what* to write is the corpus's
 * canonicalising `upsert*`/`remove*` (lib/dictionaryEdits.ts); this is only the
 * I/O around it. A missing shard reads as "" (a fresh one is written on demand).
 *
 * Every write goes through `updateShard`/`updateShards`, which funnel the whole
 * read-modify-write through one FIFO serializer (lib/serialize.ts). Without it a
 * second edit's read can land inside a first edit's (truncating) write and see
 * an empty file, so the second write would clobber the shard down to its own
 * lone entry. `readShardText`/`writeShardText` stay unserialized so the update
 * helpers can call them from inside the critical section without deadlocking.
 */

import * as vscode from "vscode";
import { serial } from "../lib/serialize.ts";

/** The one queue every shard write runs through (see the module note). */
const runExclusive = serial();

/**
 * Atomically rewrite one shard: read its current text, hand it to `transform`,
 * and write the result back — the whole sequence serialized against every other
 * shard write. `transform` may throw (a validation rejection) or return a
 * promise; on a throw nothing is written and the rejection propagates to the
 * caller, leaving the queue free for the next edit.
 */
export const updateShard = (
  root: string,
  shard: string,
  transform: (current: string) => string | Promise<string>,
): Promise<void> =>
  runExclusive(async () => {
    const next = await transform(await readShardText(root, shard));
    await writeShardText(root, shard, next);
  });

/**
 * Run a multi-shard read-modify-write (the quick-fix cascade, which validates
 * every shard's new text before writing any) as one exclusive unit against
 * other edits. `op` uses `readShardText`/`writeShardText` directly — it is
 * already inside the critical section, so it must not call `updateShard*`.
 */
export const updateShards = (op: () => Promise<void>): Promise<void> =>
  runExclusive(op);

/** The absolute uri of a dictionary shard under a corpus root. */
export const shardUri = (root: string, shard: string): vscode.Uri =>
  vscode.Uri.file(`${root}/data/dictionary/${shard}`);

/** A shard's current text, or "" when it does not exist yet. */
export const readShardText = async (
  root: string,
  shard: string,
): Promise<string> => {
  try {
    return new TextDecoder().decode(
      await vscode.workspace.fs.readFile(shardUri(root, shard)),
    );
  } catch {
    return "";
  }
};

/** Overwrite a shard with new canonical text. */
export const writeShardText = async (
  root: string,
  shard: string,
  text: string,
): Promise<void> => {
  await vscode.workspace.fs.writeFile(
    shardUri(root, shard),
    new TextEncoder().encode(text),
  );
};
