/**
 * Manual corrections to the mined language lexicons, applied on top of the
 * frequency classifier in `buildHints` (hints.ts). This is the fallback the
 * hint design anticipates: most English homographs are caught automatically
 * (a marked word that is also common in unmarked English text is demoted to
 * "weak", matching only inside a cluster), but a residue needs a human's call.
 *
 * Per language code:
 *  - `strong`: force a word to match on its own (rare true positives the
 *    frequency rule demoted because they also appear in unmarked passages).
 *  - `weak`:   demote a word to cluster-only (English words the classifier
 *    kept strong because the corpus happens to mark them more than it leaves
 *    them unmarked — e.g. Latin words that are also English but seldom used
 *    in the plain text of these particular texts).
 *  - `ignore`: drop a word from the lexicon entirely (noise: Latin words that
 *    are indistinguishable from ordinary English, or scanning artefacts).
 *
 * Grow this table as false positives surface. Words are folded (lowercase,
 * accents/ligatures stripped) exactly as `foldWord` produces them.
 */

import type { HintOverrides } from "./hints.ts";

export const hintOverrides: HintOverrides = {
  la: {
    // Bare Latin words that read as ordinary capitalised English and fired as
    // lone matches ("major"/"minor" premises in Hobbes); cluster-only now.
    weak: ["major", "minor", "genus", "species", "item", "circa", "via"],
  },
  fr: {
    // Too few French spans yet to classify reliably; nudge the obvious ones.
    weak: ["point", "chose", "police"],
  },
};
