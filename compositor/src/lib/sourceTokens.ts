/**
 * Source-token extraction: place a compiled block's Markit tokens back in the
 * raw `.mit` source. Given a positioned compile (with source spans) and the
 * file's lines, each token becomes a `SourceToken` — its lexicon fold, its
 * printed display, and the 0-based, end-exclusive line/column range it occupies
 * — with markup-exempt tokens (people, places, orgs, citations, foreign spans,
 * `[w:]`) dropped and `{…}`/`{{…}}` character/Greek-mode spans absorbed so a
 * replacement over a token covers the whole brace span. Pure, editor-free.
 *
 * Two consumers share this seam: the suggestion engine (hints.ts) scans these
 * tokens against its mined lexicons, and the dictionary accounting scan
 * (dictionaryScan.ts) locates unaccounted surfaces by them. This module also
 * carries the pieces both need around the tokens: `collectBlocks` (the
 * document's blocks in source order), `maskedLines` (source lines with markup
 * blanked, for the citation regexes), `sliceRange` (join a multi-line source
 * range), and `foldWord` (the lexicon-folding atom the mined lexicons and these
 * tokens must agree on).
 *
 * Positions are 0-based (lines and columns), end-exclusive — the shape a VSCode
 * Range wants; the corpus's own display convention is 1-based.
 */

import {
  type Block,
  type Extraction,
  extractText,
  type Frame,
  type MarkitDocument,
  tokenize,
} from "@jsr/earlytexts__markit";

/* ----------------------------- constants ------------------------------- */

/** The markup kinds whose content is already marked up (or, for `word`,
 * already disambiguated by `[w:]`): their tokens are never suggestion or
 * squiggle material. */
const EXEMPT_FRAMES: ReadonlySet<string> = new Set([
  "person",
  "place",
  "org",
  "citation",
  "language",
  "word",
]);

const GREEK_CHAR = /[\u0370-\u03ff\u1f00-\u1fff]/u;

/** Inline formatting wrappers a name/citation/foreign phrase is often set in
 * (italics, small-caps). The citation regexes treat them as word boundaries
 * (maskedLines softens them to a space); hints widens matches back over them. */
export const FORMAT_DELIMS = new Set(["_", "*"]);

/* -------------------------------- types -------------------------------- */

export type SourceToken = {
  /** The lexicon fold of the token (foldWord), the key the mined lexicons file
   * it under. Distinct from the corpus's own `fold`, which the dictionary scan
   * applies to `display` for its register key. */
  lexiconFolded: string;
  /** The token as extracted (non-breaking spaces read as plain spaces, so a
   * `~`-fused unit reads "a priori"). */
  display: string;
  /** Whether only inter-word space separates this token from the previous one
   * within the same plain-text run — the adjacency a multi-word join may
   * bridge. Markup of any kind between the two breaks it. */
  joinsLeft: boolean;
  /** The source occurrence began with a capital letter. */
  capital: boolean;
  /** Greek script (typed directly or via a `{{…}}` Greek-mode span). */
  greek: boolean;
  line: number;
  start: number;
  end: number;
};

/* --------------------------- block tokens ------------------------------ */

/**
 * Every non-exempt token of a compiled block as a source token — Markit's
 * word identity (`~` joins, page-break and editorial transparency included),
 * placed by its source span. Unfiltered: single-letter tokens included, so
 * the dictionary scan (dictionaryScan.ts) sees the whole stream (it re-folds
 * each token's `display` with the corpus's own folding to match the
 * register); `scanSource` drops the short ones itself. The block must come
 * from a compile (with positions) of THIS source.
 */
export const blockSourceTokens = (
  block: Block,
  lines: string[],
): SourceToken[] => blockTokens(block, extractText(block), lines);

/** Every block of the document and its (in-file) children, in source order. */
export const collectBlocks = (document: MarkitDocument): Block[] => {
  const out: Block[] = [];
  const walk = (doc: MarkitDocument): void => {
    out.push(...doc.blocks);
    doc.children.forEach(walk);
  };
  walk(document);
  return out.sort((a, b) => a.source!.start.line - b.source!.start.line);
};

/**
 * Place a block's Markit tokens in the source: drop the exempt ones (already
 * inside markup), read each one's line and columns off its source span, and
 * widen the edges over any `{…}`/`{{…}}` character- or Greek-mode span they
 * fall inside — compiled positions point at the braces' content, but a
 * replacement over the token must cover the whole span.
 */
export const blockTokens = (
  block: Block,
  extraction: Extraction,
  lines: string[],
): SourceToken[] => {
  const out: SourceToken[] = [];
  const { text, spans } = extraction;
  let startIndex = 0; // span holding the current token's first character
  let endIndex = 0; // span holding the current token's last character
  let previous: { span: number; end: number } | undefined;
  for (const token of tokenize(block)) {
    while (spans[startIndex]!.end <= token.start) startIndex++;
    while (spans[endIndex]!.end <= token.end - 1) endIndex++;
    const joinsLeft =
      previous !== undefined &&
      previous.span === startIndex &&
      /^ *$/.test(text.slice(previous.end, token.start));
    previous = { span: endIndex, end: token.end };
    if (token.source === undefined || isExempt(token.context)) continue;
    const line = token.source.start.line;
    const [start, end] = widenOverBraces(
      lines[line] ?? "",
      token.source.start.column,
      token.source.end.column,
    );
    out.push({
      lexiconFolded: foldWord(token.text),
      display: token.text,
      joinsLeft,
      capital: /^\p{Lu}/u.test(token.text),
      greek: GREEK_CHAR.test(token.text),
      line,
      start,
      end,
    });
  }
  return out;
};

/** Whether a wrapper stack contains exempting markup. */
const isExempt = (context: Frame[]): boolean =>
  context.some((frame) => EXEMPT_FRAMES.has(frame.type));

/** Widen a token's column range over any character/Greek-mode span it
 * overlaps on its line (a token strictly inside a multi-word Greek span
 * widens to the whole span — replacing less would break the braces). */
const widenOverBraces = (
  line: string,
  start: number,
  end: number,
): [number, number] => {
  for (const span of braceSpans(line)) {
    if (span.end <= start) continue;
    if (span.start >= end) break;
    if (span.start < start) start = span.start;
    if (span.end > end) end = span.end;
  }
  return [start, end];
};

/** The `{…}` and `{{…}}` spans of a source line, as [start, end) column
 * ranges, escaped braces skipped. Block-tag braces only occur on lines that
 * carry no tokens, so they never matter here. */
const braceSpans = (line: string): { start: number; end: number }[] => {
  const spans: { start: number; end: number }[] = [];
  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch !== "{") {
      i++;
      continue;
    }
    const close = line[i + 1] === "{" ? "}}" : "}";
    let j = i + close.length;
    while (j < line.length && !line.startsWith(close, j)) {
      j += line[j] === "\\" ? 2 : 1;
    }
    spans.push({ start: i, end: Math.min(j + close.length, line.length) });
    i = spans[spans.length - 1]!.end;
  }
  return spans;
};

/* ------------------------------ masking -------------------------------- */

/**
 * The block's source lines with everything except unmarked text content
 * blanked to \x00, for the citation regexes: a pattern can never match inside
 * existing markup or across it. Inline formatting delimiters soften to a
 * space instead — a word boundary the regexes may bridge, with the match
 * widened back over the delimiter afterwards (expandOverMarkup).
 */
export const maskedLines = (
  block: Block,
  extraction: Extraction,
  lines: string[],
): Map<number, string> => {
  const from = block.source!.start.line;
  const to = Math.min(block.source!.end.line - 1, lines.length - 1);
  const blanks = new Map<number, string[]>();
  for (let num = from; num <= to; num++) {
    blanks.set(
      num,
      Array.from(lines[num] ?? "", () => "\0"),
    );
  }
  for (const span of extraction.spans) {
    if (span.source === undefined || isExempt(span.context)) continue;
    const { start, end } = span.source;
    for (let num = start.line; num <= end.line; num++) {
      const blank = blanks.get(num);
      if (blank === undefined) continue;
      const line = lines[num] ?? "";
      const a = num === start.line ? start.column : 0;
      const b =
        num === end.line ? Math.min(end.column, line.length) : line.length;
      for (let k = a; k < b; k++) blank[k] = line[k]!;
    }
  }
  const masked = new Map<number, string>();
  for (const [num, blank] of blanks) {
    const line = lines[num] ?? "";
    for (let k = 0; k < blank.length; k++) {
      if (blank[k] === "\0" && FORMAT_DELIMS.has(line[k]!)) blank[k] = " ";
    }
    masked.set(num, blank.join(""));
  }
  return masked;
};

/* ------------------------------ slicing -------------------------------- */

/** Join a source range (0-based, end-exclusive) into its text: the first
 * line's tail, the whole middle lines, and the last line's head. Callers
 * guarantee the range is well-ordered (start at or before end). */
export const sliceRange = (
  lines: string[],
  fromLine: number,
  fromCol: number,
  toLine: number,
  toCol: number,
): string =>
  fromLine === toLine
    ? (lines[fromLine] ?? "").slice(fromCol, toCol)
    : [
        (lines[fromLine] ?? "").slice(fromCol),
        ...lines.slice(fromLine + 1, toLine),
        (lines[toLine] ?? "").slice(0, toCol),
      ].join("\n");

/* ------------------------------- folding ------------------------------- */

/**
 * Fold a word for lexicon matching: lowercase, strip combining marks (which
 * also reduces `ç` and Greek breathings/accents), expand the ligatures the
 * corpus's character mode produces, normalise apostrophes, and trim edge
 * hyphens/apostrophes. Applied to both sides — words mined from compiled
 * documents and tokens read from raw source — so the two always agree.
 */
export const foldWord = (raw: string): string =>
  raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/æ/gu, "ae")
    .replace(/œ/gu, "oe")
    .replace(/’/gu, "'")
    .replace(/^['-]+|['-]+$/gu, "");
