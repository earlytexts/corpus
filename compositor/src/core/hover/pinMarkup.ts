/**
 * Formatting a `[w:surface=value]` disambiguation element for insertion — the
 * one construction the suggestion engine's symmetric `wrapText` cannot express
 * (it opens and closes one wrapper; this splices a surface and a value around a
 * `=`). Escaping mirrors markit's own `escapeWord` (tei/emitText.ts): the three
 * structural characters of the element — `=`, `]`, and the escape `\` — are
 * backslash-escaped in both halves so the surface and value round-trip through
 * the parser intact. Pure and vitest-tested.
 */

/** Escape the structural characters of one half of a `[w:]` element. */
const escapeWord = (text: string): string =>
  text.replace(/[\\=\]]/g, (char) => `\\${char}`);

/** The `[w:surface=value]` element pinning `surface` to the reading `value`
 * selects. Both halves are escaped; `surface` is otherwise verbatim (its
 * original spelling and case preserved). */
export const wordMarkup = (surface: string, value: string): string =>
  `[w:${escapeWord(surface)}=${escapeWord(value)}]`;
