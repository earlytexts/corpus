/**
 * The pure core of the search panel: build a matcher from the query (literal or
 * regex, case toggle, whole-word wrapping), decide which lines of an edition
 * are block content (never the title line, `[metadata]` sections, or `{#…}`
 * tags), scope the catalogue's editions by author include/exclude filters, scan
 * one file's searchable lines into positioned matches with clipped previews,
 * and expand a replacement string for one match (regex captures included). No
 * VSCode — the provider (surface/searchPanel.ts) runs these over the model's
 * compiled files and applies the edits; everything decidable without an editor
 * is decided here, and tested.
 *
 * Positions are 0-based (lines and columns), end-exclusive — the shape a
 * VSCode Range wants.
 */

import type { MarkitDocument } from "@jsr/earlytexts__markit";
import type { Catalogue, Edition, Work } from "@earlytexts/corpus";
import { distinctWorks } from "./catalogueWalk.ts";
import { collectBlocks } from "./sourceTokens.ts";

/* -------------------------------- types --------------------------------- */

/** What the webview's controls amount to: the term, its three toggles, and the
 * author filters (slugs; empty include = every author, exclude wins). */
export type SearchQuery = {
  term: string;
  isRegex: boolean;
  caseSensitive: boolean;
  wholeWord: boolean;
  include: string[];
  exclude: string[];
};

/** One match: its source range, the matched text verbatim (the replace step
 * verifies against it before writing), and the clipped preview around it. */
export type Match = {
  line: number;
  start: number;
  end: number;
  matchText: string;
  before: string;
  after: string;
};

/** An edition file the current filters cover: its absolute source path and its
 * catalogue label ("Hume · Enquiry · 1748"). */
export type ScopedEdition = { path: string; label: string };

/** How much of the line travels with each match. Content lines are whole
 * paragraphs, routinely thousands of characters — the preview must clip. */
const BEFORE_CHARS = 48;
const AFTER_CHARS = 120;

/* ------------------------------ the matcher ------------------------------ */

/**
 * The query's matcher: global, unicode-aware, case-folded unless the toggle
 * says otherwise, the term escaped unless regex mode is on, and wrapped in
 * letter/digit lookarounds when whole-word is on (so "vertue" never matches
 * inside "vertuous", and "cafe" leaves "café" alone). A regex valid only
 * outside unicode mode (e.g. `a\-b`) falls back to non-unicode — except under
 * whole-word, whose `\p{…}` lookarounds need the u flag; then (as for any
 * unparsable pattern) the error is returned for inline display.
 */
export const buildMatcher = (
  query: SearchQuery,
): { matcher: RegExp } | { error: string } => {
  const source = query.isRegex ? `(?:${query.term})` : escapeRegExp(query.term);
  const wrapped = query.wholeWord
    ? `(?<![\\p{L}\\p{N}])${source}(?![\\p{L}\\p{N}])`
    : source;
  const flags = query.caseSensitive ? "g" : "gi";
  try {
    return { matcher: new RegExp(wrapped, flags + "u") };
  } catch (error) {
    if (!query.wholeWord) {
      try {
        return { matcher: new RegExp(wrapped, flags) };
      } catch {
        // fall through to report the unicode-mode error below
      }
    }
    return { error: error instanceof Error ? error.message : String(error) };
  }
};

/** Escape a string so it matches literally inside a RegExp. */
const escapeRegExp = (term: string): string =>
  term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/* ------------------------- block-content lines --------------------------- */

/**
 * The 0-based line numbers of `doc` that are block content, ascending: every
 * line inside a block's (whole-line, end-exclusive) source span, minus blank
 * lines, `{#…}` block-tag lines, and any block-metadata lines. Everything
 * outside block spans — the title line, `[metadata]` sections, nested `# id`
 * headings, inter-block blanks — is never offered. The document must come from
 * `compileWithPositions` of this source.
 */
export const searchableLines = (
  doc: MarkitDocument,
  lines: string[],
): Set<number> => {
  const searchable = new Set<number>();
  for (const block of collectBlocks(doc)) {
    for (
      let line = block.source!.start.line;
      line < block.source!.end.line;
      line++
    ) {
      const trimmed = (lines[line] ?? "").trimStart();
      if (trimmed === "" || trimmed.startsWith("{#")) continue;
      searchable.add(line);
    }
    const meta = block.metadataSource;
    if (meta !== undefined) {
      for (
        let line = meta.source.start.line;
        line < meta.source.end.line;
        line++
      ) {
        searchable.delete(line);
      }
    }
  }
  return searchable;
};

/* ------------------------------ file search ------------------------------ */

/**
 * Scan one compiled file's block-content lines with `matcher`, up to `cap`
 * matches (stopping there with `truncated` set). Zero-length matches (a regex
 * like `z*`) are skipped, advancing by hand so the scan always terminates.
 */
export const searchFile = (
  file: { text: string; doc: MarkitDocument },
  matcher: RegExp,
  cap: number,
): { matches: Match[]; truncated: boolean } => {
  const lines = file.text.split("\n");
  const matches: Match[] = [];
  for (const line of searchableLines(file.doc, lines)) {
    const text = lines[line]!;
    matcher.lastIndex = 0;
    for (
      let found = matcher.exec(text);
      found !== null;
      found = matcher.exec(text)
    ) {
      if (found[0] === "") {
        matcher.lastIndex++;
        continue;
      }
      if (matches.length >= cap) return { matches, truncated: true };
      const start = found.index;
      const end = start + found[0].length;
      matches.push({
        line,
        start,
        end,
        matchText: found[0],
        before: text.slice(Math.max(0, start - BEFORE_CHARS), start),
        after: text.slice(end, end + AFTER_CHARS),
      });
    }
  }
  return { matches, truncated: false };
};

/* ----------------------------- author scoping ---------------------------- */

/**
 * The edition files the author filters cover, each once, in catalogue order,
 * with their labels. Filters are slugs (trimmed, case-folded; blanks dropped):
 * an empty include means every author; a work counts when any of its authors
 * is included and none is excluded (so exclude beats include, and a
 * co-authored work reaches through either name). Borrowed editions are the
 * same document — and so the same source path — under each work that lists
 * them; the path set keeps each file once.
 */
export const scopedEditions = (
  catalogue: Catalogue,
  include: string[],
  exclude: string[],
): ScopedEdition[] => {
  const included = new Set(cleanSlugs(include));
  const excluded = new Set(cleanSlugs(exclude));
  const seen = new Set<string>();
  const out: ScopedEdition[] = [];
  for (const work of distinctWorks(catalogue.authors)) {
    const slugs = work.authorSlugs;
    if (included.size > 0 && !slugs.some((slug) => included.has(slug))) {
      continue;
    }
    if (slugs.some((slug) => excluded.has(slug))) continue;
    for (const edition of work.editions) {
      const path = catalogue.sources.get(edition.document);
      if (path === undefined || seen.has(path)) continue;
      seen.add(path);
      out.push({ path, label: editionLabel(catalogue, work, edition) });
    }
  }
  return out;
};

const cleanSlugs = (slugs: string[]): string[] =>
  slugs.map((slug) => slug.trim().toLowerCase()).filter((slug) => slug !== "");

/** "Hume · Enquiry · 1748"; co-authors read "Astell & Norris". */
const editionLabel = (
  catalogue: Catalogue,
  work: Work,
  edition: Edition,
): string => {
  const names = work.authorSlugs
    .map((slug) => catalogue.byAuthor.get(slug)?.surname ?? slug)
    .join(" & ");
  return `${names} · ${work.breadcrumb} · ${edition.slug}`;
};

/** Every author as a filter-autocomplete row, sorted by surname then forename
 * (the catalogue orders chronologically; a picker reads like an index). */
export const authorRows = (
  catalogue: Catalogue,
): { slug: string; name: string }[] =>
  catalogue.authors
    .map((author) => ({
      slug: author.slug,
      name: `${author.forename} ${author.surname}`.trim(),
      surname: author.surname,
      forename: author.forename,
    }))
    .sort(
      (a, b) =>
        a.surname.localeCompare(b.surname) ||
        a.forename.localeCompare(b.forename),
    )
    .map(({ slug, name }) => ({ slug, name }));

/* ------------------------------ replacement ------------------------------ */

/**
 * The replacement string for one match: the replace text verbatim for a
 * literal search; for a regex, the matched text re-matched non-globally so
 * `$1`-style capture references expand (the whole-word lookarounds hold — an
 * isolated match has no neighbouring word characters).
 */
export const replacementFor = (
  matchText: string,
  query: SearchQuery,
  replaceText: string,
): string => {
  if (!query.isRegex) return replaceText;
  const built = buildMatcher(query);
  if ("error" in built) return replaceText; // unreachable: the search compiled
  const once = new RegExp(
    built.matcher.source,
    built.matcher.flags.replace("g", ""),
  );
  return matchText.replace(once, replaceText);
};

export const plural = (n: number, noun: string): string =>
  `${n} ${noun}${n === 1 ? "" : "s"}`;

/* --------------------------- scan over the model -------------------------- */

/** Result caps, native-search ballpark: a scan stops here rather than posting
 * an unbounded payload for a one-letter term over ~250k-token editions. */
export const MAX_TOTAL = 10_000;
export const MAX_PER_FILE = 500;

/** A compiled edition as the scan reads it, fetched on demand by its
 * data/-relative path (the model's bounded compile cache); undefined when the
 * source is gone. The one seam onto the model the scan needs. */
export type CompiledFileSource = (
  rel: string,
) => Promise<{ text: string; doc: MarkitDocument } | undefined>;

/** One file's worth of results: the catalogue label is composed here so the
 * webview never needs the catalogue itself. */
export type SearchFileGroup = {
  path: string;
  label: string;
  matches: Match[];
  truncated: boolean;
};

/** The results payload the webview renders: the file groups and the tallies, or
 * an `error` when the regex will not parse. The adapter posts it verbatim. */
export type SearchResults = {
  files: SearchFileGroup[];
  totalMatches: number;
  truncated: boolean;
  error?: string;
};

/**
 * Scan the scoped editions for `query`, pulling each through `getCompiledFile`,
 * and return the grouped results — or `undefined` when `isCurrent()` reports the
 * run superseded mid-scan (a newer query or a reload), so the adapter drops it
 * rather than posting stale results. An absent catalogue or an empty term yields
 * empty results (posted, to clear the view); an unparsable regex yields the
 * error. Editions are pulled on demand, so the corpus need not be held compiled.
 */
export const searchCorpus = async (
  query: SearchQuery,
  catalogue: Catalogue | undefined,
  root: string,
  getCompiledFile: CompiledFileSource,
  isCurrent: () => boolean,
): Promise<SearchResults | undefined> => {
  const empty: SearchResults = { files: [], totalMatches: 0, truncated: false };
  if (catalogue === undefined || query.term === "") return empty;
  const built = buildMatcher(query);
  if ("error" in built) return { ...empty, error: built.error };
  const prefix = `${root}/data/`;
  const files: SearchFileGroup[] = [];
  let total = 0;
  let truncated = false;
  for (const { path, label } of scopedEditions(
    catalogue,
    query.include,
    query.exclude,
  )) {
    if (total >= MAX_TOTAL) {
      truncated = true;
      break;
    }
    const file = path.startsWith(prefix)
      ? await getCompiledFile(path.slice(prefix.length))
      : undefined;
    if (!isCurrent()) return undefined; // superseded mid-scan — drop these
    if (file === undefined) continue;
    const result = searchFile(
      file,
      built.matcher,
      Math.min(MAX_PER_FILE, MAX_TOTAL - total),
    );
    if (result.matches.length === 0) continue;
    truncated ||= result.truncated;
    total += result.matches.length;
    files.push({
      path,
      label,
      matches: result.matches,
      truncated: result.truncated,
    });
  }
  return { files, totalMatches: total, truncated };
};

/* ---------------------------- replace planning --------------------------- */

/** One located match the webview asks to replace: verbatim, so the edit can be
 * verified against the live document before it lands. */
export type ReplaceTarget = {
  path: string;
  line: number;
  start: number;
  end: number;
  matchText: string;
};

/** A verified edit to apply: the (0-based, end-exclusive) range and the
 * expanded replacement text. */
export type ReplaceEdit = {
  path: string;
  line: number;
  start: number;
  end: number;
  newText: string;
};

/** The outcome of verifying a replace request against the live documents. */
export type ReplacePlan = {
  /** The surviving edits, ready for one WorkspaceEdit. */
  edits: ReplaceEdit[];
  /** Distinct files at least one edit touches (for the summary and the saves). */
  filesTouched: number;
  /** Targets dropped because the file was gone or its text had moved. */
  skipped: number;
};

/** Read the live text at a range, or undefined when the file is gone. The
 * adapter opens the document through VSCode (once per file) and reads ranges. */
export type LiveDoc = (
  path: string,
) => Promise<
  ((line: number, start: number, end: number) => string) | undefined
>;

/** The number of distinct files the targets touch — the adapter's cue to
 * confirm a cross-file replace before planning it. */
export const distinctTargetFiles = (targets: ReplaceTarget[]): number =>
  new Set(targets.map((target) => target.path)).size;

/**
 * Group the targets by file and verify each against its live document: a file
 * that is gone skips all its targets; a target whose text moved since the search
 * is skipped; a surviving target becomes an edit with its replacement expanded
 * (regex captures included). The adapter applies the `edits` as one
 * WorkspaceEdit and saves the touched files — never a raw disk write, so VSCode
 * keeps per-file undo and does not auto-revert an open editor.
 */
export const planReplace = async (
  query: SearchQuery,
  replaceText: string,
  targets: ReplaceTarget[],
  openDoc: LiveDoc,
): Promise<ReplacePlan> => {
  const byPath = new Map<string, ReplaceTarget[]>();
  for (const target of targets) {
    const list = byPath.get(target.path);
    if (list === undefined) byPath.set(target.path, [target]);
    else list.push(target);
  }
  const edits: ReplaceEdit[] = [];
  let skipped = 0;
  let filesTouched = 0;
  for (const [path, list] of byPath) {
    const read = await openDoc(path);
    if (read === undefined) {
      skipped += list.length; // gone since the search
      continue;
    }
    let touchedHere = false;
    for (const target of list) {
      if (read(target.line, target.start, target.end) !== target.matchText) {
        skipped++;
        continue;
      }
      edits.push({
        path,
        line: target.line,
        start: target.start,
        end: target.end,
        newText: replacementFor(target.matchText, query, replaceText),
      });
      touchedHere = true;
    }
    if (touchedHere) filesTouched++;
  }
  return { edits, filesTouched, skipped };
};
