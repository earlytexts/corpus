/**
 * The token-accounting hover's core: `resolveHoverInfo` accounting for one
 * printed word against the register, and `lemmaForms` indexing the register's
 * paradigms. The accounting decisions are the corpus's (exercised in its own
 * tests); these cases pin down what the hover adds — that the resolved lemma and
 * its highlighted form are read off the entry, that an edition override moves the
 * current reading, that a possessive is carried by its base, that mechanical and
 * unaccounted tokens fall through to a bare status, and that each alternative's
 * pin value uniquely round-trips to its reading (or is withheld when it cannot).
 */

import { expect, test } from "vitest";
import {
  type Dictionary,
  expandDictionary,
  parseDictionary,
  readingLemma,
  selectReading,
} from "@earlytexts/corpus";
import { lemmaForms, resolveHoverInfo } from "../src/lib/hoverInfo.ts";

/** Build an expanded dictionary from on-disk micro-syntax, the real pipeline. */
const dict = (entries: Record<string, unknown>): Dictionary =>
  expandDictionary(
    parseDictionary(new Map([["_.json", JSON.stringify(entries)]])).dictionary,
  );

test("a registered respelling resolves to its lemma and highlighted form", () => {
  const info = resolveHoverInfo(
    "vertue",
    dict({ vertue: "virtue", virtue: null }),
    {},
  );
  expect(info).toMatchObject({
    status: "registered",
    surface: "vertue",
    display: "vertue",
    lemma: "virtue",
    form: "virtue",
    ambiguous: false,
    overridden: false,
    others: [],
  });
});

test("folds the printed word to its surface but keeps the display", () => {
  const info = resolveHoverInfo(
    "Vertue",
    dict({ vertue: "virtue", virtue: null }),
    {},
  );
  expect(info).toMatchObject({
    surface: "vertue",
    display: "Vertue",
    form: "virtue",
  });
});

test("an inflected surface reports its lemma and its own form", () => {
  // `went` is a form of the lemma `go`; the hover highlights `went`.
  const info = resolveHoverInfo("went", dict({ went: "=go", go: null }), {});
  expect(info).toMatchObject({ lemma: "go", form: "went", ambiguous: false });
});

test("an ambiguous surface reports the default lemma and offers the others", () => {
  const info = resolveHoverInfo(
    "lay",
    dict({ lay: [null, "lie"], lie: null }),
    {},
  );
  expect(info).toMatchObject({
    status: "registered",
    ambiguous: true,
    overridden: false,
    lemma: "lay",
    form: "lay",
    others: [{ lemma: "lie", spelling: "lie", value: "lie" }],
  });
});

test("an edition override moves the current reading and marks it pinned", () => {
  const dictionary = dict({ humane: [null, "human"], human: null });
  const info = resolveHoverInfo("humane", dictionary, { humane: "human" });
  expect(info).toMatchObject({
    ambiguous: true,
    overridden: true,
    lemma: "human",
    form: "human",
    others: [{ lemma: "humane", spelling: "humane", value: "humane" }],
  });
});

test("an invalid override falls through to the default, unpinned", () => {
  const dictionary = dict({ lay: [null, "lie"], lie: null });
  const info = resolveHoverInfo("lay", dictionary, { lay: "nonsense" });
  expect(info).toMatchObject({ lemma: "lay", overridden: false });
});

test("a possessive is carried by its base, with the clitic split off", () => {
  const info = resolveHoverInfo("bishop's", dict({ bishop: null }), {});
  expect(info).toMatchObject({
    status: "possessive",
    lemma: "bishop",
    form: "bishop",
    clitic: "'s",
    ambiguous: false,
    others: [],
  });
});

test("a possessive of an ambiguous base is ambiguous but not pinnable", () => {
  // `[w:]` on a surface with no entry of its own is invalid, so no pin value.
  const info = resolveHoverInfo(
    "tear's",
    dict({ tear: [null, "rip"], rip: null }),
    {},
  );
  expect(info).toMatchObject({
    status: "possessive",
    ambiguous: true,
    lemma: "tear",
    others: [{ lemma: "rip", spelling: "rip" }],
  });
  expect(info.status === "possessive" && info.others[0]!.value).toBeUndefined();
});

test("a mechanical token (number, roman numeral) reports a bare status", () => {
  expect(resolveHoverInfo("42", {}, {})).toEqual({
    status: "mechanical",
    surface: "42",
    display: "42",
  });
  expect(resolveHoverInfo("IV", {}, {})).toMatchObject({
    status: "mechanical",
  });
});

test("an unknown surface is unaccounted", () => {
  expect(resolveHoverInfo("wombat", {}, {})).toEqual({
    status: "unaccounted",
    surface: "wombat",
    display: "wombat",
  });
});

test("a registered surface wins over the mechanical class (the pronoun I)", () => {
  const dictionary: Dictionary = {
    I: { readings: [[{ spelling: "I", lemma: "I" }]] },
  };
  expect(resolveHoverInfo("I", dictionary, {})).toMatchObject({
    status: "registered",
    lemma: "I",
    form: "I",
  });
});

test("the pin value falls back to the spelling when the lemma collides", () => {
  // Reading 1's lemma ("lay") also names reading 0's lemma, so selecting by
  // lemma is ambiguous; the spelling ("lie") is unique and is used instead.
  const dictionary: Dictionary = {
    lay: {
      readings: [
        [{ spelling: "lay", lemma: "lay" }],
        [{ spelling: "lie", lemma: "lay" }],
      ],
    },
  };
  const info = resolveHoverInfo("lay", dictionary, {});
  expect(info.status === "registered" && info.others[0]).toMatchObject({
    lemma: "lay",
    spelling: "lie",
    value: "lie",
  });
});

test("no pin value is offered when neither the lemma nor the spelling is unique", () => {
  const dictionary: Dictionary = {
    dup: {
      readings: [
        [{ spelling: "a", lemma: "a" }],
        [{ spelling: "a", lemma: "a" }],
      ],
    },
  };
  const info = resolveHoverInfo("dup", dictionary, {});
  expect(info.status === "registered" && info.ambiguous).toBe(true);
  expect(info.status === "registered" && info.others[0]!.value).toBeUndefined();
});

test("an offered pin value round-trips to exactly its reading", () => {
  const dictionary = dict({ lay: [null, "lie"], lie: null });
  const info = resolveHoverInfo("lay", dictionary, {});
  const value = info.status === "registered" ? info.others[0]!.value! : "";
  const reading = selectReading(dictionary.lay!, value);
  expect(reading && readingLemma(reading)).toBe("lie");
});

test("lemmaForms gathers every modern spelling of a lemma, sorted and distinct", () => {
  // go / goes / going / went all lemmatise to `go`; goeth respells to goes, so
  // it contributes no new form. The paradigm is the distinct spellings, sorted.
  const forms = lemmaForms(
    dict({
      go: null,
      goes: "=go",
      goeth: "goes",
      going: "=go",
      went: "=go",
      cat: null,
    }),
  );
  expect(forms.get("go")).toEqual(["go", "goes", "going", "went"]);
  expect(forms.get("cat")).toEqual(["cat"]);
});

test("the highlighted form is always one of its lemma's paradigm forms", () => {
  const dictionary = dict({ went: "=go", go: null, goes: "=go" });
  const info = resolveHoverInfo("went", dictionary, {});
  const paradigm = lemmaForms(dictionary).get("go");
  expect(info.status === "registered" && paradigm!.includes(info.form)).toBe(
    true,
  );
});
