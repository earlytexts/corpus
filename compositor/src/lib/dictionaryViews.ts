/**
 * The two cross-cut views the dictionary panel browses, derived purely from the
 * authored (raw) dictionary. The shards are keyed by *surface*, so neither view
 * the curator wants is local: a variant-spelling map is the scattered handful of
 * cross-reference entries, and a lemma's forms are its headword plus every
 * inflection pointing back at it (often alphabetically adjacent, but scattered
 * for irregulars — went/go). Both are reconstructed here in one pass so the
 * panel can filter by letter and paginate over them; editing still writes single
 * surface entries back through `dictionaryEdits.ts`.
 */

import { type RawDictionary, shardOf } from "@earlytexts/corpus";

/** A variant-spelling map: a surface whose entry cross-references modern
 * spelling(s). Usually one spelling (shew → show); more for a contraction
 * (she's → she is); `ambiguous` when the entry has other readings too. */
export type VariantRow = {
  surface: string;
  spellings: string[];
  ambiguous: boolean;
  letter: string;
};

/** A lemma with all its forms: the citation form, whether it is itself an
 * authored headword (an entry of its own, not merely referenced), and the
 * inflected surfaces pointing at it. Bucketed by the lemma's letter. */
export type LemmaRow = {
  lemma: string;
  headword: boolean;
  forms: string[];
  letter: string;
};

export type DictionaryViews = {
  variants: VariantRow[];
  lemmas: LemmaRow[];
};

/** Both views in one pass over the raw dictionary. A `{lemma}` reading feeds
 * the lemma view (as a headword when the lemma is the surface itself, else as a
 * form); a `{spellings}` reading feeds the variant view. An ambiguous entry can
 * do both. Variants sort by surface, lemmas by lemma, forms within a lemma. */
export const dictionaryViews = (dictionary: RawDictionary): DictionaryViews => {
  const variants: VariantRow[] = [];
  const lemmas = new Map<string, { headword: boolean; forms: Set<string> }>();
  const bucket = (lemma: string) => {
    const group = lemmas.get(lemma) ?? { headword: false, forms: new Set() };
    lemmas.set(lemma, group);
    return group;
  };

  for (const surface of Object.keys(dictionary)) {
    const { readings } = dictionary[surface];
    let crossReference: string[] | undefined;
    for (const reading of readings) {
      if ("lemma" in reading) {
        const group = bucket(reading.lemma);
        if (reading.lemma === surface) group.headword = true;
        else group.forms.add(surface);
      } else if (crossReference === undefined) {
        crossReference = reading.spellings;
      }
    }
    if (crossReference !== undefined) {
      variants.push({
        surface,
        spellings: crossReference,
        ambiguous: readings.length > 1,
        letter: letterOf(surface),
      });
    }
  }

  return {
    variants: variants.sort((a, b) => compare(a.surface, b.surface)),
    lemmas: [...lemmas.entries()]
      .map(([lemma, group]) => ({
        lemma,
        headword: group.headword,
        forms: [...group.forms].sort(compare),
        letter: letterOf(lemma),
      }))
      .sort((a, b) => compare(a.lemma, b.lemma)),
  };
};

/** The shard letter a surface buckets under: `a`–`z`, or `other` for a
 * first letter outside that range (œconomy) — `shardOf` without the `.json`. */
export const letterOf = (surface: string): string =>
  shardOf(surface).replace(/\.json$/, "");

/** Codepoint order — the same ordering the corpus's `shardDictionary` sorts
 * keys by, so a view row sits where its entry sits in the shard file. */
const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
