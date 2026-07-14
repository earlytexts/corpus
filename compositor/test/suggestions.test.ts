/**
 * The vscode-free suggestion rules: how a scanner suggestion maps to the markup
 * a quick fix writes, the wording it carries, and the grouping key the "mark up
 * all N" fix uses.
 */

import { describe, expect, it } from "vitest";
import type { MarkupSuggestion } from "../src/lib/hints.ts";
import {
  fixTitle,
  languageLabel,
  suggestionKey,
  suggestionMessage,
  wrapText,
} from "../src/lib/suggestions.ts";

const at = (
  type: MarkupSuggestion["type"],
  text: string,
  lang?: string,
): MarkupSuggestion => ({
  type,
  ...(lang === undefined ? {} : { lang }),
  text,
  startLine: 0,
  startColumn: 0,
  endLine: 0,
  endColumn: text.length,
});

describe("suggestionKey", () => {
  it("groups by type, keeping one language apart from another", () => {
    expect(suggestionKey(at("person", "X"))).toBe("person");
    expect(suggestionKey(at("place", "X"))).toBe("place");
    expect(suggestionKey(at("org", "X"))).toBe("org");
    expect(suggestionKey(at("language", "quod", "la"))).not.toBe(
      suggestionKey(at("language", "chose", "fr")),
    );
  });
});

describe("wrapText", () => {
  it("wraps a person in [p:…]", () => {
    expect(wrapText(at("person", "Hobbes"))).toBe("[p:Hobbes]");
  });
  it("wraps a place in [l:…]", () => {
    expect(wrapText(at("place", "Rome"))).toBe("[l:Rome]");
  });
  it("wraps an organisation in [o:…]", () => {
    expect(wrapText(at("org", "Royal Society"))).toBe("[o:Royal Society]");
  });
  it("wraps a citation in […]", () => {
    expect(wrapText(at("citation", "Sect. IV."))).toBe("[Sect. IV.]");
  });
  it("wraps a language in $xx:…$", () => {
    expect(wrapText(at("language", "in foro", "la"))).toBe("$la:in foro$");
    expect(wrapText(at("language", "λόγος", "grc"))).toBe("$grc:λόγος$");
  });
  it("keeps any inline markup inside the match intact", () => {
    expect(wrapText(at("language", "fo//12//ro humano", "la"))).toBe(
      "$la:fo//12//ro humano$",
    );
  });
});

describe("labels", () => {
  it("names known languages and uppercases the rest", () => {
    expect(languageLabel("grc")).toBe("Ancient Greek");
    expect(languageLabel("cy")).toBe("CY");
  });
  it("phrases messages per type", () => {
    expect(suggestionMessage(at("person", "Hobbes"))).toMatch(/name/);
    expect(suggestionMessage(at("place", "Rome"))).toMatch(/place/);
    expect(suggestionMessage(at("org", "Royal Society"))).toMatch(
      /organisation/,
    );
    expect(suggestionMessage(at("language", "quod", "la"))).toMatch(/Latin/);
  });
  it("phrases fix titles per type", () => {
    expect(fixTitle(at("person", "X"))).toBe("Mark up as a person ([p:…])");
    expect(fixTitle(at("place", "X"))).toBe("Mark up as a place ([l:…])");
    expect(fixTitle(at("org", "X"))).toBe("Mark up as an organisation ([o:…])");
    expect(fixTitle(at("citation", "X"))).toBe("Mark up as a citation ([…])");
    expect(fixTitle(at("language", "quod", "la"))).toBe(
      "Mark up as Latin ($la:…$)",
    );
  });
});
