/**
 * The webview's client-side view transforms: filter a derived view's rows by
 * shard letter, then slice into pages. Pure, so pinned directly rather than
 * through the DOM.
 */

import { expect, test } from "vitest";
import { filterByLetter, page } from "../src/lib/dictionaryPanel.ts";

const rows = (letters: string) =>
  [...letters].map((letter, i) => ({ letter, id: i }));

test('filterByLetter keeps every row for "all"', () => {
  const all = rows("abc");
  expect(filterByLetter(all, "all")).toBe(all);
});

test("filterByLetter narrows to one letter, keeping order", () => {
  const all = rows("abab");
  expect(filterByLetter(all, "a")).toEqual([
    { letter: "a", id: 0 },
    { letter: "a", id: 2 },
  ]);
});

test("filterByLetter is empty for a letter with no rows", () => {
  expect(filterByLetter(rows("abc"), "z")).toEqual([]);
});

test("page slices the requested page and reports the count", () => {
  const items = [1, 2, 3, 4, 5];
  expect(page(items, 0, 2)).toEqual({
    items: [1, 2],
    pageIndex: 0,
    pageCount: 3,
  });
  expect(page(items, 1, 2)).toEqual({
    items: [3, 4],
    pageIndex: 1,
    pageCount: 3,
  });
  expect(page(items, 2, 2)).toEqual({
    items: [5],
    pageIndex: 2,
    pageCount: 3,
  });
});

test("page clamps an out-of-range index onto the last real page", () => {
  expect(page([1, 2, 3], 9, 2)).toEqual({
    items: [3],
    pageIndex: 1,
    pageCount: 2,
  });
  expect(page([1, 2, 3], -3, 2)).toEqual({
    items: [1, 2],
    pageIndex: 0,
    pageCount: 2,
  });
});

test("page reports one empty page for no rows", () => {
  expect(page([], 0, 50)).toEqual({ items: [], pageIndex: 0, pageCount: 1 });
});
