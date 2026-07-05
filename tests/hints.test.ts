/**
 * Markup hints: the lexicons mined from existing markup (buildHints) and the
 * raw-source scanner that proposes new markup from them (scanSource). The
 * build tests use a small corpus whose word counts are chosen to exercise the
 * strong/weak classification; the scan tests feed hand-built lexicons so each
 * matching rule is pinned down independently of the classifier.
 */

import { expect, test } from "vitest";
import { compile } from "@earlytexts/markit";
import { buildCatalogue } from "../src/catalogue.ts";
import {
  buildHints,
  foldWord,
  type Hints,
  type MarkupSuggestion,
  phraseLexicon,
  scanSource,
} from "../src/hints.ts";
import { corpus, CORPUS_ROOT, memoryCorpus } from "./harness.ts";

/** @std/assert-style shims over vitest's expect, so the cases read unchanged. */
const assert: (cond: unknown, msg?: string) => asserts cond = (cond, msg) => {
  expect(cond, msg).toBeTruthy();
};
const assertEquals = <T>(actual: T, expected: T): void => {
  expect(actual).toEqual(expected);
};

/* ------------------------------ buildHints ----------------------------- */

// Unmarked text carries "in" five times, so the Latin "in" (marked twice) is
// classified weak; every other marked word never occurs unmarked, so it is
// strong. The generic (code-less) `$sundry generique$` span must be ignored.
const fixture = () =>
  corpus()
    .author("hume", { forename: "David", surname: "Hume" })
    .author("locke", { forename: "John", surname: "Locke" })
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
      [
        "{#title}",
        "^1 AN ENQUIRY",
        "",
        "{#1}",
        "Stories point by point and point by point and point again: in the " +
          "road, in the mist, in the way, in the dark, in the end.",
        "",
        "{#2}",
        "He wrote $la:quod erat in foro$ and $la:in foro conscienti{ae}$ and " +
          "$fr:J'aime le monde$ and $sundry generique$ text. [p:Mr. Cicero] " +
          "said so; compare [Pro Sexto] and [Point].",
      ].join("\n"),
    )
    .work("locke", "essay", {
      title: "Essay",
      breadcrumb: "Essay",
      canonical: "1690",
    })
    .edition(
      "locke",
      "essay",
      "1690",
      {
        imported: false,
        title: "Essay",
        breadcrumb: "Essay",
        published: [1690],
      },
      "{#1}\nNothing remarkable there.",
    );

const fixtureHints = async (
  overrides?: Parameters<typeof buildHints>[1],
): Promise<Hints> => {
  const { catalogue } = await buildCatalogue(
    memoryCorpus(fixture().build()),
    CORPUS_ROOT,
  );
  return buildHints(catalogue, overrides);
};

const hasPhrase = (
  lexicon: Map<string, string[][]>,
  ...words: string[]
): boolean =>
  (lexicon.get(words[0]) ?? []).some(
    (seq) => seq.length === words.length && seq.every((w, i) => w === words[i]),
  );

test("hints: language lexicons are mined from coded spans only", async () => {
  const hints = await fixtureHints();
  assertEquals([...hints.languages.keys()].sort(), ["fr", "la"]);
  const la = hints.languages.get("la")!;
  assert(la.strong.has("quod"));
  assert(la.strong.has("erat"));
  assert(la.strong.has("foro"));
  assert(la.weak.has("in")); // five unmarked occurrences: an English word too
  assert(!la.strong.has("in"));
  // no lexicon collects the generic span's words
  assert(!la.strong.has("generique") && !la.weak.has("generique"));
});

test("hints: lexicon words are folded (escapes, ligatures, case)", async () => {
  const hints = await fixtureHints();
  const la = hints.languages.get("la")!;
  assert(la.strong.has("conscientiae")); // from conscienti{ae}
  const fr = hints.languages.get("fr")!;
  assert(fr.strong.has("j'aime")); // from J'aime
  assert(fr.strong.has("monde"));
});

test("hints: people come from person spans and author metadata", async () => {
  const hints = await fixtureHints();
  assert(hasPhrase(hints.people, "mr", "cicero")); // [p:Mr. Cicero]
  assert(hasPhrase(hints.people, "david", "hume")); // author seeds
  assert(hasPhrase(hints.people, "hume"));
  assert(hasPhrase(hints.people, "john", "locke"));
  assert(hasPhrase(hints.people, "locke"));
});

test("hints: citations come from citation spans and work titles", async () => {
  const hints = await fixtureHints();
  assert(hasPhrase(hints.citations, "pro", "sexto")); // [Pro Sexto]
  assert(hasPhrase(hints.citations, "an", "enquiry")); // work titles
  assert(hasPhrase(hints.citations, "essay"));
});

test("hints: a single-word phrase that is an everyday word is dropped", async () => {
  const hints = await fixtureHints();
  // [Point] is marked as a citation, but "point" is ordinary lowercase text
  // five times over — matching it at every capitalised occurrence would be
  // noise. Multi-word phrases keep their everyday words.
  assert(!hasPhrase(hints.citations, "point"));
  assert(hasPhrase(hints.citations, "an", "enquiry"));
});

test("hints: overrides force classification and add unseen words", async () => {
  const hints = await fixtureHints({
    la: { weak: ["quod"], strong: ["in"], ignore: ["erat"] },
    it: { strong: ["perche"] },
  });
  const la = hints.languages.get("la")!;
  assert(la.weak.has("quod") && !la.strong.has("quod"));
  assert(la.strong.has("in") && !la.weak.has("in"));
  assert(!la.strong.has("erat") && !la.weak.has("erat"));
  assert(hints.languages.get("it")!.strong.has("perche"));
});

test("hints: foldWord folds case, marks, ligatures, and apostrophes", () => {
  assertEquals(foldWord("Cædem"), "caedem");
  assertEquals(foldWord("cœur"), "coeur");
  assertEquals(foldWord("J’AIME"), "j'aime");
  assertEquals(foldWord("vestrûm"), "vestrum");
  assertEquals(foldWord("'tis-"), "tis");
  assertEquals(foldWord("λόγος"), "λογος");
});

/* ------------------------------ scanSource ----------------------------- */

/** Hints with empty phrase lexicons and no language lexicons. */
const emptyHints = (partial?: Partial<Hints>): Hints => ({
  people: phraseLexicon([]),
  citations: phraseLexicon([]),
  languages: new Map(),
  ...partial,
});

/** A Latin lexicon for the cluster-rule tests. */
const laHints = (): Hints =>
  emptyHints({
    languages: new Map([
      [
        "la",
        {
          strong: new Set(["foro", "quod", "caedem", "vis"]),
          weak: new Set(["in", "humano", "erat", "me"]),
        },
      ],
    ]),
  });

/** Compile `source` and scan it. */
const scan = (source: string, hints: Hints): MarkupSuggestion[] => {
  const [doc] = compile(source);
  return scanSource(source, doc, hints);
};

/** Scan a one-block body under a minimal document header. */
const scanBody = (body: string, hints: Hints): MarkupSuggestion[] =>
  scan(`# T\n\n{#1}\n${body}\n`, hints);

const brief = (s: MarkupSuggestion): string =>
  `${s.type}${s.lang === undefined ? "" : `:${s.lang}`} ${s.text}`;

test("scan: a weak-word cluster anchored by a strong word matches", () => {
  const suggestions = scan("# T\n\n{#1}\nSay in foro humano now.\n", laHints());
  assertEquals(suggestions, [
    {
      type: "language",
      lang: "la",
      text: "in foro humano",
      startLine: 3,
      startColumn: 4,
      endLine: 3,
      endColumn: 18,
    },
  ]);
});

test("scan: weak words match only inside a cluster", () => {
  assertEquals(scanBody("Say in me now.", laHints()), []);
});

test("scan: a lone strong word matches only when long enough", () => {
  assertEquals(scanBody("Just vis here.", laHints()), []); // 3 letters
  assertEquals(scanBody("The word quod stands.", laHints()).map(brief), [
    "language:la quod",
  ]);
});

test("scan: text already inside markup is not re-suggested", () => {
  assertEquals(
    scanBody("He wrote $la:in foro humano$ already.", laHints()),
    [],
  );
  assertEquals(scanBody("By [p:Quod Foro] himself.", laHints()), []);
  assertEquals(scanBody("Compare [quod in foro].", laHints()), []);
});

test("scan: metadata and block tags are not scanned", () => {
  const source =
    '# T\n\n[metadata]\ntitle = "quod erat in foro"\n\n' +
    '{#1, speaker="Quod Foro"}\nEnglish only here.\n';
  assertEquals(scan(source, laHints()), []);
});

test("scan: character-mode spans fold into their words", () => {
  assertEquals(scanBody("Then c{ae}dem happened.", laHints()).map(brief), [
    "language:la c{ae}dem",
  ]);
});

test("scan: page breaks and editorial marks are word-transparent", () => {
  assertEquals(scanBody("So fo//12//ro humano falls.", laHints()).map(brief), [
    "language:la fo//12//ro humano",
  ]);
  assertEquals(scanBody("So for[+o+] humano falls.", laHints()).map(brief), [
    "language:la for[+o+] humano",
  ]);
  assertEquals(scanBody("So foro[-rum-] humano falls.", laHints()).map(brief), [
    "language:la foro[-rum-] humano",
  ]);
});

test("scan: raw-element tags are masked but their content is scanned", () => {
  assertEquals(
    scanBody(
      'It reads <<hi rend="italic">>quod foro<</hi>> plainly.',
      laHints(),
    ).map(brief),
    ["language:la quod foro"],
  );
});

test("scan: a cluster can span source lines within a block", () => {
  const suggestions = scan(
    "# T\n\n{#1}\nquod erat\nin foro semper.\n",
    laHints(),
  );
  assertEquals(suggestions, [
    {
      type: "language",
      lang: "la",
      text: "quod erat\nin foro",
      startLine: 3,
      startColumn: 0,
      endLine: 4,
      endColumn: 7,
    },
  ]);
});

test("scan: person phrases require a capital and take in their wrappers", () => {
  const hints = emptyHints({
    people: phraseLexicon(["John Locke", "Hume", "Mr. Hobbes"]),
  });
  // The emphasis is seen through when matching but travels into the match, so
  // the markup would enclose it ([p:*Hume*]).
  assertEquals(
    scanBody("Written by John Locke and *Hume*.", hints).map(brief),
    ["person John Locke", "person *Hume*"],
  );
  assertEquals(scanBody("written by john locke.", hints), []);
  assertEquals(scanBody("Says Mr. *Hobbes* here.", hints).map(brief), [
    "person Mr. *Hobbes*",
  ]);
});

test("scan: a match widens over the inline markup it sits in", () => {
  const people = emptyHints({
    people: phraseLexicon(["Machiavel", "Mr. Pope"]),
  });
  // Whole-word italics are hugged; a trailing small-caps closer is absorbed.
  assertEquals(
    scanBody("Then _Machiavel_ and Mr. *Pope* wrote.", people).map(
      (s) => s.text,
    ),
    ["_Machiavel_", "Mr. *Pope*"],
  );
  // Foreign phrases set in italics widen the same way.
  assertEquals(
    scanBody("He said _quod foro_ then.", laHints()).map((s) => s.text),
    ["_quod foro_"],
  );
  // A citation locator set in italics: the delimiters break the words for the
  // regex (softened to spaces), then the match widens back over them.
  assertEquals(
    scanBody("As _Lib._ 4 shows.", emptyHints()).map((s) => s.text),
    ["_Lib._ 4"],
  );
});

test("scan: the longest name at a position wins", () => {
  const hints = emptyHints({
    people: phraseLexicon(["Caesar", "Julius Caesar"]),
  });
  assertEquals(
    scanBody("When Julius Caesar fell.", hints).map((s) => s.text),
    ["Julius Caesar"],
  );
  assertEquals(
    scanBody("When Caesar fell.", hints).map((s) => s.text),
    ["Caesar"],
  );
});

test("scan: citation phrases and locator patterns match unmasked text", () => {
  const hints = emptyHints({ citations: phraseLexicon(["Alciphron"]) });
  assertEquals(
    scanBody(
      "Compare [Alciphron] with Alciphron and Sect. IV. here.",
      hints,
    ).map(brief),
    ["citation Alciphron", "citation Sect. IV."],
  );
  assertEquals(scanBody("Noted [Sect. IV.] once.", hints), []);
});

test("scan: a cue phrase suggests the capitalised run after it", () => {
  assertEquals(
    scanBody("See Locke Essay for details.", emptyHints()).map(brief),
    ["citation Locke Essay"],
  );
});

test("scan: Greek script and Greek mode are matched outright", () => {
  assertEquals(
    scanBody("Ἐν ἀρχῇ ἦν ὁ λόγος. Then English.", emptyHints()).map(brief),
    ["language:grc Ἐν ἀρχῇ ἦν ὁ λόγος"],
  );
  assertEquals(scanBody("Then {{logos}} appears.", emptyHints()).map(brief), [
    "language:grc {{logos}}",
  ]);
});

test("scan: script and lexicon agreement yields one suggestion", () => {
  const hints = emptyHints({
    languages: new Map([
      [
        "grc",
        {
          strong: new Set(["λογος"]),
          weak: new Set<string>(),
        },
      ],
    ]),
  });
  assertEquals(scanBody("A λόγος appears.", hints).map(brief), [
    "language:grc λόγος",
  ]);
});

test("scan: citations are not suggested in title blocks", () => {
  const hints = emptyHints({
    people: phraseLexicon(["Hume"]),
    citations: phraseLexicon(["Of Morals"]),
  });
  const source =
    "# T\n\n{#title}\n^1 OF MORALS\n^2 BY HUME\n\n{#1}\nSo Of Morals argues.\n";
  assertEquals(scan(source, hints).map(brief), [
    "person HUME", // people still match in titles
    "citation Of Morals", // …but a title page never cites itself
  ]);
});

test("scan: contained duplicates collapse to the longest", () => {
  // The cue phrase yields "Section I" and the locator pattern "Section I.";
  // the contained one is dropped.
  assertEquals(scanBody("See Section I. now.", emptyHints()).map(brief), [
    "citation Section I.",
  ]);
});

test("scan: suggestions are sorted by source position", () => {
  const hints = emptyHints({
    people: phraseLexicon(["Hume"]),
    languages: new Map([
      [
        "la",
        {
          strong: new Set(["quod"]),
          weak: new Set<string>(),
        },
      ],
    ]),
  });
  const suggestions = scanBody("First quod holds; then Hume writes.", hints);
  assertEquals(suggestions.map(brief), ["language:la quod", "person Hume"]);
});
