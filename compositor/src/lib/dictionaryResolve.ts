/**
 * The resolution rule behind adding a dictionary entry from the editor: a value
 * (a respelling target or a lemma) must bottom out in the register, so before
 * an entry is written every target it names is resolved — already registered,
 * added alongside it, or refused. This encodes the corpus's attestation rule on
 * the write side (see the corpus DICTIONARY.md): a respelling must point to a
 * spelling that appears in the texts, so an unattested spelling target is
 * rejected; a lemma is a citation form and may be unprinted, so an unattested
 * lemma is allowed on explicit confirmation. Pure and vitest-tested; the editor
 * layer (surface/commands/dictionaryDiagnostics.ts) drives the prompts around
 * these decisions and writes the resulting entries across their shards.
 */

import { accountTokens, type Catalogue } from "@earlytexts/corpus";
import { distinctEditionDocuments } from "./catalogueWalk.ts";

/**
 * What resolving a respelling's target spelling requires:
 * - `resolved`: it already has an entry — nothing to do.
 * - `prompt`: add it, choosing among the only kinds that keep the register
 *   valid. A respelling target must gain an *identity* reading, so it is a
 *   modern word or a lemma — never another respelling, which the register
 *   forbids as a chain.
 * - `reject`: it is unattested, and a canonical spelling may not be — the
 *   archaic surface should be its own modern word instead.
 */
export type SpellingResolution =
  | { kind: "resolved" }
  | { kind: "prompt"; choices: Array<"modern" | "lemma"> }
  | { kind: "reject" };

/**
 * What resolving a stated lemma's citation form requires:
 * - `resolved`: it already has an entry.
 * - `add`: give it this value outright — a lemma bottoms out in a modern word,
 *   the one valid shape, so there is no choice to offer.
 * - `confirm`: it is unattested, but a citation form may be unprinted (`datum`
 *   for `data`), so confirm, then add it as a modern word.
 */
export type LemmaResolution =
  { kind: "resolved" } | { kind: "add"; value: null } | { kind: "confirm" };

export const resolveSpellingTarget = (
  target: string,
  inDictionary: (word: string) => boolean,
  inCorpus: (word: string) => boolean,
): SpellingResolution => {
  if (inDictionary(target)) return { kind: "resolved" };
  return inCorpus(target)
    ? { kind: "prompt", choices: ["modern", "lemma"] }
    : { kind: "reject" };
};

export const resolveLemmaTarget = (
  target: string,
  inDictionary: (word: string) => boolean,
  inCorpus: (word: string) => boolean,
): LemmaResolution => {
  if (inDictionary(target)) return { kind: "resolved" };
  return inCorpus(target) ? { kind: "add", value: null } : { kind: "confirm" };
};

/**
 * Every folded surface the corpus attests: the non-mechanical tokens of every
 * edition (a borrowed edition, shared across collections, counted once). The
 * write-side twin of the corpus attestation rule's own vocabulary walk — a
 * respelling target must be a member.
 */
export const corpusVocabulary = (catalogue: Catalogue): Set<string> => {
  const vocab = new Set<string>();
  for (const document of distinctEditionDocuments(catalogue)) {
    for (const token of accountTokens(document, catalogue.dictionary)) {
      if (token.status !== "mechanical") vocab.add(token.folded);
    }
  }
  return vocab;
};
