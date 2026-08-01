/**
 * The token-accounting hover assembled as data: `buildHover` locating the token
 * under the cursor, resolving it against the register, and rendering the lemma
 * view (headword, highlighted paradigm form, edition-pin note, other-reading pin
 * links, Markdown escaping) — plus the compile and forms memos that let a burst
 * of hovers over one unchanged document do the work once. Over real markit
 * compiles and real expanded dictionaries; only the editor layer is absent.
 */

import { expect, test } from "vitest";
import {
  type Dictionary,
  expandDictionary,
  parseDictionary,
} from "@earlytexts/corpus";
import {
  buildHover,
  type CompileMemo,
  createCompileMemo,
  createFormsCache,
  type FormsCache,
  PIN_COMMAND,
} from "../../src/core/hover/view.ts";

/** An expanded dictionary from on-disk micro-syntax — the real pipeline. */
const dict = (entries: Record<string, unknown>): Dictionary =>
  expandDictionary(
    parseDictionary(new Map([["_.json", JSON.stringify(entries)]])).dictionary,
  );

/** A one-block edition source; `meta` slots extra `[metadata.*]` lines in
 * before the block. */
const mit = (body: string, meta = ""): string =>
  `# t\n\n[metadata]\ntitle = "t"\n${meta}\n{#1}\n${body}\n`;

/** The (line, character) just inside the first occurrence of `word` within the
 * block body — skipping the metadata header, where a surface may also appear as
 * an override key. */
const posOf = (
  text: string,
  word: string,
): { line: number; character: number } => {
  const lines = text.split("\n");
  const body = lines.findIndex((line) => line.startsWith("{#"));
  for (let line = body + 1; line < lines.length; line++) {
    const at = lines[line]!.indexOf(word);
    if (at >= 0) return { line, character: at + 1 };
  }
  throw new Error(`"${word}" not found`);
};

/** Build a hover over `body` at `word`, with fresh memos unless supplied. */
const hover = (
  body: string,
  word: string,
  dictionary: Dictionary,
  meta = "",
  memos: { compile?: CompileMemo; forms?: FormsCache } = {},
) => {
  const text = mit(body, meta);
  return buildHover(
    {
      uri: "file:///t.mit",
      version: 1,
      text,
      ...posOf(text, word),
      dictionary,
    },
    memos.compile ?? createCompileMemo(),
    memos.forms ?? createFormsCache(),
  );
};

/* ------------------------------ hits & misses --------------------------- */

test("a registered respelling renders its lemma view over the token's range", () => {
  const view = hover(
    "The vertue sleeps.",
    "vertue",
    dict({
      vertue: "virtue",
      virtue: null,
    }),
  );
  expect(view).toBeDefined();
  // The range covers exactly "vertue" (0-based, end-exclusive): line 6, cols 4–10.
  expect(view!.range).toEqual([6, 4, 6, 10]);
  expect(view!.markdown).toContain("**virtue** · lemma");
  // The token's own form is the highlighted paradigm entry.
  expect(view!.markdown).toContain("**virtue**");
});

test("the cursor off any token yields no hover", () => {
  // Character 3 sits on the space after "The".
  const text = mit("The vertue sleeps.");
  const view = buildHover(
    {
      uri: "file:///t.mit",
      version: 1,
      text,
      line: 6,
      character: 3,
      dictionary: dict({ vertue: "virtue", virtue: null }),
    },
    createCompileMemo(),
    createFormsCache(),
  );
  expect(view).toBeUndefined();
});

test("an unaccounted token gets no lemma hover", () => {
  const view = hover(
    "The wombat sleeps.",
    "wombat",
    dict({
      the: null,
      sleeps: null,
    }),
  );
  expect(view).toBeUndefined();
});

test("blocks that cannot hold the cursor are skipped before tokenising", () => {
  // Two blocks: a hover in one must ignore the other (the one before the cursor
  // by end line, the one after it by start line) rather than tokenise it.
  const dictionary = dict({ vertue: "virtue", virtue: null });
  const text = mit("The vertue sleeps.\n\n{#2}\nA vertue wakes.");
  const lines = text.split("\n");
  const first = lines.findIndex((l) => l.includes("The vertue"));
  const second = lines.findIndex((l) => l.includes("A vertue"));
  const make = (line: number) =>
    buildHover(
      {
        uri: "file:///t.mit",
        version: 1,
        text,
        line,
        character: lines[line]!.indexOf("vertue") + 1,
        dictionary,
      },
      createCompileMemo(),
      createFormsCache(),
    );
  // In the second block: the first block ends before the cursor line, skipped.
  expect(make(second)!.range[0]).toBe(second);
  // In the first block: the second block starts after the cursor line, skipped.
  expect(make(first)!.range[0]).toBe(first);
});

/* ----------------------------- other readings --------------------------- */

test("an ambiguous surface lists its other readings as pin links", () => {
  const view = hover(
    "They lay down.",
    "lay",
    dict({
      lay: [null, "lie"],
      lie: null,
    }),
  );
  expect(view!.markdown).toContain("**lay** · lemma");
  expect(view!.markdown).toContain("other readings:");
  expect(view!.markdown).toContain(`command:${PIN_COMMAND}?`);
  // The alternative's pin value round-trips to "lie".
  expect(view!.markdown).toContain("lie");
});

test("an other reading whose spelling differs from its lemma shows both, escaped", () => {
  // Reading 1 shares reading 0's lemma ("lay") but a distinct spelling that
  // carries a Markdown-significant character — exercising the parenthesised
  // label and the escape of the pin link's text.
  const dictionary: Dictionary = {
    lay: {
      readings: [
        [{ spelling: "lay", lemma: "lay" }],
        [{ spelling: "a*b", lemma: "lay" }],
      ],
    },
  };
  const view = hover("They lay down.", "lay", dictionary);
  // Label is "lay (a*b)" with the asterisk escaped, inside a command link.
  expect(view!.markdown).toContain("[lay (a\\*b)](command:");
});

test("a possessive of an ambiguous base is marked, its other reading unpinnable", () => {
  const view = hover(
    "The tear's fall.",
    "tear's",
    dict({
      tear: [null, "rip"],
      rip: null,
    }),
  );
  expect(view!.markdown).toContain("· lemma · possessive");
  // No pin value for a derived possessive: the other reading is plain text, not
  // a command link.
  expect(view!.markdown).toContain("other readings: rip");
  expect(view!.markdown).not.toContain("command:");
});

test("an edition override moves the reading and notes the pin", () => {
  const view = hover(
    "The humane spirit.",
    "humane",
    dict({ humane: [null, "human"], human: null }),
    `[metadata.dictionary]\nhumane = "human"`,
  );
  expect(view!.markdown).toContain("**human** · lemma");
  expect(view!.markdown).toContain("_reading pinned by this edition_");
});

test("a lemma carrying Markdown-significant characters is escaped", () => {
  // The resolved lemma/form is "a_b"; the underscore must be escaped so the
  // hover renders it literally rather than as emphasis.
  const dictionary: Dictionary = {
    star: { readings: [[{ spelling: "a_b", lemma: "a_b" }]] },
  };
  const view = hover("A star shines.", "star", dictionary);
  expect(view!.markdown).toContain("**a\\_b** · lemma");
});

/* -------------------------------- caches -------------------------------- */

test("the compile memo reuses the last compile for the same key", () => {
  const memo = createCompileMemo();
  const first = memo("uri\n1", "The cat.");
  // Same key, different text — the cached compile is returned unchanged.
  const again = memo("uri\n1", "ignored");
  expect(again).toBe(first);
  // A new key recompiles.
  const other = memo("uri\n2", "The cat.");
  expect(other).not.toBe(first);
});

test("the forms cache rebuilds only when the dictionary identity changes", () => {
  const cache = createFormsCache();
  const one = dict({ go: null, goes: "=go", went: "=go" });
  const index = cache(one);
  // Same dictionary object — same index.
  expect(cache(one)).toBe(index);
  expect(index.get("go")).toEqual(["go", "goes", "went"]);
  // A fresh dictionary rebuilds.
  const two = dict({ cat: null });
  expect(cache(two)).not.toBe(index);
});

test("the memos carry across a burst of hovers over one document", () => {
  const compile = createCompileMemo();
  const forms = createFormsCache();
  const dictionary = dict({ vertue: "virtue", virtue: null });
  const a = hover("The vertue sleeps.", "vertue", dictionary, "", {
    compile,
    forms,
  });
  const b = hover("The vertue sleeps.", "vertue", dictionary, "", {
    compile,
    forms,
  });
  expect(a).toEqual(b);
});
