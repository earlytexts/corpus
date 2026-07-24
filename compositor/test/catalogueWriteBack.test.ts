/**
 * The catalogue write-back drainer's latest-wins state machine: one writer at a
 * time; a newer generation replaces (never queues behind) the pending one; its
 * scope is merged so a cheaper load can't drop a pending costlier one's
 * obligations (a `full` survives, a `docs` set only grows); and any scope is
 * promoted to a full write until one has landed this session (the OOM fix — see
 * the module header).
 */

import { expect, test } from "vitest";
import type { Catalogue } from "@earlytexts/corpus";
import {
  createCatalogueWriteBack,
  type WriteScope,
} from "../src/lib/catalogueWriteBack.ts";

/** A tagged stand-in — the drainer only ever forwards the object, never reads it. */
const cat = (tag: string): Catalogue => ({ tag }) as unknown as Catalogue;
const tagOf = (catalogue: Catalogue) =>
  (catalogue as unknown as { tag: string }).tag;

const full: WriteScope = { kind: "full" };
const dictionary: WriteScope = { kind: "dictionary" };
const docs = (...paths: string[]): WriteScope => ({
  kind: "docs",
  paths: new Set(paths),
});

/** A writer whose calls are recorded and whose promise a test resolves by hand.
 * A docs write records its paths after the tag ("b a+c") so unioning shows. */
const gatedWriter = () => {
  const calls: string[] = [];
  const gates: Array<() => void> = [];
  const write = (
    catalogue: Catalogue,
    _warnings: string[],
    paths?: ReadonlySet<string>,
  ): Promise<void> => {
    calls.push(
      paths === undefined
        ? tagOf(catalogue)
        : `${tagOf(catalogue)} ${[...paths].sort().join("+")}`,
    );
    return new Promise<void>((resolve) => gates.push(resolve));
  };
  const releaseAll = () => {
    for (const gate of gates.splice(0)) gate();
  };
  return { calls, releaseAll, write };
};

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

test("a full load writes the full catalogue", async () => {
  const f = gatedWriter(),
    dict = gatedWriter(),
    d = gatedWriter();
  const writeBack = createCatalogueWriteBack(f.write, dict.write, d.write);

  writeBack.enqueue(cat("a"), [], full);
  f.releaseAll();
  await settle();

  expect(f.calls).toEqual(["a"]);
  expect(dict.calls).toEqual([]);
  expect(d.calls).toEqual([]);
});

test("any load is promoted to a full write until one has landed", async () => {
  const f = gatedWriter(),
    dict = gatedWriter(),
    d = gatedWriter();
  const writeBack = createCatalogueWriteBack(f.write, dict.write, d.write);

  // catalogue/ may be a previous session's or missing, so a docs load can't
  // just patch it — it is promoted to a full write.
  writeBack.enqueue(cat("a"), [], docs("works/a/w/1700.mit"));
  f.releaseAll();
  await settle();

  expect(f.calls).toEqual(["a"]);
  expect(d.calls).toEqual([]);
});

test("a dictionary-only load writes only the dictionary once a full write has landed", async () => {
  const f = gatedWriter(),
    dict = gatedWriter(),
    d = gatedWriter();
  const writeBack = createCatalogueWriteBack(f.write, dict.write, d.write);

  writeBack.enqueue(cat("a"), [], full);
  f.releaseAll();
  await settle();

  writeBack.enqueue(cat("b"), [], dictionary);
  dict.releaseAll();
  await settle();

  expect(f.calls).toEqual(["a"]);
  expect(dict.calls).toEqual(["b"]);
});

test("a per-file load writes only its documents once a full write has landed", async () => {
  const f = gatedWriter(),
    dict = gatedWriter(),
    d = gatedWriter();
  const writeBack = createCatalogueWriteBack(f.write, dict.write, d.write);

  writeBack.enqueue(cat("a"), [], full);
  f.releaseAll();
  await settle();

  writeBack.enqueue(cat("b"), [], docs("works/a/w/1700.mit"));
  d.releaseAll();
  await settle();

  expect(d.calls).toEqual(["b works/a/w/1700.mit"]);
  expect(f.calls).toEqual(["a"]);
});

test("a newer generation replaces the one waiting, unioning docs paths", async () => {
  const f = gatedWriter(),
    dict = gatedWriter(),
    d = gatedWriter();
  const writeBack = createCatalogueWriteBack(f.write, dict.write, d.write);

  writeBack.enqueue(cat("seed"), [], full);
  f.releaseAll();
  await settle();

  // "x" occupies the writer; two more docs loads wait in the pending slot and
  // collapse to the latest content ("z") while unioning both obligations (q, r).
  writeBack.enqueue(cat("x"), [], docs("p"));
  writeBack.enqueue(cat("y"), [], docs("q"));
  writeBack.enqueue(cat("z"), [], docs("r"));
  d.releaseAll(); // drains "x", then "z" carrying q+r
  await settle();
  d.releaseAll();
  await settle();

  expect(d.calls).toEqual(["x p", "z q+r"]);
});

test("a pending full write is not demoted by a later dictionary load", async () => {
  const f = gatedWriter(),
    dict = gatedWriter(),
    d = gatedWriter();
  const writeBack = createCatalogueWriteBack(f.write, dict.write, d.write);

  writeBack.enqueue(cat("seed"), [], full);
  f.releaseAll();
  await settle();

  // "x" occupies the writer; "b" (full) waits, then a dictionary "c" replaces
  // it — the merged scope stays full, so its documents still land.
  writeBack.enqueue(cat("x"), [], full);
  writeBack.enqueue(cat("b"), [], full);
  writeBack.enqueue(cat("c"), [], dictionary);
  f.releaseAll();
  await settle();
  f.releaseAll();
  await settle();

  expect(f.calls).toEqual(["seed", "x", "c"]);
  expect(dict.calls).toEqual([]);
  expect(d.calls).toEqual([]);
});

test("a docs load superseding a pending dictionary keeps the docs obligation", async () => {
  const f = gatedWriter(),
    dict = gatedWriter(),
    d = gatedWriter();
  const writeBack = createCatalogueWriteBack(f.write, dict.write, d.write);

  writeBack.enqueue(cat("seed"), [], full);
  f.releaseAll();
  await settle();

  // "x" occupies the writer; "b" (dictionary) waits, then "c" (docs) replaces
  // it — the union is a docs write, not a dictionary-only one.
  writeBack.enqueue(cat("x"), [], full);
  writeBack.enqueue(cat("b"), [], dictionary);
  writeBack.enqueue(cat("c"), [], docs("works/a/w/1700.mit"));
  f.releaseAll();
  await settle();
  d.releaseAll();
  await settle();

  expect(f.calls).toEqual(["seed", "x"]);
  expect(d.calls).toEqual(["c works/a/w/1700.mit"]);
  expect(dict.calls).toEqual([]);
});

test("a failed write is swallowed so the drainer keeps going", async () => {
  const calls: string[] = [];
  const failing = (catalogue: Catalogue): Promise<void> => {
    calls.push(tagOf(catalogue));
    return Promise.reject(new Error("disk full"));
  };
  const writeBack = createCatalogueWriteBack(failing, failing, failing);

  writeBack.enqueue(cat("a"), [], full);
  await settle();
  writeBack.enqueue(cat("b"), [], full);
  await settle();

  expect(calls).toEqual(["a", "b"]);
});
