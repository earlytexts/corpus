/**
 * Per-file derivations: everything the validation rules and the Compositor's
 * curation need from a file that does not depend on the dictionary — computed
 * once when the file is compiled (loadCorpus, or the Compositor's incremental
 * refresh) so a dictionary edit never re-tokenizes or re-formats an unchanged
 * file. The register-*dependent* half of accounting (is this surface
 * registered?) is a membership test the consumers apply at the end:
 * a surface's unaccounted occurrences are exactly its `candidates` when
 * neither it nor its possessive base has an entry, and zero otherwise
 * (see account.ts, `statusOf`).
 */

import { format, type MarkitDocument } from "@earlytexts/markit";
import {
  blockTokens,
  exemptionOf,
  fold,
  isMechanical,
} from "../dictionary/words.ts";

/** One `[w:surface=value]` occurrence, located for the word-markup rule. */
export type MarkedToken = {
  /** The token's folded surface — the dictionary key. */
  folded: string;
  /** The `[w:]` value (markit `Token.word`). */
  word: string;
  /** The id of the text (document or section) the token appears in. */
  textId: string;
  /** 0-based line of the token's block, when the compile carried positions. */
  line?: number;
};

/** The register-independent accounting summary of one folded surface. */
export type SurfaceSummary = {
  /** Occurrences no register could excuse — neither inside exempting markup
   * nor mechanical — the ones "unaccounted" when the surface has no entry. */
  candidates: number;
  /** 0-based line of the first candidate occurrence's block, when known. */
  line?: number;
};

export type FileDerivations = {
  /** Whether the text is canonically formatted (the formatter's verdict). */
  formatted: boolean;
  /** Every `[w:]`-marked token, in document order. */
  marked: MarkedToken[];
  /** Folded surface → its candidate occurrences within this file. */
  surfaces: Map<string, SurfaceSummary>;
  /** Folded surfaces of tokens inside exempting markup (person / place / org /
   * citation / language). Out of the register but printed, so — unioned with
   * `surfaces` — they complete the corpus's attested vocabulary the way the
   * accounting rule's own walk does (see account.ts `statusOf`, which classes a
   * token exempt before mechanical; the compositor's `vocabularyFromFiles`
   * reads this). */
  exemptSurfaces: Set<string>;
};

/** Derive a compiled file's register-independent data: one walk of every
 * token of every text (both versions, like the accounting rule), plus one
 * formatting pass. */
export const deriveFile = (
  text: string,
  doc: MarkitDocument,
): FileDerivations => {
  const marked: MarkedToken[] = [];
  const surfaces = new Map<string, SurfaceSummary>();
  const exemptSurfaces = new Set<string>();
  const walk = (docText: MarkitDocument): void => {
    for (const block of docText.blocks) {
      const line = block.source?.start.line;
      for (const token of blockTokens(block)) {
        const folded = fold(token.text);
        if (token.word !== undefined) {
          marked.push({ folded, word: token.word, textId: docText.id, line });
        }
        // Exemption before the mechanical class, as `statusOf` orders them: a
        // token inside exempting markup is out of the register but printed.
        if (exemptionOf(token) !== undefined) {
          exemptSurfaces.add(folded);
          continue;
        }
        if (isMechanical(token.text)) continue;
        const summary = surfaces.get(folded);
        if (summary === undefined) {
          surfaces.set(folded, { candidates: 1, line });
        } else {
          summary.candidates++;
        }
      }
    }
    for (const child of docText.children) walk(child);
  };
  walk(doc);
  return { formatted: format(text) === text, marked, surfaces, exemptSurfaces };
};
