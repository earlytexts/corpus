/**
 * Per-session memos for the *fixed external inputs* the dictionary tier reads:
 * the reference word list (`data/reference/words.txt`, ~106k lines) and the
 * canonical-spelling exceptions. Both are pinned data — deliberately external
 * and version-fixed, so the canonical choice never drifts (see ../DICTIONARY.md)
 * — yet the rule rebuilt a 106k-entry `Set` from a megabyte of text on every
 * validation pass. In a one-shot build that is noise; in the Compositor, where a
 * pass runs on every save, it is not.
 *
 * Keyed on the file's *text*, not on its path or an mtime: the `CorpusFs` port
 * exposes neither, and the content is the only thing that can change the answer.
 * So the read still happens (cheap, and it keeps the memo honest) and only the
 * parse is skipped (not cheap).
 *
 * Injected on the `RuleContext` rather than held module-global, so tests and
 * concurrent roots never share one another's memos.
 */

import type { CorpusFs } from "../fs/ports.ts";

export type ValidationCache = {
  /** The reference word list, or null when the corpus has none. */
  referenceWords: (fs: CorpusFs, root: string) => Promise<Set<string> | null>;
  /** The canonical-spelling exceptions (empty when the file is absent). */
  canonicalExceptions: (fs: CorpusFs, root: string) => Promise<Set<string>>;
};

export const createValidationCache = (): ValidationCache => {
  const words = memoizeFile(
    "reference/words.txt",
    (text) =>
      new Set(
        text.split("\n").map((line) => line.trim().toLowerCase()).filter(
          Boolean,
        ),
      ),
  );
  const exceptions = memoizeFile(
    "reference/canonical-exceptions.json",
    (text) => new Set(JSON.parse(text) as string[]),
  );
  return {
    referenceWords: words,
    canonicalExceptions: async (fs, root) =>
      (await exceptions(fs, root)) ?? new Set(),
  };
};

/** Read one `data/`-relative file and parse it, reusing the last parse while
 * the bytes are unchanged. Null when the file is absent. */
const memoizeFile = <T>(
  relPath: string,
  parse: (text: string) => T,
): (fs: CorpusFs, root: string) => Promise<T | null> => {
  let cached: { text: string; value: T } | undefined;
  return async (fs, root) => {
    const text = await fs.readFile(`${root}/data/${relPath}`);
    if (text === null) return null;
    if (cached?.text !== text) cached = { text, value: parse(text) };
    return cached.value;
  };
};
