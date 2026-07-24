/**
 * The pure patches behind the panel's optimistic updates (dictionaryPanelData.ts):
 * swapping one shard's entries into a cached dictionary, and dropping the
 * curation rows a written entry accounts for. Both must match what a full
 * re-read/re-rank would produce for the surfaces they touch, and leave
 * everything else alone.
 */

import { expect, test } from "vitest";
import { parseDictionary, type RawDictionary } from "@earlytexts/corpus";
import {
  dropCuratedRows,
  replaceShardEntries,
} from "../src/lib/dictionaryPanelData.ts";
import type { CurationRow } from "../src/lib/curation.ts";

const dictOf = (shards: Record<string, string>): RawDictionary => {
  const { dictionary, problems } = parseDictionary(
    new Map(Object.entries(shards)),
  );
  expect(problems).toEqual([]);
  return dictionary;
};

test("replaceShardEntries swaps one shard and leaves the others", () => {
  const current = dictOf({
    "a.json": '{\n  "abandon": null\n}\n',
    "b.json": '{\n  "bishop": null\n}\n',
  });
  // The b shard was rewritten to add "bench"; a was not touched.
  const rewritten = dictOf({
    "b.json": '{\n  "bench": null,\n  "bishop": null\n}\n',
  });
  const next = replaceShardEntries(current, "b.json", rewritten);
  expect(Object.keys(next).sort()).toEqual(["abandon", "bench", "bishop"]);
  // A fresh object — the input is not mutated.
  expect(Object.keys(current).sort()).toEqual(["abandon", "bishop"]);
});

test("replaceShardEntries drops entries removed from the rewritten shard", () => {
  const current = dictOf({
    "b.json": '{\n  "bench": null,\n  "bishop": null\n}\n',
  });
  const rewritten = dictOf({ "b.json": '{\n  "bishop": null\n}\n' });
  const next = replaceShardEntries(current, "b.json", rewritten);
  expect(Object.keys(next)).toEqual(["bishop"]);
});

test("replaceShardEntries populates a shard that was empty", () => {
  const current = dictOf({ "a.json": '{\n  "abandon": null\n}\n' });
  const rewritten = dictOf({ "b.json": '{\n  "bishop": null\n}\n' });
  const next = replaceShardEntries(current, "b.json", rewritten);
  expect(Object.keys(next).sort()).toEqual(["abandon", "bishop"]);
});

const row = (surface: string): CurationRow => ({
  surface,
  count: 1,
  letter: surface[0],
});

test("dropCuratedRows removes exactly the written surfaces", () => {
  const rows = [row("virtue"), row("bishop"), row("cat")];
  expect(dropCuratedRows(rows, new Set(["bishop"]))).toEqual([
    row("virtue"),
    row("cat"),
  ]);
});

test("dropCuratedRows is exact — a possessive base does not drop its possessive", () => {
  const rows = [row("bishop's")];
  // Registering "bishop" accounts for "bishop's" too, but that settles on the
  // reload's re-rank; the optimistic drop only removes what was written.
  expect(dropCuratedRows(rows, new Set(["bishop"]))).toEqual([row("bishop's")]);
});
