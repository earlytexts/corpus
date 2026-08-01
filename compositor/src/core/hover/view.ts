/**
 * The token-accounting hover, assembled as data — the vscode-free half of
 * adapters/vscode/hover.ts. Given a `.mit` document's text and a cursor
 * position, it locates the token under the cursor (reusing the source-token
 * walk the squiggle and suggestion overlays share, so exempt and
 * already-`[w:]`-marked tokens are transparently skipped), asks the register
 * how it accounts for that token (`resolveHoverInfo`/`lemmaForms`,
 * hover/info.ts), and renders the result as a Markdown *string* plus the range
 * it covers.
 *
 * It speaks only of lemmas and forms, never the accounting engine's internal
 * classes: a mechanical or unaccounted token yields nothing (an unknown word's
 * "not in the dictionary" squiggle is the one tooltip it shows), so every
 * hover a contributor sees reads as the same lemma view rather than betraying
 * which route accounted for the word.
 *
 * Compiling the source to place tokens is memoised per (uri, version) and the
 * register's paradigms are indexed once per catalogue — both memos live here
 * so a burst of hovers over one unchanged document does the work once. The
 * editor layer (adapters/vscode/hover.ts) wraps the returned Markdown in a
 * scoped-trusted `MarkdownString`, maps the range/position, and applies the
 * pin edit.
 */

import {
  compileWithPositions,
  type MarkitDocument,
} from "@jsr/earlytexts__markit";
import { type Dictionary, overridesOf } from "@earlytexts/corpus";
import {
  blockSourceTokens,
  collectBlocks,
  type SourceToken,
} from "../shared/sourceTokens.ts";
import {
  type AccountedInfo,
  type HoverInfo,
  lemmaForms,
  type OtherReading,
  resolveHoverInfo,
} from "./info.ts";

/** The internal command a pin link fires. Not a palette command — invoked only
 * from the trusted hover Markdown, so it needs no package.json contribution.
 * Shared: this module encodes it into the links, the adapter registers it and
 * scopes the Markdown's trust to it. */
export const PIN_COMMAND = "compositor.pinReading";

/** [startLine, startColumn, endLine, endColumn]. */
export type Range4 = [number, number, number, number];

/** The arguments a pin link carries — all plain data so the link survives
 * serialisation into the Markdown. */
export type PinArgs = {
  uri: string;
  /** The token range to replace. */
  range: Range4;
  value: string;
};

/** A ready-to-show hover: the range it covers and its Markdown source. */
export type HoverView = {
  range: Range4;
  markdown: string;
};

/** The hover for a position, or undefined when the cursor is not on a token or
 * the token is not one the register accounts for (a mechanical or unaccounted
 * word gets no lemma hover). The caller has already checked the setting gate and
 * that a corpus is loaded. */
export const buildHover = (
  input: {
    uri: string;
    version: number;
    text: string;
    line: number;
    character: number;
    dictionary: Dictionary;
  },
  compile: CompileMemo,
  forms: FormsCache,
): HoverView | undefined => {
  const { doc, lines } = compile(`${input.uri}\n${input.version}`, input.text);
  const token = tokenAt(doc, lines, input.line, input.character);
  if (token === undefined) return undefined;
  const info = resolveHoverInfo(
    token.display,
    input.dictionary,
    overridesOf(doc.metadata),
  );
  if (!isAccounted(info)) return undefined;
  const range: Range4 = [token.line, token.start, token.line, token.end];
  // The lemma is always one indexed by `forms` (it is read off a reading of the
  // same entry `forms` walked), so the paradigm is always present.
  const paradigm = forms(input.dictionary).get(info.lemma)!;
  return { range, markdown: render(info, paradigm, input.uri, range) };
};

const isAccounted = (info: HoverInfo): info is AccountedInfo =>
  info.status === "registered" || info.status === "possessive";

/** The source token whose range contains the position, if any. Reuses the
 * squiggle/suggestion source-token walk, so exempt and `[w:]`-marked tokens are
 * already absent — the hover only fires on plain, accountable words. */
const tokenAt = (
  doc: MarkitDocument,
  lines: string[],
  line: number,
  character: number,
): SourceToken | undefined => {
  for (const block of collectBlocks(doc)) {
    // Block source is a whole-line, end-exclusive range: skip the blocks that
    // cannot hold the cursor before tokenising (a lazy hover over a large
    // edition then tokenises one block, not every block).
    const source = block.source;
    if (
      source !== undefined &&
      (line < source.start.line || line >= source.end.line)
    ) {
      continue;
    }
    for (const token of blockSourceTokens(block, lines)) {
      if (
        token.line === line &&
        character >= token.start &&
        character < token.end
      ) {
        return token;
      }
    }
  }
  return undefined;
};

/* ------------------------------ rendering ------------------------------ */

/** Render an accounted token as its lemma view: the headword, the lemma's forms
 * with this token's form highlighted, and (for an ambiguous surface) the other
 * lemmas, each a pin link when the surface can carry `[w:]`. */
const render = (
  info: AccountedInfo,
  paradigm: string[],
  uri: string,
  range: Range4,
): string => {
  const parts: string[] = [];
  const possessive = info.status === "possessive" ? " · possessive" : "";
  parts.push(`**${escape(info.lemma)}** · lemma${possessive}`);
  parts.push(
    paradigm
      .map((form) =>
        form === info.form ? `**${escape(form)}**` : escape(form),
      )
      .join(" · "),
  );
  if (info.overridden) {
    parts.push("_reading pinned by this edition_");
  }
  if (info.others.length > 0) {
    const items = info.others
      .map((other) => otherLemmaLink(other, uri, range))
      .join(" · ");
    parts.push(`other readings: ${items}`);
  }
  return parts.join("\n\n");
};

/** One alternative lemma: a command link when it can be pinned, plain text
 * otherwise. The spelling is shown in parentheses only when it differs from the
 * lemma (telling apart two readings that share a headword). */
const otherLemmaLink = (
  other: OtherReading,
  uri: string,
  range: Range4,
): string => {
  const label =
    other.lemma === other.spelling
      ? other.lemma
      : `${other.lemma} (${other.spelling})`;
  if (other.value === undefined) return escape(label);
  const args: PinArgs = { uri, range, value: other.value };
  const encoded = encodeURIComponent(JSON.stringify(args));
  return `[${escape(label)}](command:${PIN_COMMAND}?${encoded})`;
};

/** Escape the Markdown-significant characters a printed word or reading might
 * carry, so it renders literally in the hover. */
const escape = (text: string): string =>
  text.replace(/[\\`*_[\]<>]/g, (char) => `\\${char}`);

/* -------------------------------- caching ------------------------------- */

export type CompileMemo = (
  key: string,
  text: string,
) => { doc: MarkitDocument; lines: string[] };

/** A single-entry compile memo keyed by an opaque (uri, version) string: a
 * burst of hovers over one unchanged document compiles it once. */
export const createCompileMemo = (): CompileMemo => {
  let last: { key: string; doc: MarkitDocument; lines: string[] } | undefined;
  return (key, text) => {
    if (last?.key === key) return last;
    const { document: doc } = compileWithPositions(text);
    last = { key, doc, lines: text.split("\n") };
    return last;
  };
};

export type FormsCache = (dictionary: Dictionary) => Map<string, string[]>;

/** The register's lemma paradigms, indexed once per catalogue: the dictionary
 * object identity is the cache key, so a reload (a fresh catalogue) rebuilds and
 * an unchanged one is reused across every hover. */
export const createFormsCache = (): FormsCache => {
  let last:
    { dictionary: Dictionary; index: Map<string, string[]> } | undefined;
  return (dictionary) => {
    if (last?.dictionary !== dictionary) {
      last = { dictionary, index: lemmaForms(dictionary) };
    }
    return last.index;
  };
};
