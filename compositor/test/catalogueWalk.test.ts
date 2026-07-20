/**
 * Walking the catalogue by identity: each work once (even when co-authored), and
 * each edition document once (even when borrowed), with `descend` reaching the
 * borrowed children too. Structural fixtures — the walk only cares about object
 * identity, so bare `{ children }` docs and `{ editions }` works suffice, in the
 * spirit of compareScope.test.ts simulating a co-authored work by hand.
 */

import { expect, test } from "vitest";
import type { Catalogue, Edition, Work } from "@earlytexts/corpus";
import type { MarkitDocument } from "@jsr/earlytexts__markit";
import {
  distinctEditionDocuments,
  distinctWorks,
} from "../src/lib/catalogueWalk.ts";

const doc = (children: MarkitDocument[] = []): MarkitDocument =>
  ({ children }) as MarkitDocument;

const edition = (document: MarkitDocument): Edition =>
  ({ document }) as Edition;

const work = (...editions: Edition[]): Work => ({ editions }) as Work;

const author = (...works: Work[]) => ({ works });

test("distinctWorks lists each work once, in author order", () => {
  const a = work();
  const b = work();
  const c = work();
  expect(distinctWorks([author(a, b), author(c)])).toEqual([a, b, c]);
});

test("distinctWorks deduplicates a work shared across authors", () => {
  const shared = work();
  const solo = work();
  // The co-authored work lists under both authors; it is offered once.
  expect(distinctWorks([author(shared), author(shared, solo)])).toEqual([
    shared,
    solo,
  ]);
});

test("distinctEditionDocuments yields each edition document once", () => {
  const shared = doc();
  const other = doc();
  // `shared` is borrowed: it is the same document under two editions.
  const cat = {
    authors: [author(work(edition(shared), edition(other), edition(shared)))],
  } as Catalogue;
  expect(distinctEditionDocuments(cat)).toEqual([shared, other]);
});

test("distinctEditionDocuments ignores borrowed children by default", () => {
  const child = doc();
  const parent = doc([child]);
  const cat = { authors: [author(work(edition(parent)))] } as Catalogue;
  expect(distinctEditionDocuments(cat)).toEqual([parent]);
});

test("distinctEditionDocuments descends into borrowed children, each once", () => {
  const child = doc();
  const parent = doc([child]);
  // The child also stands alone as its own edition elsewhere — counted once.
  const cat = {
    authors: [author(work(edition(parent)), work(edition(child)))],
  } as Catalogue;
  expect(distinctEditionDocuments(cat, true)).toEqual([parent, child]);
});
