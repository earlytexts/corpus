/**
 * The catalogue write-back drainer's latest-wins state machine: one writer at a
 * time, a newer generation replaces (never queues behind) the pending one, the
 * `full` flag is merged so a dictionary-only load can't demote a pending full
 * write, and a dictionary-only write is promoted to a full one until a full
 * write has landed this session (the OOM fix — see the module header).
 */

import { expect, test } from "vitest";
import type { Catalogue } from "@earlytexts/corpus";
import { createCatalogueWriteBack } from "../src/lib/catalogueWriteBack.ts";

/** A tagged stand-in — the drainer only ever forwards the object, never reads it. */
const cat = (tag: string): Catalogue => ({ tag }) as unknown as Catalogue;

/** A writer whose calls are recorded and whose promise a test resolves by hand. */
const gatedWriter = () => {
  const calls: string[] = [];
  const gates: Array<() => void> = [];
  const write = (catalogue: Catalogue): Promise<void> => {
    calls.push((catalogue as unknown as { tag: string }).tag);
    return new Promise<void>((resolve) => gates.push(resolve));
  };
  const releaseAll = () => {
    for (const gate of gates.splice(0)) gate();
  };
  return { calls, releaseAll, write };
};

test("a document-changing load writes the full catalogue", async () => {
  const full = gatedWriter();
  const dict = gatedWriter();
  const writeBack = createCatalogueWriteBack(full.write, dict.write);

  writeBack.enqueue(cat("a"), [], true);
  full.releaseAll();
  await Promise.resolve();

  expect(full.calls).toEqual(["a"]);
  expect(dict.calls).toEqual([]);
});

test("a dictionary-only load is promoted to a full write until one has landed", async () => {
  const full = gatedWriter();
  const dict = gatedWriter();
  const writeBack = createCatalogueWriteBack(full.write, dict.write);

  // No full write has landed this session, so the dictionary-only load is
  // promoted — catalogue/ may be a previous session's or missing.
  writeBack.enqueue(cat("a"), [], false);
  full.releaseAll();
  await Promise.resolve();

  expect(full.calls).toEqual(["a"]);
  expect(dict.calls).toEqual([]);
});

test("a dictionary-only load writes only the dictionary once a full write has landed", async () => {
  const full = gatedWriter();
  const dict = gatedWriter();
  const writeBack = createCatalogueWriteBack(full.write, dict.write);

  writeBack.enqueue(cat("a"), [], true);
  full.releaseAll();
  await Promise.resolve();
  await Promise.resolve();

  writeBack.enqueue(cat("b"), [], false);
  dict.releaseAll();
  await Promise.resolve();

  expect(full.calls).toEqual(["a"]);
  expect(dict.calls).toEqual(["b"]);
});

test("a newer generation replaces the one still waiting behind the writer", async () => {
  const full = gatedWriter();
  const dict = gatedWriter();
  const writeBack = createCatalogueWriteBack(full.write, dict.write);

  // First write is in flight (gate held); the next two enqueues collapse to the
  // latest, so the writer runs exactly twice, not three times.
  writeBack.enqueue(cat("a"), [], true);
  writeBack.enqueue(cat("b"), [], true);
  writeBack.enqueue(cat("c"), [], true);
  full.releaseAll(); // drains "a", then "c"
  await Promise.resolve();
  full.releaseAll();
  await Promise.resolve();

  expect(full.calls).toEqual(["a", "c"]);
});

test("a pending full write is not demoted by a later dictionary-only load", async () => {
  const full = gatedWriter();
  const dict = gatedWriter();
  const writeBack = createCatalogueWriteBack(full.write, dict.write);

  // Land a full write so a later dictionary-only load would otherwise stay small
  // (isolating the flag-preservation from the until-a-full-write promotion).
  writeBack.enqueue(cat("seed"), [], true);
  full.releaseAll();
  await Promise.resolve();
  await Promise.resolve();

  // "x" occupies the writer; "b" (document-changing) waits in the pending slot,
  // then a dictionary-only "c" replaces it — but the merged `full` flag keeps the
  // superseding generation a full write, so its documents still land.
  writeBack.enqueue(cat("x"), [], true);
  writeBack.enqueue(cat("b"), [], true);
  writeBack.enqueue(cat("c"), [], false);
  full.releaseAll(); // release "x"; the drainer takes "c" as a full write
  await Promise.resolve();
  full.releaseAll(); // release "c"
  await Promise.resolve();

  expect(full.calls).toEqual(["seed", "x", "c"]);
  expect(dict.calls).toEqual([]);
});

test("a failed write is swallowed so the drainer keeps going", async () => {
  const calls: string[] = [];
  const failing = (catalogue: Catalogue): Promise<void> => {
    calls.push((catalogue as unknown as { tag: string }).tag);
    return Promise.reject(new Error("disk full"));
  };
  const writeBack = createCatalogueWriteBack(failing, failing);

  writeBack.enqueue(cat("a"), [], true);
  await Promise.resolve();
  await Promise.resolve();
  // A second enqueue still drains despite the first write rejecting.
  writeBack.enqueue(cat("b"), [], true);
  await Promise.resolve();
  await Promise.resolve();

  expect(calls).toEqual(["a", "b"]);
});
