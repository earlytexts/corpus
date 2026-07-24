/**
 * The resolution rule behind adding a dictionary entry from the editor: how a
 * respelling/lemma target is classified (already registered, added here, or
 * refused), and the corpus vocabulary a respelling target must appear in.
 * Pure — the editor layer drives the prompts around these decisions.
 */

import { expect, test } from "vitest";
import { buildCatalogue, loadCorpus } from "@earlytexts/corpus";
import { CORPUS_ROOT, corpus, memoryCorpus } from "@earlytexts/corpus/test";
import {
  corpusVocabulary,
  resolveLemmaTarget,
  resolveSpellingTarget,
  vocabularyFromFiles,
} from "../src/lib/dictionaryResolve.ts";

const yes = () => true;
const no = () => false;

test("a target that already has an entry is resolved, whatever its role", () => {
  expect(resolveSpellingTarget("virtue", yes, no)).toEqual({
    kind: "resolved",
  });
  expect(resolveLemmaTarget("virtue", yes, no)).toEqual({ kind: "resolved" });
});

test("an attested respelling target is offered as a modern word or a lemma", () => {
  // Never as another respelling — that would be a chain the register forbids.
  expect(resolveSpellingTarget("virtue", no, yes)).toEqual({
    kind: "prompt",
    choices: ["modern", "lemma"],
  });
});

test("an unattested respelling target is rejected", () => {
  // Orthography is drawn from the texts: a respelling must point to a printed
  // spelling. The archaic form should itself be canonical instead.
  expect(resolveSpellingTarget("virtue", no, no)).toEqual({ kind: "reject" });
});

test("an attested lemma is added as a modern word, no choice to make", () => {
  expect(resolveLemmaTarget("increase", no, yes)).toEqual({
    kind: "add",
    value: null,
  });
});

test("an unattested lemma is allowed only on confirmation", () => {
  // A citation form may be unprinted (datum for data), so it is not refused —
  // but it is confirmed, not added silently.
  expect(resolveLemmaTarget("datum", no, no)).toEqual({ kind: "confirm" });
});

const fixtureOf = (text: string): Record<string, string> =>
  corpus()
    .author("hume", { forename: "David", surname: "Hume" })
    .work("hume", "enquiry", {
      title: "An Enquiry",
      breadcrumb: "Enquiry",
      canonical: "1748",
    })
    .edition(
      "hume",
      "enquiry",
      "1748",
      {
        imported: false,
        title: "An Enquiry",
        breadcrumb: "Enquiry",
        published: [1748],
      },
      text,
    )
    .build();

const vocabulary = async (text: string): Promise<Set<string>> => {
  const { catalogue } = await buildCatalogue(
    memoryCorpus(fixtureOf(text)),
    CORPUS_ROOT,
  );
  return corpusVocabulary(catalogue);
};

test("corpusVocabulary folds every word token but drops the mechanical ones", async () => {
  const vocab = await vocabulary("{#1}\nThe Wombat sleeps in 1739 and MDCCXL.");
  expect(vocab.has("wombat")).toBe(true); // folded
  expect(vocab.has("the")).toBe(true);
  expect(vocab.has("sleeps")).toBe(true);
  expect(vocab.has("1739")).toBe(false); // digits are mechanical
  expect(vocab.has("mdccxl")).toBe(false); // a roman numeral is mechanical
});

test("vocabularyFromFiles reproduces corpusVocabulary from the derivations", async () => {
  // The same set the quick-fix needs, but read off the per-file derivations
  // (surfaces ∪ exemptSurfaces over works/ files) rather than re-walking every
  // edition — exempting markup, folding, and mechanical exclusion all agree.
  const text =
    "{#1}\nThe Wombat sleeps in [p:*Will*] on MDCCXL, page 42; the bishop's cat.";
  const fixture = memoryCorpus(fixtureOf(text));
  const { catalogue } = await buildCatalogue(fixture, CORPUS_ROOT);
  const files = await loadCorpus(fixture, CORPUS_ROOT);
  const fromFiles = vocabularyFromFiles(files);
  expect(fromFiles).toEqual(corpusVocabulary(catalogue));
  expect(fromFiles.has("will")).toBe(true); // exempt but printed
  expect(fromFiles.has("wombat")).toBe(true);
  expect(fromFiles.has("bishop's")).toBe(true); // possessive, own key
  expect(fromFiles.has("mdccxl")).toBe(false); // mechanical
  expect(fromFiles.has("42")).toBe(false);
});
