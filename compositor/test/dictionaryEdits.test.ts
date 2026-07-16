/**
 * The dictionary quick-fix core: placing a curation decision into a shard's
 * canonical text. The corpus owns the format and validation, so these cases
 * check the placement round-trips — sorted, minimal, and byte-identical to what
 * the corpus's own fmt would write.
 */

import { expect, test } from "vitest";
import {
  actionsFor,
  upsertEntriesText,
  upsertEntryText,
} from "../src/lib/dictionaryEdits.ts";

test("adds a modern word to an existing shard, keeping keys sorted", () => {
  const before = '{\n  "apple": null\n}\n';
  expect(upsertEntryText(before, "and", null)).toBe(
    '{\n  "and": null,\n  "apple": null\n}\n',
  );
});

test("seeds a new (empty) shard", () => {
  expect(upsertEntryText("", "wombat", null)).toBe('{\n  "wombat": null\n}\n');
  expect(upsertEntryText("{}", "wombat", null)).toBe(
    '{\n  "wombat": null\n}\n',
  );
});

test("adds a respelling as a cross-reference", () => {
  expect(upsertEntryText("", "vertue", "virtue")).toBe(
    '{\n  "vertue": "virtue"\n}\n',
  );
});

test("adds a modern word with a stated lemma", () => {
  expect(upsertEntryText("", "increases", "=increase")).toBe(
    '{\n  "increases": "=increase"\n}\n',
  );
});

test("replaces an existing entry rather than duplicating it", () => {
  const before = '{\n  "lay": null\n}\n';
  expect(upsertEntryText(before, "lay", [null, "=lie"])).toBe(
    '{\n  "lay": [null, "=lie"]\n}\n',
  );
});

test("rejects a malformed value", () => {
  expect(() => upsertEntryText("", "x", "=a!b")).toThrow();
});

test("adds several entries to one shard at once, keeping keys sorted", () => {
  // A cascade resolves a target alongside the surface that referenced it; both
  // land in the same shard write.
  expect(
    upsertEntriesText("", [
      { surface: "vertue", value: "virtue" },
      { surface: "virtue", value: null },
    ]),
  ).toBe('{\n  "vertue": "virtue",\n  "virtue": null\n}\n');
});

test("upsertEntriesText rolls back nothing — a malformed value throws", () => {
  expect(() =>
    upsertEntriesText("", [{ surface: "x", value: "=a!b" }]),
  ).toThrow();
});

test("offers the add actions for an unknown surface", () => {
  expect(actionsFor().map((a) => a.kind)).toEqual([
    "modern",
    "respell",
    "lemma",
  ]);
});
