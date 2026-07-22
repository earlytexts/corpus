/**
 * The pure search core: the matcher builder (literal/regex, case, whole-word),
 * the block-content line filter, author scoping over a real catalogue, the
 * per-file scan with caps and previews, and regex-aware replacement strings.
 * Built over real compiles and the corpus's own harness so line/column
 * positions and catalogue shapes are the genuine article.
 */

import { expect, test } from "vitest";
import { compileWithPositions } from "@jsr/earlytexts__markit";
import { buildCatalogue } from "@earlytexts/corpus";
import { CORPUS_ROOT, corpus, memoryCorpus } from "@earlytexts/corpus/test";
import {
  authorRows,
  buildMatcher,
  plural,
  replacementFor,
  scopedEditions,
  searchableLines,
  searchFile,
  type SearchQuery,
} from "../src/lib/searchPanel.ts";

/* ------------------------------- helpers -------------------------------- */

const query = (over: Partial<SearchQuery>): SearchQuery => ({
  term: "",
  isRegex: false,
  caseSensitive: false,
  wholeWord: false,
  include: [],
  exclude: [],
  ...over,
});

const matcherOf = (over: Partial<SearchQuery>): RegExp => {
  const built = buildMatcher(query(over));
  if ("error" in built) throw new Error(built.error);
  return built.matcher;
};

/* ------------------------------ the matcher ------------------------------ */

test("a literal term is case-insensitive by default and escapes regex characters", () => {
  const matcher = matcherOf({ term: "reason." });
  expect("Reason. and treason!".match(matcher)).toEqual(["Reason."]);
});

test("the case toggle makes a literal term exact", () => {
  const matcher = matcherOf({ term: "Reason", caseSensitive: true });
  expect("reason within Reason".match(matcher)).toEqual(["Reason"]);
});

test("whole word never matches inside a word, including accented and Greek neighbours", () => {
  const matcher = matcherOf({ term: "vertue", wholeWord: true });
  expect("vertue, but not vertuous".match(matcher)).toEqual(["vertue"]);
  const cafe = matcherOf({ term: "cafe", wholeWord: true });
  expect("café".match(cafe)).toBeNull();
  const rho = matcherOf({ term: "λόγος", wholeWord: true });
  expect("ὁ λόγος ἦν".match(rho)).toEqual(["λόγος"]);
});

test("regex mode matches patterns, and whole-word wraps them", () => {
  const matcher = matcherOf({ term: "reasons?", isRegex: true });
  expect("reasons and reason".match(matcher)).toEqual(["reasons", "reason"]);
  const whole = matcherOf({
    term: "vertu(e|ous)",
    isRegex: true,
    wholeWord: true,
  });
  expect("vertue vertuously".match(whole)).toEqual(["vertue"]);
});

test("an invalid regex reports its error instead of a matcher", () => {
  const built = buildMatcher(query({ term: "(unclosed", isRegex: true }));
  expect(built).toHaveProperty("error");
});

test("a regex only valid outside unicode mode falls back (unless whole-word needs unicode)", () => {
  // \-] is a valid pattern without the u flag, rejected with it.
  const built = buildMatcher(query({ term: "a\\-b", isRegex: true }));
  expect(built).not.toHaveProperty("error");
  const whole = buildMatcher(
    query({ term: "a\\-b", isRegex: true, wholeWord: true }),
  );
  expect(whole).toHaveProperty("error");
});

/* ------------------------- block-content lines --------------------------- */

const SOURCE = `# Hume.Test.1750

[metadata]
title = "A Test with reason in the metadata"
breadcrumb = "Test"
authors = ["hume"]
published = [1750]

{#title}
^2 A TEST
^1 _Of Reason._

{#1}
First paragraph, of reason.

## Hume.Test.1750.Part1

[metadata]
title = "Part the First: reason again"

{#1}
Nested paragraph, of treason.
`;

const compiled = () => {
  const { document, errors } = compileWithPositions(SOURCE);
  expect(errors).toEqual([]);
  return { doc: document, lines: SOURCE.split("\n") };
};

test("only block content lines are searchable — never metadata, titles, or tag lines", () => {
  const { doc, lines } = compiled();
  const searchable = [...searchableLines(doc, lines)].sort((a, b) => a - b);
  const expected = [
    "^2 A TEST",
    "^1 _Of Reason._",
    "First paragraph, of reason.",
    "Nested paragraph, of treason.",
  ].map((text) => lines.indexOf(text));
  expect(searchable).toEqual(expected);
});

/* ------------------------------ file search ------------------------------ */

test("searchFile finds matches only in block content, with exact positions", () => {
  const { doc, lines } = compiled();
  const { matches, truncated } = searchFile(
    { text: SOURCE, doc },
    matcherOf({ term: "reason" }),
    100,
  );
  expect(truncated).toBe(false);
  // "reason" appears in both [metadata] titles too — those never match.
  expect(matches).toHaveLength(3);
  const paragraph = matches[1];
  expect(lines[paragraph.line]).toBe("First paragraph, of reason.");
  expect(paragraph.start).toBe("First paragraph, of ".length);
  expect(paragraph.end).toBe(paragraph.start + "reason".length);
  expect(paragraph.matchText).toBe("reason");
  expect(matches[2].matchText).toBe("reason"); // the one inside "treason"
});

test("whole word leaves treason alone", () => {
  const { doc } = compiled();
  const { matches } = searchFile(
    { text: SOURCE, doc },
    matcherOf({ term: "reason", wholeWord: true }),
    100,
  );
  expect(matches.map((m) => m.matchText)).toEqual(["Reason", "reason"]);
});

test("previews are clipped around the match on long lines", () => {
  const long = `{#1}\n${"padding ".repeat(50)}reason${" trailing".repeat(50)}`;
  const text = `# A.B.1700\n\n[metadata]\ntitle = "T"\n\n${long}\n`;
  const { document } = compileWithPositions(text);
  const { matches } = searchFile(
    { text, doc: document },
    matcherOf({ term: "reason" }),
    100,
  );
  expect(matches).toHaveLength(1);
  expect(matches[0].before.length).toBeLessThanOrEqual(48);
  expect(matches[0].after.length).toBeLessThanOrEqual(120);
  expect(matches[0].before.endsWith("padding ")).toBe(true);
  expect(matches[0].after.startsWith(" trailing")).toBe(true);
});

test("the per-file cap stops the scan and flags truncation", () => {
  const body = Array.from({ length: 30 }, (_, i) => `{#${i + 1}}\nword`).join(
    "\n\n",
  );
  const text = `# A.B.1700\n\n[metadata]\ntitle = "T"\n\n${body}\n`;
  const { document } = compileWithPositions(text);
  const { matches, truncated } = searchFile(
    { text, doc: document },
    matcherOf({ term: "word" }),
    10,
  );
  expect(matches).toHaveLength(10);
  expect(truncated).toBe(true);
});

test("a regex that can match empty never loops and yields only real matches", () => {
  const { doc } = compiled();
  const { matches } = searchFile(
    { text: SOURCE, doc },
    matcherOf({ term: "z*", isRegex: true }),
    100,
  );
  expect(matches).toEqual([]);
});

/* ----------------------------- author scoping ---------------------------- */

// Hume (two works), Smith (one), and an Astell & Norris co-authored work.
const fixture = () =>
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
      "{#1}\nText.",
    )
    .edition(
      "hume",
      "enquiry",
      "1758",
      {
        imported: false,
        title: "An Enquiry",
        breadcrumb: "Enquiry",
        published: [1758],
      },
      "{#1}\nText.",
    )
    .work("hume", "treatise", {
      title: "A Treatise",
      breadcrumb: "Treatise",
      canonical: "1739",
    })
    .edition(
      "hume",
      "treatise",
      "1739",
      {
        imported: false,
        title: "A Treatise",
        breadcrumb: "Treatise",
        published: [1739],
      },
      "{#1}\nText.",
    )
    .author("smith", { forename: "Adam", surname: "Smith" })
    .work("smith", "wealth", {
      title: "The Wealth of Nations",
      breadcrumb: "Wealth",
      canonical: "1776",
    })
    .edition(
      "smith",
      "wealth",
      "1776",
      {
        imported: false,
        title: "The Wealth of Nations",
        breadcrumb: "Wealth",
        published: [1776],
      },
      "{#1}\nText.",
    )
    .author("astell", { forename: "Mary", surname: "Astell" })
    .author("norris", { forename: "John", surname: "Norris" })
    .work("astell-norris", "letters", {
      title: "Letters Concerning the Love of God",
      breadcrumb: "Letters",
      canonical: "1695",
      authors: ["astell", "norris"],
    })
    .edition(
      "astell-norris",
      "letters",
      "1695",
      {
        imported: false,
        title: "Letters",
        breadcrumb: "Letters",
        published: [1695],
        authors: ["astell", "norris"],
      },
      "{#1}\nText.",
    )
    .build();

const catalogue = async () => {
  const { catalogue } = await buildCatalogue(
    memoryCorpus(fixture()),
    CORPUS_ROOT,
  );
  return catalogue;
};

const path = (host: string, work: string, year: string) =>
  `${CORPUS_ROOT}/data/works/${host}/${work}/${year}.mit`;

test("no filters: every edition once, in catalogue order, with catalogue labels", async () => {
  const cat = await catalogue();
  const scoped = scopedEditions(cat, [], []);
  // Authors order by first publication: Astell/Norris 1695, Hume 1739, Smith 1776.
  expect(scoped.map((e) => e.path)).toEqual([
    path("astell-norris", "letters", "1695"),
    path("hume", "treatise", "1739"),
    path("hume", "enquiry", "1748"),
    path("hume", "enquiry", "1758"),
    path("smith", "wealth", "1776"),
  ]);
  expect(scoped[0].label).toBe("Astell & Norris · Letters · 1695");
  expect(scoped[2].label).toBe("Hume · Enquiry · 1748");
});

test("include limits to the named authors (trimmed, case-folded)", async () => {
  const cat = await catalogue();
  const scoped = scopedEditions(cat, [" Hume ", ""], []);
  expect(scoped.map((e) => e.path)).toEqual([
    path("hume", "treatise", "1739"),
    path("hume", "enquiry", "1748"),
    path("hume", "enquiry", "1758"),
  ]);
});

test("a co-authored work counts under either author, and exclude beats include", async () => {
  const cat = await catalogue();
  const viaNorris = scopedEditions(cat, ["norris"], []);
  expect(viaNorris.map((e) => e.path)).toEqual([
    path("astell-norris", "letters", "1695"),
  ]);
  const excluded = scopedEditions(cat, ["norris"], ["astell"]);
  expect(excluded).toEqual([]);
});

test("exclude alone removes an author's works from the full corpus", async () => {
  const cat = await catalogue();
  const scoped = scopedEditions(cat, [], ["hume", "smith"]);
  expect(scoped.map((e) => e.path)).toEqual([
    path("astell-norris", "letters", "1695"),
  ]);
});

test("authorRows lists every author, sorted by surname, for the filter autocomplete", async () => {
  const cat = await catalogue();
  expect(authorRows(cat)).toEqual([
    { slug: "astell", name: "Mary Astell" },
    { slug: "hume", name: "David Hume" },
    { slug: "norris", name: "John Norris" },
    { slug: "smith", name: "Adam Smith" },
  ]);
});

/* ------------------------------ replacement ------------------------------ */

test("a literal replacement is the replace text verbatim", () => {
  expect(replacementFor("Vertue", query({ term: "vertue" }), "virtue")).toBe(
    "virtue",
  );
});

test("a regex replacement expands capture groups against the matched text", () => {
  const q = query({ term: "(v|V)ertue", isRegex: true });
  expect(replacementFor("Vertue", q, "$1irtue")).toBe("Virtue");
  const whole = query({ term: "(v|V)ertue", isRegex: true, wholeWord: true });
  expect(replacementFor("vertue", whole, "$1irtue")).toBe("virtue");
});

/* -------------------------------- plural --------------------------------- */

test("plural pluralises", () => {
  expect(plural(1, "match")).toBe("1 match");
  expect(plural(2, "file")).toBe("2 files");
});
