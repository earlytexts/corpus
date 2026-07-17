/**
 * Validating the panel's add-control input into a single-surface edit: a lemma
 * headword (`null`), an inflected form (`=lemma`), or a variant cross-reference
 * (the modern spelling value). Folding is the corpus's; these cases pin the
 * per-field word counts and the rejections.
 */

import { expect, test } from "vitest";
import {
  formEntry,
  lemmaEntry,
  variantEntry,
} from "../src/lib/dictionaryPanelInput.ts";

test("lemmaEntry writes a single folded word as a modern headword", () => {
  expect(lemmaEntry("  Increase ")).toEqual({
    surface: "increase",
    value: null,
  });
});

test("lemmaEntry rejects empty or multi-word input", () => {
  expect(lemmaEntry("   ")).toEqual({
    error: "Enter a single word for the lemma.",
  });
  expect(lemmaEntry("two words")).toEqual({
    error: "Enter a single word for the lemma.",
  });
});

test("lemmaEntry rejects a non-word", () => {
  expect(lemmaEntry("a1")).toEqual({
    error: "Enter a single word for the lemma.",
  });
});

test("formEntry writes =lemma for a distinct form", () => {
  expect(formEntry("go", "Went")).toEqual({ surface: "went", value: "=go" });
});

test("formEntry folds the lemma it points at", () => {
  expect(formEntry("Bear", "bore")).toEqual({
    surface: "bore",
    value: "=bear",
  });
});

test("formEntry rejects a form equal to its lemma", () => {
  expect(formEntry("go", "go")).toEqual({
    error: "A form must differ from its lemma.",
  });
});

test("formEntry rejects empty or multi-word input", () => {
  expect(formEntry("go", "")).toEqual({
    error: "Enter a single word for the form.",
  });
});

test("variantEntry writes a single modern spelling", () => {
  expect(variantEntry("Shew", "show")).toEqual({
    surface: "shew",
    value: "show",
  });
});

test("variantEntry joins a contraction's words into one value", () => {
  expect(variantEntry("'tis", "it is")).toEqual({
    surface: "'tis",
    value: "it is",
  });
});

test("variantEntry rejects a missing surface", () => {
  expect(variantEntry("", "show")).toEqual({
    error: "Enter a single word for the variant spelling.",
  });
});

test("variantEntry rejects a missing spelling", () => {
  expect(variantEntry("shew", "  ")).toEqual({
    error: "Enter the modern spelling (one or more words).",
  });
});

test("variantEntry rejects a spelling equal to the surface", () => {
  expect(variantEntry("show", "show")).toEqual({
    error: "A variant must point at a different spelling.",
  });
});
