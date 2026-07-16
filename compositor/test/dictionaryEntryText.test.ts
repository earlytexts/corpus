/**
 * Pure text/validation for the dictionary overlay: the entry-input parser
 * (fold + word check), the squiggle message, and the quick-fix titles that
 * used to live inside surface/commands/dictionaryDiagnostics.ts.
 */

import { expect, test } from "vitest";
import {
  addTargetTitle,
  entryActionTitle,
  entryWords,
  unaccountedMessage,
  unattestedLemmaMessage,
  unattestedRejectMessage,
} from "../src/lib/dictionaryEntryText.ts";

test("entryWords folds a single word", () => {
  expect(entryWords("Virtue")).toEqual(["virtue"]);
});

test("entryWords splits and folds a multi-word expansion", () => {
  expect(entryWords("It Is")).toEqual(["it", "is"]);
});

test("entryWords keeps apostrophes but rejects digits", () => {
  expect(entryWords("don't")).toEqual(["don't"]);
  expect(entryWords("abc123")).toEqual([]);
});

test("entryWords rejects the whole input if any token is not a word", () => {
  expect(entryWords("valid b3d valid")).toEqual([]);
});

test("entryWords treats blank input as empty", () => {
  expect(entryWords("   ")).toEqual([]);
  expect(entryWords("")).toEqual([]);
});

test("unaccountedMessage reports the unknown surface", () => {
  expect(unaccountedMessage({ display: "vertue" })).toBe(
    "“vertue” is not in the dictionary.",
  );
});

test("addTargetTitle names the target needing an entry", () => {
  expect(addTargetTitle("virtue")).toBe(
    "“virtue” has no entry yet — add it as",
  );
});

test("unattestedRejectMessage refuses an unattested respelling target", () => {
  expect(unattestedRejectMessage("virtue")).toContain(
    "“virtue” is not in the dictionary or the corpus",
  );
});

test("unattestedLemmaMessage asks to confirm an unprinted citation form", () => {
  expect(unattestedLemmaMessage("datum")).toContain(
    "“datum” never appears in the corpus",
  );
});

test("entryActionTitle covers every curation action", () => {
  expect(entryActionTitle("vertue", "modern")).toBe(
    "Add “vertue” to the dictionary (modern word)",
  );
  expect(entryActionTitle("vertue", "respell")).toBe(
    "Add “vertue” as a respelling…",
  );
  expect(entryActionTitle("vertue", "lemma")).toBe(
    "Add “vertue” with a lemma…",
  );
});
