/**
 * The suggestion pipeline the controller runs, minus the editor: build the
 * lexicons from a catalogue, scan a source, and apply each fix. Proves the
 * @earlytexts/corpus wiring resolves from the compositor and that the wrap
 * agrees with the scanner. The overlay is all-or-nothing (no per-kind filter),
 * so every suggestion the scanner returns is applied.
 */

import { describe, expect, it } from "vitest";
import { compileWithPositions } from "@jsr/earlytexts__markit";
import type { Catalogue } from "@earlytexts/corpus";
import { buildHints, scanSource } from "../src/lib/hints.ts";
import { wrapText } from "../src/lib/suggestions.ts";
import { hintOverrides } from "../src/lib/hintOverrides.ts";

/** A one-author, one-edition catalogue over `body` (a `.mit` document body). */
const catalogueOf = (body: string): Catalogue => {
  const document = compileWithPositions(
    `# Hume.Work.1748\n\n${body}\n`,
  ).document;
  const edition = {
    authorSlugs: ["hume"],
    workSlug: "work",
    slug: "1748",
    title: "An Enquiry",
    breadcrumb: "Enquiry",
    imported: false,
    published: [1748],
    document,
  };
  const work = {
    authorSlugs: ["hume"],
    hostSlug: "hume",
    slug: "work",
    title: "An Enquiry",
    breadcrumb: "Enquiry",
    imported: false,
    firstPublished: 1748,
    canonicalSlug: "1748",
    standalone: true,
    dir: "works/hume/work",
    editions: [edition],
  };
  const author = {
    slug: "hume",
    forename: "David",
    surname: "Hume",
    works: [work],
  };
  return {
    authors: [author],
    byAuthor: new Map([["hume", author]]),
    sources: new WeakMap(),
  } as unknown as Catalogue;
};

/** Apply every scanner fix to a fresh source, right-to-left so the earlier
 * ranges keep their offsets. */
const markUp = (source: string, catalogue: Catalogue): string => {
  const { document: doc } = compileWithPositions(source);
  const suggestions = scanSource(
    source,
    doc,
    buildHints(catalogue, hintOverrides),
  ).sort((a, b) => b.startLine - a.startLine || b.startColumn - a.startColumn);
  const lines = source.split("\n");
  for (const s of suggestions) {
    // Single-line suggestions only in this fixture.
    const line = lines[s.startLine];
    lines[s.startLine] =
      line.slice(0, s.startColumn) + wrapText(s) + line.slice(s.endColumn);
  }
  return lines.join("\n");
};

describe("suggestion pipeline", () => {
  it("mines lexicons the compositor can act on", () => {
    // "Cicero" is a marked person elsewhere in the corpus; here the author
    // seed (David Hume) and a Latin span train the scanner.
    const catalogue = catalogueOf(
      "{#1}\nCicero wrote $la:quod erat in foro$ about nature.",
    );
    const hints = buildHints(catalogue, hintOverrides);
    expect(hints.languages.get("la")?.strong.has("quod")).toBe(true);
    expect([...hints.people.keys()]).toContain("hume");
  });

  it("marks up a Latin cluster, leaving plain prose alone", () => {
    const catalogue = catalogueOf("{#1}\nHe said $la:quod foro$ once.");
    // Fresh source (no markup yet) with the same Latin used unmarked.
    const source = "# T\n\n{#1}\nHe said quod foro plainly.\n";
    expect(markUp(source, catalogue)).toContain("$la:quod foro$");
  });

  it("marks up every kind at once (people and foreign text together)", () => {
    const catalogue = catalogueOf("{#1}\nA line about $la:quod foro$ matters.");
    const source = "# T\n\n{#1}\nDavid Hume said quod foro here.\n";
    const marked = markUp(source, catalogue);
    expect(marked).toContain("[p:David Hume]");
    expect(marked).toContain("$la:quod foro$");
  });

  it("marks up places and organisations mined from their spans", () => {
    const catalogue = catalogueOf(
      "{#1}\nHe toured [l:Rome] with the [o:Royal Society].",
    );
    const source = "# T\n\n{#1}\nBack in Rome the Royal Society met.\n";
    const marked = markUp(source, catalogue);
    expect(marked).toContain("[l:Rome]");
    expect(marked).toContain("[o:Royal Society]");
  });
});
