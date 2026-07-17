/**
 * The watcher's reload decision: a `.mit` edit recompiles just that file, a
 * dictionary shard revalidates without recompiling any documents (the fix that
 * kept a run of dictionary edits from recompiling the whole corpus each time),
 * and anything else is structural and forces a full reload.
 */

import { expect, test } from "vitest";
import { reloadKind } from "../src/lib/reloadKind.ts";

test("a .mit file recompiles just itself", () => {
  expect(reloadKind("authors/hume/ehu/1748/index.mit")).toBe("recompile");
});

test("a dictionary shard revalidates without recompiling documents", () => {
  expect(reloadKind("dictionary/a.json")).toBe("revalidate");
});

test("a non-.mit file outside the dictionary forces a full reload", () => {
  expect(reloadKind("authors/hume/author.json")).toBe("full");
});

test("a bare directory event forces a full reload", () => {
  expect(reloadKind("authors/newauthor")).toBe("full");
});

test("a .mit path anywhere counts as a recompile, dictionary or not", () => {
  // Defensive: a hypothetical .mit inside dictionary/ is still a document.
  expect(reloadKind("dictionary/notes.mit")).toBe("recompile");
});
