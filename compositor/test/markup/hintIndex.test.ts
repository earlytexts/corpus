/**
 * The refcounted hint fold: the corpus-wide lexicons maintained as a sum of
 * per-file contributions rather than re-mined from scratch. The property that
 * matters is equivalence — folding the files one at a time, in any order and
 * with replacements, must produce exactly what one whole-corpus `buildHintsFrom`
 * produces over the same documents. The rest pins down the delta arithmetic:
 * a replaced file's old markup goes away, a phrase two files attest survives
 * losing one of them, and the classification is memoised until something moves.
 */

import { expect, test } from "vitest";
import {
  compileWithPositions,
  type MarkitDocument,
} from "@jsr/earlytexts__markit";
import {
  buildHintsFrom,
  hintContribution,
  type WordFrequencies,
} from "../../src/core/markup/hints.ts";
import { createHintIndex } from "../../src/core/markup/hintIndex.ts";

const docOf = (source: string): MarkitDocument =>
  compileWithPositions(source).document;

/** Sum the per-document frequency baselines, as a full mine would. */
const baselineOf = (docs: MarkitDocument[]): WordFrequencies => {
  const unmarked = new Map<string, number>();
  const unmarkedLower = new Map<string, number>();
  for (const doc of docs) {
    const { frequencies } = hintContribution(doc);
    for (const [word, n] of frequencies.unmarked) {
      unmarked.set(word, (unmarked.get(word) ?? 0) + n);
    }
    for (const [word, n] of frequencies.unmarkedLower) {
      unmarkedLower.set(word, (unmarkedLower.get(word) ?? 0) + n);
    }
  }
  return { unmarked, unmarkedLower };
};

/** The index seeded with every document, as the first full mine leaves it. */
const seeded = (sources: Record<string, string>) => {
  const docs = Object.entries(sources).map(([path, text]) => ({
    path,
    doc: docOf(text),
  }));
  const index = createHintIndex();
  index.rebase(baselineOf(docs.map((d) => d.doc)));
  for (const { path, doc } of docs) {
    index.set(path, hintContribution(doc).marked);
  }
  return { index, docs };
};

const CORPUS: Record<string, string> = {
  "works/a.mit": [
    "# A",
    "",
    "{#1}",
    "Of [p:David Hume] and the [o:Royal Society] in [l:Edinburgh].",
    "He wrote in $la:de rerum natura$ often, in truth.",
    "",
  ].join("\n"),
  "works/b.mit": [
    "# B",
    "",
    "{#1}",
    "Again [p:David Hume], and also [p:John Locke] of [l:London].",
    "See [Sect. II] and $la:de rerum$ once more.",
    "",
  ].join("\n"),
  "works/c.mit": [
    "# C",
    "",
    "{#1}",
    "A page of plain English text with nothing marked up at all.",
    "",
  ].join("\n"),
};

const AUTHORS = [{ forename: "David", surname: "Hume" }];
const WORKS = [{ title: "An Enquiry" }];

/* ----------------------------- equivalence ----------------------------- */

test("folding the files one at a time equals mining them all at once", () => {
  const { index, docs } = seeded(CORPUS);

  expect(index.hints(AUTHORS, WORKS)).toEqual(
    buildHintsFrom(
      docs.map((d) => d.doc),
      AUTHORS,
      WORKS,
    ),
  );
});

test("the fold is order-independent and survives replacing a file in place", () => {
  // The order files are saved in, and how often, must not change the result.
  const { index } = seeded(CORPUS);
  const reference = index.hints(AUTHORS, WORKS);

  const shuffled = createHintIndex();
  shuffled.rebase(baselineOf(Object.values(CORPUS).map(docOf)));
  for (const path of ["works/c.mit", "works/b.mit", "works/a.mit"]) {
    shuffled.set(path, hintContribution(docOf(CORPUS[path])).marked);
  }
  // A re-save of an unchanged file is a no-op, not a doubling.
  shuffled.set(
    "works/b.mit",
    hintContribution(docOf(CORPUS["works/b.mit"])).marked,
  );

  expect(shuffled.hints(AUTHORS, WORKS)).toEqual(reference);
});

test("replacing a file's markup drops the phrases only it attested", () => {
  const { index } = seeded(CORPUS);
  expect(index.hints(AUTHORS, WORKS).people.has("john")).toBe(true);

  // b.mit loses John Locke; nothing else attests him.
  index.set(
    "works/b.mit",
    hintContribution(docOf("# B\n\n{#1}\nJust [l:London] now.\n")).marked,
  );

  expect(index.hints(AUTHORS, WORKS).people.has("john")).toBe(false);
});

test("a phrase two files attest survives losing one of them", () => {
  const { index } = seeded(CORPUS);
  index.remove("works/b.mit");
  const hints = index.hints(AUTHORS, WORKS);

  // Both files marked up David Hume; only b.mit marked up London.
  expect(hints.people.get("david")).toEqual([["david", "hume"]]);
  expect(hints.places.has("london")).toBe(false);
  expect(hints.places.has("edinburgh")).toBe(true);
});

test("removing every file leaves only what the metadata seeds", () => {
  const { index } = seeded(CORPUS);
  for (const path of Object.keys(CORPUS)) index.remove(path);
  const hints = index.hints(AUTHORS, WORKS);

  expect(hints).toEqual(buildHintsFrom([], AUTHORS, WORKS));
  // The seeds are still there — the lexicons emptied, they did not vanish.
  expect(hints.people.has("hume")).toBe(true);
});

test("removing a file the index never held changes nothing", () => {
  const { index } = seeded(CORPUS);
  const before = index.hints(AUTHORS, WORKS);
  index.remove("works/never.mit");

  expect(index.hints(AUTHORS, WORKS)).toEqual(before);
});

/* ---------------------------- language counts ---------------------------- */

test("a language word's count falls back to zero and drops out with its file", () => {
  const { index } = seeded(CORPUS);
  expect(index.hints(AUTHORS, WORKS).languages.get("la")).toBeDefined();

  index.remove("works/a.mit");
  index.remove("works/b.mit");

  // No Latin span left anywhere: the language goes, rather than lingering empty.
  expect(index.hints(AUTHORS, WORKS).languages.has("la")).toBe(false);
});

test("a word marked in two files stays after one drops out", () => {
  const { index } = seeded(CORPUS);
  index.remove("works/b.mit");
  const la = index.hints(AUTHORS, WORKS).languages.get("la");

  // "natura" was only in a.mit, "de"/"rerum" in both — a.mit survives.
  expect(la?.strong.has("natura") || la?.weak.has("natura")).toBe(true);
});

/* ------------------------------ the baseline ------------------------------ */

test("rebasing the frequencies reclassifies without re-folding the markup", () => {
  const { index } = seeded(CORPUS);
  const strongBefore = index.hints(AUTHORS, WORKS).languages.get("la")!.strong;
  expect(strongBefore.has("rerum")).toBe(true);

  // Pretend "rerum" is everywhere in unmarked English: it becomes a homograph.
  index.rebase({
    unmarked: new Map([["rerum", 500]]),
    unmarkedLower: new Map([["rerum", 500]]),
  });
  const la = index.hints(AUTHORS, WORKS).languages.get("la")!;

  expect(la.strong.has("rerum")).toBe(false);
  expect(la.weak.has("rerum")).toBe(true);
});

/* ------------------------------- memoising ------------------------------- */

test("hints are memoised until something actually moves", () => {
  const { index } = seeded(CORPUS);
  const first = index.hints(AUTHORS, WORKS);
  expect(index.hints(AUTHORS, WORKS)).toBe(first);

  // A new catalogue identity (new seeds) has to re-classify.
  expect(index.hints([...AUTHORS], WORKS)).not.toBe(first);

  const second = index.hints(AUTHORS, WORKS);
  index.set(
    "works/c.mit",
    hintContribution(docOf("# C\n\n{#1}\nBy [p:New Name].\n")).marked,
  );
  expect(index.hints(AUTHORS, WORKS)).not.toBe(second);
});

test("a rebase invalidates the memo too", () => {
  const { index } = seeded(CORPUS);
  const first = index.hints(AUTHORS, WORKS);
  index.rebase({ unmarked: new Map(), unmarkedLower: new Map() });

  expect(index.hints(AUTHORS, WORKS)).not.toBe(first);
});

/* ----------------------------- contributions ----------------------------- */

test("a contribution counts a phrase a file repeats only once", () => {
  // Refcounts are per file, not per occurrence: a name used twice in one file
  // must not survive that file being removed.
  const { marked } = hintContribution(
    docOf("# A\n\n{#1}\nBy [p:Mr Twice] and again [p:Mr Twice] here.\n"),
  );

  expect(marked.people).toEqual([["mr", "twice"]]);
});

test("a marked span with no usable words contributes no phrase", () => {
  // A one-letter span folds to nothing the lexicons can match on, so it must
  // not enter the contribution as an empty phrase every file would share.
  const { marked } = hintContribution(docOf("# A\n\n{#1}\nSee [p:A] there.\n"));

  expect(marked.people).toEqual([]);
});

test("a contribution reaches a document's children", () => {
  const child = docOf("# C\n\n{#1}\nBy [p:Mr Child] here.\n");
  const parent = {
    ...docOf("# P\n\n{#1}\nBy [p:Mr Parent] here.\n"),
    children: [child],
  };

  expect(hintContribution(parent).marked.people).toEqual([
    ["mr", "parent"],
    ["mr", "child"],
  ]);
});
