/**
 * Markup hints: the lexicons mined from existing markup (buildHints) and the
 * raw-source scanner that proposes new markup from them (scanSource). The
 * build tests use a small corpus whose word counts are chosen to exercise the
 * strong/weak classification; the scan tests feed hand-built lexicons so each
 * matching rule is pinned down independently of the classifier.
 */

import { expect, test } from "vitest";
import {
  compileWithPositions,
  type MarkitDocument,
} from "@jsr/earlytexts__markit";
import { buildCatalogue } from "@earlytexts/corpus";
import { corpus, CORPUS_ROOT, memoryCorpus } from "@earlytexts/corpus/test";
import {
  buildHints,
  buildHintsFrom,
  type Hints,
  type MarkupSuggestion,
  phraseLexicon,
  scanSource,
} from "../src/core/hints.ts";
import { foldWord } from "../src/core/sourceTokens.ts";

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
          "said so; compare [Pro Sexto] and [Point]. He toured [l:Rome] with " +
          "the [o:Royal Society].",
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

test("hints: markup inside a list and its nested list is mined", async () => {
  const files = corpus()
    .author("a", { forename: "A", surname: "Aa" })
    .work("a", "w", { title: "W", breadcrumb: "W", canonical: "1700" })
    .edition(
      "a",
      "w",
      "1700",
      { imported: false, title: "W", breadcrumb: "W", published: [1700] },
      "{#1}\nNames follow.\n\n- Meet [p:Mr Tully] here\n- Then [p:Dr Locke]\n" +
        "  - Under [p:Sir Bacon]\n",
    )
    .build();
  const { catalogue } = await buildCatalogue(memoryCorpus(files), CORPUS_ROOT);
  const hints = buildHints(catalogue);
  assert(hasPhrase(hints.people, "mr", "tully"));
  assert(hasPhrase(hints.people, "dr", "locke"));
  assert(hasPhrase(hints.people, "sir", "bacon")); // from the nested list
});

test("hints: markup inside a table cell is mined", async () => {
  const files = corpus()
    .author("a", { forename: "A", surname: "Aa" })
    .work("a", "w", { title: "W", breadcrumb: "W", canonical: "1700" })
    .edition(
      "a",
      "w",
      "1700",
      { imported: false, title: "W", breadcrumb: "W", published: [1700] },
      "{#1}\nA table:\n\n| Meet [p:Mr Tully] here | and [p:Dr Locke] |\n",
    )
    .build();
  const { catalogue } = await buildCatalogue(memoryCorpus(files), CORPUS_ROOT);
  const hints = buildHints(catalogue);
  assert(hasPhrase(hints.people, "mr", "tully"));
  assert(hasPhrase(hints.people, "dr", "locke"));
});

test("hints: a mined span keeps the text of its nested markup", async () => {
  // The person's name carries a nested language span; its words are still mined
  // (the inline-text flattening descends into the nested content).
  const files = corpus()
    .author("cicero", { forename: "Marcus", surname: "Cicero" })
    .work("cicero", "w", { title: "W", breadcrumb: "W", canonical: "1700" })
    .edition(
      "cicero",
      "w",
      "1700",
      { imported: false, title: "W", breadcrumb: "W", published: [1700] },
      "{#1}\nWith [p:Mr $la:Tully$] himself.",
    )
    .build();
  const { catalogue } = await buildCatalogue(memoryCorpus(files), CORPUS_ROOT);
  const hints = buildHints(catalogue);
  assert(hasPhrase(hints.people, "mr", "tully"));
});

test("hints: places and orgs are mined from their spans (no metadata seed)", async () => {
  const hints = await fixtureHints();
  assert(hasPhrase(hints.places, "rome")); // [l:Rome]
  assert(hasPhrase(hints.orgs, "royal", "society")); // [o:Royal Society]
  // Nothing seeds them, so a corpus with no such spans has empty lexicons.
  assert(!hasPhrase(hints.people, "rome"));
  assert(!hasPhrase(hints.citations, "royal", "society"));
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

test("hints: phraseLexicon dedups repeated phrases and keeps longest first", () => {
  const lexicon = phraseLexicon(["John Locke", "John Locke", "John"]);
  // "John Locke" is added once despite the repeat; both hang off the "john"
  // head, the longer sequence first.
  assertEquals(lexicon.get("john"), [["john", "locke"], ["john"]]);
});

const docOf = (source: string): MarkitDocument =>
  compileWithPositions(source).document;

test("hints: an author title seeds the people lexicon", async () => {
  const hints = buildHintsFrom(
    [],
    [{ forename: "Henry", surname: "Bolingbroke", title: "Lord Bolingbroke" }],
    [],
  );
  assert(hasPhrase(hints.people, "lord", "bolingbroke")); // from the title seed
  assert(hasPhrase(hints.people, "henry", "bolingbroke")); // and the full name
});

test("hints: a document is walked once however often it is fed", () => {
  const doc = docOf("# T\n\n{#1}\nBy [p:Mr Twice] here.\n");
  const hints = buildHintsFrom([doc, doc], [], []);
  assert(hasPhrase(hints.people, "mr", "twice"));
});

test("hints: a document's children are walked too", () => {
  const child = docOf("# C\n\n{#1}\nBy [p:Mr Child] here.\n");
  const parent = {
    ...docOf("# P\n\n{#1}\nBy [p:Mr Parent] here.\n"),
    children: [child],
  };
  const hints = buildHintsFrom([parent], [], []);
  assert(hasPhrase(hints.people, "mr", "parent"));
  assert(hasPhrase(hints.people, "mr", "child")); // reached through the child
});

test("hints: an unknown block type is walked like a run of paragraphs", () => {
  // A block-level element newer than the pinned markit (e.g. a stage direction)
  // holds a list of paragraphs; the walk descends into them regardless, and
  // tolerates a content-less element or paragraph (both fall back to nothing).
  const exotic = {
    blocks: [
      {
        content: [
          {
            type: "stageDirection",
            content: [
              {
                content: [
                  {
                    type: "person",
                    content: [{ type: "plainText", content: "Mr Ghost" }],
                  },
                ],
              },
              {}, // a paragraph with no content
            ],
          },
          { type: "chorus" }, // an element with no content at all
        ],
      },
    ],
    children: [],
  } as unknown as MarkitDocument;
  const hints = buildHintsFrom([exotic], [], []);
  assert(hasPhrase(hints.people, "mr", "ghost"));
});

test("hints: markup inside a blockquote paragraph is mined, but not its lists", () => {
  const doc = docOf(
    "# T\n\n{#1}\n> A quote [p:Mr Quote] here.\n>\n> - item [p:Dr List]\n",
  );
  const hints = buildHintsFrom([doc], [], []);
  assert(hasPhrase(hints.people, "mr", "quote")); // the blockquote's paragraph
  assert(!hasPhrase(hints.people, "dr", "list")); // a non-paragraph child is skipped
});

test("hints: markup inside inline emphasis is seen through and mined", () => {
  // *…* is a formatting wrapper, not semantic markup: the walk descends through
  // it to the person span nested inside.
  const doc = docOf("# T\n\n{#1}\nThen *meet [p:Mr Emph] now* here.\n");
  const hints = buildHintsFrom([doc], [], []);
  assert(hasPhrase(hints.people, "mr", "emph"));
});

test("hints: transparent inline marks inside a span are text-transparent", () => {
  // A `~` join reads as a space (so "Mr" stays its own word) and a page break
  // contributes nothing while fusing the words it sits between (Cato + Jones).
  const doc = docOf("# T\n\n{#1}\nSee [p:Mr~Cato //9// Jones] pass.\n");
  const hints = buildHintsFrom([doc], [], []);
  assert(hasPhrase(hints.people, "mr", "catojones"));
});

/* ------------------------------ scanSource ----------------------------- */

/** Hints with empty phrase lexicons and no language lexicons. */
const emptyHints = (partial?: Partial<Hints>): Hints => ({
  people: phraseLexicon([]),
  places: phraseLexicon([]),
  orgs: phraseLexicon([]),
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
  const { document: doc } = compileWithPositions(source);
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

test("scan: character-mode spans at a word's edges are taken in whole", () => {
  // Compiled positions point at a braced span's content; the match must
  // widen over the braces, or the proposed markup would split them.
  const hints = emptyHints({
    languages: new Map([
      [
        "la",
        { strong: new Set(["aesopus", "economy"]), weak: new Set<string>() },
      ],
    ]),
  });
  assertEquals(
    scanBody("Then {AE}sopus met econom{y/} here.", hints).map((s) => s.text),
    ["{AE}sopus", "econom{y/}"],
  );
});

test("scan: an escaped brace is not read as a span boundary", () => {
  // The `\{` is a literal brace, skipped by the brace scanner, so the token
  // beside it widens over nothing and matches on its own.
  assertEquals(
    scanBody("The word quod \\{here\\} stands.", laHints()).map(brief),
    ["language:la quod"],
  );
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

test("scan: place and org phrases match like people (and in titles)", () => {
  const hints = emptyHints({
    places: phraseLexicon(["Rome", "New England"]),
    orgs: phraseLexicon(["Royal Society"]),
  });
  assertEquals(
    scanBody("From Rome to New England the Royal Society wrote.", hints).map(
      brief,
    ),
    ["place Rome", "place New England", "org Royal Society"],
  );
  // Places/orgs, like people, are still suggested inside title blocks.
  const source = "# T\n\n{#title}\n^1 A LETTER FROM ROME\n\n{#1}\nEnglish.\n";
  assertEquals(scan(source, hints).map(brief), ["place ROME"]);
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

test("scan: co-located suggestions of different types sort by type", () => {
  const hints = emptyHints({
    people: phraseLexicon(["Hume"]),
    citations: phraseLexicon(["Hume"]),
  });
  // "Hume" matches as both a person and a citation over the same span; the
  // position sort ties on every coordinate and falls through to the type key.
  assertEquals(scanBody("Then Hume wrote.", hints).map(brief), [
    "citation Hume",
    "person Hume",
  ]);
});

test("scan: co-located language suggestions of different codes sort by code", () => {
  const hints = emptyHints({
    languages: new Map([
      ["la", { strong: new Set(["amen"]), weak: new Set<string>() }],
      ["fr", { strong: new Set(["amen"]), weak: new Set<string>() }],
    ]),
  });
  // "amen" is strong in both lexicons, so it matches over the very same span
  // for each; the sort ties through type "language" to the language code.
  assertEquals(scanBody("Say amen now.", hints).map(brief), [
    "language:fr amen",
    "language:la amen",
  ]);
});

test("scan: a source shorter than the compiled document is tolerated", () => {
  // The document is compiled from a longer source than the one scanned (a stale
  // buffer, say): its {#2} block lies beyond the truncated lines. The scan
  // still runs, placing the out-of-range match at an empty text rather than
  // throwing on the missing lines.
  const long = "# T\n\n{#1}\nEnglish.\n\n{#2}\nBy John Locke here.\n";
  const short = "# T\n\n{#1}\nEnglish.\n";
  const hints = emptyHints({ people: phraseLexicon(["John Locke"]) });
  const suggestions = scanSource(
    short,
    compileWithPositions(long).document,
    hints,
  );
  assertEquals(
    suggestions.map((s) => [s.type, s.startLine, s.text]),
    [["person", 6, ""]],
  );
});
