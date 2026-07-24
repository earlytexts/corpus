/**
 * The read-modify-write primitive over one dictionary shard file: the path, the
 * "missing shard reads as ''" read, the overwrite, and the two serialized update
 * helpers. These cases pin the I/O and, above all, the FIFO serializer — two
 * concurrent edits must never interleave, so a second edit's read never lands
 * inside a first edit's truncating write and clobbers the shard.
 */

import { expect, test } from "vitest";
import {
  readShardText,
  shardPath,
  updateShard,
  updateShards,
  writeShardText,
} from "../src/core/dictionaryShardIO.ts";
import { writableCorpus } from "./writableCorpus.ts";

const root = "/corpus";

test("shardPath is the shard file under the corpus's dictionary directory", () => {
  expect(shardPath(root, "a.json")).toBe("/corpus/data/dictionary/a.json");
});

test("readShardText reads a shard's current text", async () => {
  const fs = writableCorpus({
    "/corpus/data/dictionary/a.json": '{\n  "abandon": null\n}\n',
  });
  expect(await readShardText(fs, root, "a.json")).toBe(
    '{\n  "abandon": null\n}\n',
  );
});

test("readShardText reads a missing shard as the empty string", async () => {
  const fs = writableCorpus({});
  expect(await readShardText(fs, root, "z.json")).toBe("");
});

test("writeShardText overwrites the shard, readable back at its path", async () => {
  const fs = writableCorpus({});
  await writeShardText(fs, root, "b.json", '{\n  "bishop": null\n}\n');
  expect(await readShardText(fs, root, "b.json")).toBe(
    '{\n  "bishop": null\n}\n',
  );
});

test("updateShard reads, transforms, and writes the result back", async () => {
  const fs = writableCorpus({ "/corpus/data/dictionary/a.json": "seed" });
  await updateShard(fs, root, "a.json", (current) => `${current}+more`);
  expect(await readShardText(fs, root, "a.json")).toBe("seed+more");
});

test("updateShard transforms a missing shard from the empty string", async () => {
  const fs = writableCorpus({});
  await updateShard(fs, root, "a.json", (current) => `[${current}]`);
  expect(await readShardText(fs, root, "a.json")).toBe("[]");
});

test("a thrown transform writes nothing and frees the queue for the next edit", async () => {
  const fs = writableCorpus({});
  await expect(
    updateShard(fs, root, "a.json", () => {
      throw new Error("rejected");
    }),
  ).rejects.toThrow("rejected");
  expect(await readShardText(fs, root, "a.json")).toBe("");
  // The rejection did not stall the serializer: the next edit still runs.
  await updateShard(fs, root, "a.json", (current) => `${current}ok`);
  expect(await readShardText(fs, root, "a.json")).toBe("ok");
});

test("updateShards runs a multi-shard op through readShardText/writeShardText", async () => {
  const fs = writableCorpus({ "/corpus/data/dictionary/a.json": "A" });
  await updateShards(async () => {
    const a = await readShardText(fs, root, "a.json");
    await writeShardText(fs, root, "a.json", `${a}!`);
    await writeShardText(fs, root, "b.json", "B");
  });
  expect(await readShardText(fs, root, "a.json")).toBe("A!");
  expect(await readShardText(fs, root, "b.json")).toBe("B");
});

test("concurrent updateShards run one at a time, in call order", async () => {
  const log: string[] = [];
  const op = (id: string) => async () => {
    log.push(`${id}:start`);
    await Promise.resolve();
    await Promise.resolve();
    log.push(`${id}:end`);
  };
  await Promise.all([updateShards(op("a")), updateShards(op("b"))]);
  // Serialized: b never starts until a has fully settled (no interleaving).
  expect(log).toEqual(["a:start", "a:end", "b:start", "b:end"]);
});

test("concurrent updateShard on one shard serialize, so neither clobbers the other", async () => {
  const fs = writableCorpus({});
  const append = (letter: string) => async (current: string) => {
    await Promise.resolve(); // widen the read-modify-write window
    return current + letter;
  };
  await Promise.all([
    updateShard(fs, root, "a.json", append("A")),
    updateShard(fs, root, "a.json", append("B")),
  ]);
  // Unserialized, the second read would land on "" and write only "B".
  expect(await readShardText(fs, root, "a.json")).toBe("AB");
});
