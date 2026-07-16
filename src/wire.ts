/**
 * The wire contract: the shape of the compiled `catalogue/` output, and how it is
 * written and read back. This is everything a read-side consumer needs — the
 * catalogue types, `serializeCatalogue`, and `loadCatalogue` — and nothing
 * about authoring (scanning, compiling, validating, hints).
 *
 * The computer's application code imports this subpath
 * (`@earlytexts/corpus/wire`) and nothing wider, so the corpus/computer
 * boundary — the computer reads `catalogue/`, it never scans or compiles
 * `.mit` — is enforced by the import graph rather than by convention. (Its
 * tests reach the compiler through `@earlytexts/corpus/test`, to build
 * fixtures; those are the package's only two exports.)
 */

export * from "./catalogue/types.ts";
export * from "./catalogue/serialize.ts";
export * from "./catalogue/deserialize.ts";

// Word semantics on top of Markit's tokenizer — folding, the roman-numeral
// class, exemption policy, the both-versions token stream — so the computer
// and Compositor share one definition of "a word".
export * from "./words.ts";

// The dictionary's wire types — the shape of `catalogue/dictionary.json` (the
// register expanded: explicit spelling + lemma per word per reading) — plus
// the read-side resolution functions: extracting a text's
// `[metadata.dictionary]` overrides and resolving a token's reading by the
// precedence chain (`[w:]` markup → edition override → the entry's default).
// The authoring surface (the entry micro-syntax, shard files, the accounting
// rule, the violation checks) is write-side and stays on the main entry point.
export type { Dictionary, Entry, Reading, Word } from "./dictionary/types.ts";
export type { Overrides } from "./dictionary/resolve.ts";
export {
  overridesOf,
  readingLemma,
  readingSpelling,
  resolveReading,
  selectReading,
} from "./dictionary/resolve.ts";
