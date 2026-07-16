/**
 * The vscode-free core of the markup-suggestion feature: the pure mapping from
 * a scanner suggestion to the markup that would wrap it. `scanSource` (hints.ts)
 * finds the candidates (people, places, organisations, citations, foreign text)
 * in an edition's source; this decides what each "mark this up" quick fix
 * writes, and the wording it carries. Kept apart from the vscode wiring
 * (commands/suggestMarkup.ts) so the rules are unit-testable without the editor
 * API. The overlay is all-or-nothing (no per-category filter), so `suggestionKey`
 * exists only to group repeated identical matches for the "mark up all N" fix.
 */

import type { MarkupSuggestion } from "./hints.ts";

/** Display names for the language codes the corpus uses; anything unmapped
 * falls back to its uppercased code. */
export const LANGUAGE_NAMES: Record<string, string> = {
  la: "Latin",
  fr: "French",
  grc: "Ancient Greek",
  el: "Greek",
  gr: "Greek",
  it: "Italian",
  de: "German",
  es: "Spanish",
  he: "Hebrew",
};

export const languageLabel = (code: string): string =>
  LANGUAGE_NAMES[code] ?? code.toUpperCase();

/** The stable identity of a suggestion's kind (type, and language code for a
 * foreign span), used to group repeated identical matches for the "mark up all
 * N" quick fix. */
export const suggestionKey = (suggestion: MarkupSuggestion): string =>
  suggestion.type === "language"
    ? `language:${suggestion.lang ?? ""}`
    : suggestion.type;

/** The delimiters that would wrap a suggestion's text as the markup it
 * proposes: `[p:…]` people, `[l:…]` places, `[o:…]` organisations, `[…]`
 * citations, `$xx:…$` a language span. */
export const wrapper = (
  suggestion: MarkupSuggestion,
): { open: string; close: string } => {
  switch (suggestion.type) {
    case "person":
      return { open: "[p:", close: "]" };
    case "place":
      return { open: "[l:", close: "]" };
    case "org":
      return { open: "[o:", close: "]" };
    case "citation":
      return { open: "[", close: "]" };
    default: {
      const code = suggestion.lang;
      return { open: code === undefined ? "$" : `$${code}:`, close: "$" };
    }
  }
};

/** The replacement text a "mark this up" fix inserts over the match. */
export const wrapText = (suggestion: MarkupSuggestion): string => {
  const { open, close } = wrapper(suggestion);
  return `${open}${suggestion.text}${close}`;
};

/** The diagnostic message shown against a suggestion. */
export const suggestionMessage = (suggestion: MarkupSuggestion): string => {
  switch (suggestion.type) {
    case "person":
      return "Possible name — mark up as a person?";
    case "place":
      return "Possible place — mark up as a place?";
    case "org":
      return "Possible organisation — mark up as an organisation?";
    case "citation":
      return "Possible citation — mark up as a reference?";
    default: {
      const name = languageLabel(suggestion.lang ?? "");
      return `Possible ${name} — mark up as ${name}?`;
    }
  }
};

/** The noun phrase naming a suggestion's kind, as it reads in a quick-fix title
 * ("a person", "an organisation", "Latin"). */
const kindNoun = (suggestion: MarkupSuggestion): string => {
  switch (suggestion.type) {
    case "person":
      return "a person";
    case "place":
      return "a place";
    case "org":
      return "an organisation";
    case "citation":
      return "a citation";
    default:
      return languageLabel(suggestion.lang ?? "");
  }
};

/** The quick-fix title for wrapping one suggestion. */
export const fixTitle = (suggestion: MarkupSuggestion): string => {
  const { open, close } = wrapper(suggestion);
  return `Mark up as ${kindNoun(suggestion)} (${open}…${close})`;
};
