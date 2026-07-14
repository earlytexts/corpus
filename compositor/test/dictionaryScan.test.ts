/**
 * The dictionary accounting scan: locating the surfaces the corpus's
 * `accountTokens` rule leaves unaccounted (no entry) in a document's source.
 * The decision is the corpus's — exercised thoroughly in the corpus's own
 * tests — so these cases pin down the location layer: that markup exemptions,
 * mechanical classes, and `[w:]` disambiguation are respected (via the shared
 * tokenizer), that every real occurrence is flagged with the right range, and
 * that a fully accounted document is silent.
 */

import { expect, test } from "vitest";
import { compile } from "@jsr/earlytexts__markit";
import {
  type Dictionary,
  expandDictionary,
  parseDictionary,
} from "@earlytexts/corpus";
import {
  scanUnaccounted,
  type UnaccountedWord,
  unaccountedSurfaces,
} from "../src/lib/dictionaryScan.ts";

/** Build an expanded dictionary from on-disk micro-syntax, the real pipeline. */
const dict = (entries: Record<string, unknown>): Dictionary =>
  expandDictionary(
    parseDictionary(new Map([["_.json", JSON.stringify(entries)]])).dictionary,
  );

/** Compile a body under a single `{#1}` block; text starts on line 4 (0-based
 * line 3 is the block tag, line 4 the first content line). */
const doc = (body: string) =>
  compile(`# t\n\n[metadata]\ntitle = "t"\n\n{#1}\n${body}\n`);

const scan = (
  body: string,
  entries: Record<string, unknown>,
): UnaccountedWord[] => {
  const source = `# t\n\n[metadata]\ntitle = "t"\n\n{#1}\n${body}\n`;
  const [document] = compile(source);
  return scanUnaccounted(source, document, dict(entries));
};

test("flags a plain word with no dictionary entry", () => {
  const found = scan("The wombat sleeps.", { the: null, sleeps: null });
  expect(found.map((w) => w.surface)).toEqual(["wombat"]);
  expect(found[0]!.display).toBe("wombat");
});

test("says nothing when every word is accounted", () => {
  expect(scan("The virtue.", { the: null, virtue: null })).toEqual([]);
});

test("does not flag a word that has a dictionary entry", () => {
  // A registered surface (here a respelling with its own modern entry) is
  // accounted, so it is never squiggled.
  const found = scan("compleat vertue", {
    compleat: "complete",
    complete: null,
    vertue: "virtue",
    virtue: null,
  });
  expect(found).toEqual([]);
});

test("does not flag words inside exempting markup (person, citation)", () => {
  const found = scan("Praised by [p:Machiavel] in [A Discourse].", {
    praised: null,
    by: null,
    in: null,
  });
  expect(found).toEqual([]);
});

test("does not flag mechanical tokens (numbers, roman numerals)", () => {
  const found = scan("Book iv, page 42.", { book: null, page: null });
  expect(found).toEqual([]);
});

test("does not flag a word disambiguated by single-token [w:] markup", () => {
  // `then` has an entry (ambiguous), so it is accounted either way; the point
  // is the [w:] occurrence is never treated as an unknown surface.
  const found = scan("Sooner [w:then=than] later.", {
    sooner: null,
    later: null,
    then: [null, "than"],
    than: null,
  });
  expect(found).toEqual([]);
});

test("multi-token [w:] surface is accounted by the markup, not flagged", () => {
  const found = scan("See you [w:to morrow=tomorrow].", {
    see: null,
    you: null,
  });
  expect(found).toEqual([]);
});

test("flags every occurrence, each with its own range", () => {
  const found = scan("wombat and wombat", { and: null });
  expect(found).toHaveLength(2);
  expect(found.map((w) => w.startColumn)).toEqual([0, 11]);
  expect(found.every((w) => w.line === 6)).toBe(true);
  expect(found.map((w) => w.endColumn)).toEqual([6, 17]);
});

test("an unaccounted contraction keeps its apostrophe in the surface", () => {
  const found = scan("'twere good", { good: null });
  expect(found.map((w) => w.surface)).toEqual(["'twere"]);
});

test("folds case for matching but reports the printed form", () => {
  const found = scan("Wombat WOMBAT", {});
  expect(found.map((w) => w.surface)).toEqual(["wombat", "wombat"]);
  expect(found.map((w) => w.display)).toEqual(["Wombat", "WOMBAT"]);
});

test("unaccountedSurfaces collects the folded surfaces with no entry", () => {
  const [document] = doc("known also unknown");
  const surfaces = unaccountedSurfaces(document, dict({ known: null }));
  expect([...surfaces].sort()).toEqual(["also", "unknown"]);
});
