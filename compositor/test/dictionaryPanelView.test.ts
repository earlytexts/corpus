/**
 * The dictionary panel's view-model: building the full cache (parse + rank),
 * patching it for an optimistic edit (swap a shard's entries, drop the accounted
 * curation rows without a corpus-wide re-rank), and shaping both into the `data`
 * message the webview renders — plus the empty states before a corpus is loaded.
 */

import { expect, test } from "vitest";
import {
  buildCache,
  dataMessage,
  emptyMessage,
  MAX_CURATION,
  patchCache,
} from "../src/core/dictionaryPanelView.ts";
import type { TokenIndex } from "../src/core/curation.ts";

/** One a-shard entry plus a backlog: "abandon" is registered (accounted), the
 * other two are not, ranked most-frequent-first. */
const shards = () => new Map([["a.json", '{\n  "abandon": null\n}\n']]);

const tokenIndex = (): TokenIndex =>
  new Map([
    ["abandon", { count: 10 }],
    ["wombat", { count: 5 }],
    ["zebra", { count: 3 }],
  ]);

test("MAX_CURATION caps the posted backlog", () => {
  expect(MAX_CURATION).toBe(2000);
});

test("buildCache parses the shards and ranks the unaccounted backlog", () => {
  const cache = buildCache(shards(), tokenIndex());
  expect(Object.keys(cache.dictionary)).toEqual(["abandon"]);
  expect(cache.curation.map((r) => r.surface)).toEqual(["wombat", "zebra"]);
  expect(cache.curationTotal).toBe(2);
});

test("buildCache truncates the backlog to max but reports the true total", () => {
  const cache = buildCache(shards(), tokenIndex(), 1);
  expect(cache.curation.map((r) => r.surface)).toEqual(["wombat"]);
  expect(cache.curationTotal).toBe(2);
});

test("dataMessage derives both views and tags readiness and staleness", () => {
  const cache = buildCache(shards(), tokenIndex());
  expect(dataMessage(cache, { curationReady: true, stale: false })).toEqual({
    type: "data",
    status: "ready",
    variants: [],
    lemmas: [{ lemma: "abandon", headword: true, forms: [], letter: "a" }],
    curation: cache.curation,
    curationTotal: 2,
    curationReady: true,
    stale: false,
  });
});

test("dataMessage carries the stale flag through", () => {
  const cache = buildCache(shards(), tokenIndex());
  expect(dataMessage(cache, { curationReady: false, stale: true }).stale).toBe(
    true,
  );
});

test("patchCache swaps a written shard's entries and drops the accounted rows", () => {
  const cache = buildCache(shards(), tokenIndex());
  const patched = patchCache(
    cache,
    new Map([["w.json", '{\n  "wombat": null\n}\n']]),
    ["wombat"],
  );
  expect(Object.keys(patched.dictionary).sort()).toEqual(["abandon", "wombat"]);
  expect(patched.curation.map((r) => r.surface)).toEqual(["zebra"]);
  expect(patched.curationTotal).toBe(2);
  // The caller's cache is left untouched — a fresh cache is returned.
  expect(Object.keys(cache.dictionary)).toEqual(["abandon"]);
  expect(cache.curation.map((r) => r.surface)).toEqual(["wombat", "zebra"]);
});

test("patchCache reads a blank shard text as an empty shard, emptying it", () => {
  const cache = buildCache(shards(), tokenIndex());
  const patched = patchCache(cache, new Map([["a.json", "   "]]), []);
  expect(Object.keys(patched.dictionary)).toEqual([]);
  // No surfaces accounted, so the backlog rides through unchanged.
  expect(patched.curation.map((r) => r.surface)).toEqual(["wombat", "zebra"]);
});

test("emptyMessage is a settled no-corpus once the first search has run", () => {
  expect(emptyMessage(true)).toEqual({
    type: "data",
    status: "no-corpus",
    variants: [],
    lemmas: [],
    curation: [],
    curationTotal: 0,
    curationReady: false,
    stale: false,
  });
});

test("emptyMessage is a loading spinner until the first search settles", () => {
  expect(emptyMessage(false).status).toBe("loading");
});
