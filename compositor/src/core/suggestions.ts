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

/** Exported for tests — its callers (`suggestionMessage`, `kindNoun`) are all
 * in-module, so the export itself is not part of the public contract. */
export const languageLabel = (code: string): string =>
  LANGUAGE_NAMES[code] ?? code.toUpperCase();

/** The stable identity of a suggestion's kind (type, and language code for a
 * foreign span), used to group repeated identical matches for the "mark up all
 * N" quick fix. */
export const suggestionKey = (suggestion: MarkupSuggestion): string =>
  suggestion.type === "language"
    ? `language:${suggestion.lang ?? ""}`
    : suggestion.type;

/** Per-kind display data for the four fixed suggestion types (the `[p:…]`,
 * `[l:…]`, `[o:…]`, `[…]` marks), gathered in one place so the wrapper, the
 * diagnostic message, and the quick-fix noun stay in step. A language span is
 * handled apart because its three fields all derive from the code; a new `type`
 * the scanner adds but forgets here is a compile error rather than being
 * silently treated as a language span. */
const KINDS: Record<
  Exclude<MarkupSuggestion["type"], "language">,
  { open: string; close: string; message: string; noun: string }
> = {
  person: {
    open: "[p:",
    close: "]",
    message: "Possible name — mark up as a person?",
    noun: "a person",
  },
  place: {
    open: "[l:",
    close: "]",
    message: "Possible place — mark up as a place?",
    noun: "a place",
  },
  org: {
    open: "[o:",
    close: "]",
    message: "Possible organisation — mark up as an organisation?",
    noun: "an organisation",
  },
  citation: {
    open: "[",
    close: "]",
    message: "Possible citation — mark up as a reference?",
    noun: "a citation",
  },
};

/** The delimiters that would wrap a suggestion's text as the markup it
 * proposes: the fixed marks above, or `$xx:…$` for a language span. */
export const wrapper = (
  suggestion: MarkupSuggestion,
): { open: string; close: string } => {
  if (suggestion.type !== "language") {
    const { open, close } = KINDS[suggestion.type];
    return { open, close };
  }
  const code = suggestion.lang;
  return { open: code === undefined ? "$" : `$${code}:`, close: "$" };
};

/** The replacement text a "mark this up" fix inserts over the match. */
export const wrapText = (suggestion: MarkupSuggestion): string => {
  const { open, close } = wrapper(suggestion);
  return `${open}${suggestion.text}${close}`;
};

/** The diagnostic message shown against a suggestion. */
export const suggestionMessage = (suggestion: MarkupSuggestion): string => {
  if (suggestion.type !== "language") return KINDS[suggestion.type].message;
  const name = languageLabel(suggestion.lang ?? "");
  return `Possible ${name} — mark up as ${name}?`;
};

/** The noun phrase naming a suggestion's kind, as it reads in a quick-fix title
 * ("a person", "an organisation", "Latin"). */
const kindNoun = (suggestion: MarkupSuggestion): string =>
  suggestion.type === "language"
    ? languageLabel(suggestion.lang ?? "")
    : KINDS[suggestion.type].noun;

/** The quick-fix title for wrapping one suggestion. */
export const fixTitle = (suggestion: MarkupSuggestion): string => {
  const { open, close } = wrapper(suggestion);
  return `Mark up as ${kindNoun(suggestion)} (${open}…${close})`;
};
