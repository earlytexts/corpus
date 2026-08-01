/**
 * The pure client-side transforms the dictionary panel's webview applies to a
 * derived view before rendering: narrowing rows to one shard letter, and
 * slicing the result into fixed-size pages. Both views (variants, lemmas) are
 * posted whole — short strings, well under a couple of MB — so filtering and
 * paging are the webview's own concern, kept here (vscode- and corpus-free, so
 * the webview bundle stays tiny) and unit-tested rather than exercised only
 * through the DOM.
 */

/** A row of either view carries the shard letter it buckets under. */
type Lettered = { letter: string };

/** The rows for one letter — `"all"` keeps every row (already sorted upstream,
 * so the subset stays sorted). */
export const filterByLetter = <T extends Lettered>(
  rows: T[],
  letter: string,
): T[] =>
  letter === "all" ? rows : rows.filter((row) => row.letter === letter);

export type Page<T> = {
  items: T[];
  /** 0-based, clamped into range, so an out-of-range request (e.g. the last
   * page after a delete shrank the list) lands on a real page. */
  pageIndex: number;
  /** Total pages — at least 1, even with no rows. */
  pageCount: number;
};

/** One page of `rows`, `pageSize` at a time. */
export const page = <T>(
  rows: T[],
  pageIndex: number,
  pageSize: number,
): Page<T> => {
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const clamped = Math.min(Math.max(pageIndex, 0), pageCount - 1);
  const start = clamped * pageSize;
  return {
    items: rows.slice(start, start + pageSize),
    pageIndex: clamped,
    pageCount,
  };
};
