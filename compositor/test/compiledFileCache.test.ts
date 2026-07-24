/**
 * The on-demand compile cache: a miss compiles from source, a hit serves the
 * warm copy without recompiling, the byte budget evicts least-recently-used
 * entries but never below the floor, invalidation drops (and un-caches an
 * in-flight) entry, and concurrent misses for one path share a single compile.
 * Driven by a plain in-memory reader that counts reads, so a recompile is
 * observable.
 */

import { expect, test } from "vitest";
import {
  createCompiledFileCache,
  type FileReader,
} from "../src/core/compiledFileCache.ts";

/** A reader over a fixed file map that tallies how often it is read, so a test
 * can assert a hit did not recompile. */
const reader = (
  files: Record<string, string>,
): { read: FileReader; reads: () => number } => {
  let reads = 0;
  return {
    reads: () => reads,
    read: (path) => {
      reads++;
      return Promise.resolve(files[path] ?? null);
    },
  };
};

/** A minimal valid Markit document: a text id and one tagged paragraph. */
const body = (id: string, text: string): string => `# ${id}\n\n{#1}\n${text}`;

/** Three equal-length fixtures, so budget maths is in whole files. */
const trio = (): Record<string, string> => ({
  "works/a.mit": body("A", "a".repeat(100)),
  "works/b.mit": body("B", "b".repeat(100)),
  "works/c.mit": body("C", "c".repeat(100)),
});
const SIZE = body("A", "a".repeat(100)).length;

test("a miss compiles from source and returns the positioned file", async () => {
  const { read } = reader({ "works/a.mit": body("A", "reason and virtue") });
  const cache = createCompiledFileCache(read);
  const file = await cache.get("works/a.mit");
  expect(file?.path).toBe("works/a.mit");
  expect(file?.text).toBe(body("A", "reason and virtue"));
  // A real compile: blocks with source positions and per-file derivations.
  expect(file?.doc.blocks.length).toBeGreaterThan(0);
  expect(file?.derived.surfaces.size).toBeGreaterThan(0);
});

test("a missing source yields undefined and caches nothing", async () => {
  const { read } = reader({});
  const cache = createCompiledFileCache(read);
  expect(await cache.get("works/gone.mit")).toBeUndefined();
  expect(cache.bytes).toBe(0);
});

test("a hit serves the warm copy without recompiling", async () => {
  const { read, reads } = reader({ "works/a.mit": body("A", "reason") });
  const cache = createCompiledFileCache(read);
  const first = await cache.get("works/a.mit");
  const second = await cache.get("works/a.mit");
  expect(second).toBe(first); // same object, not a recompile
  expect(reads()).toBe(1);
});

test("the byte budget evicts least-recently-used entries", async () => {
  const { read, reads } = reader(trio());
  // Budget of one file, floor 1: each new admit evicts the oldest.
  const cache = createCompiledFileCache(read, { budgetBytes: SIZE, floor: 1 });
  await cache.get("works/a.mit");
  await cache.get("works/b.mit"); // evicts a
  expect(cache.peek("works/a.mit")).toBeUndefined();
  expect(cache.peek("works/b.mit")).toBeDefined();
  await cache.get("works/a.mit"); // recompiles a (was evicted), evicts b
  expect(reads()).toBe(3);
  expect(cache.peek("works/b.mit")).toBeUndefined();
});

test("a hit refreshes recency, so the untouched entry is evicted first", async () => {
  const { read } = reader(trio());
  const cache = createCompiledFileCache(read, {
    budgetBytes: 2 * SIZE,
    floor: 1,
  });
  await cache.get("works/a.mit");
  await cache.get("works/b.mit");
  await cache.get("works/a.mit"); // a is now most-recent
  await cache.get("works/c.mit"); // over budget → evict the oldest, which is b
  expect(cache.peek("works/a.mit")).toBeDefined();
  expect(cache.peek("works/b.mit")).toBeUndefined();
  expect(cache.peek("works/c.mit")).toBeDefined();
});

test("the floor keeps entries resident even over budget", async () => {
  const { read } = reader(trio());
  // Budget below one file is always exceeded, but the floor of 2 protects two.
  const cache = createCompiledFileCache(read, { budgetBytes: 1, floor: 2 });
  await cache.get("works/a.mit");
  await cache.get("works/b.mit");
  expect(cache.peek("works/a.mit")).toBeDefined();
  expect(cache.peek("works/b.mit")).toBeDefined();
});

test("invalidate drops an entry so the next get recompiles", async () => {
  const { read, reads } = reader({ "works/a.mit": body("A", "reason") });
  const cache = createCompiledFileCache(read);
  await cache.get("works/a.mit");
  cache.invalidate("works/a.mit");
  expect(cache.peek("works/a.mit")).toBeUndefined();
  expect(cache.bytes).toBe(0);
  await cache.get("works/a.mit");
  expect(reads()).toBe(2);
});

test("concurrent misses for one path share a single compile", async () => {
  const { read, reads } = reader({ "works/a.mit": body("A", "reason") });
  const cache = createCompiledFileCache(read);
  const [first, second] = await Promise.all([
    cache.get("works/a.mit"),
    cache.get("works/a.mit"),
  ]);
  expect(first).toBe(second);
  expect(reads()).toBe(1);
});

test("clear empties the cache", async () => {
  const { read } = reader({ "works/a.mit": body("A", "reason") });
  const cache = createCompiledFileCache(read);
  await cache.get("works/a.mit");
  cache.clear();
  expect(cache.peek("works/a.mit")).toBeUndefined();
  expect(cache.bytes).toBe(0);
});
