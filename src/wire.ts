/**
 * The wire contract: the shape of the compiled `dist/` output, and how it is
 * written and read back. This is everything a read-side consumer needs — the
 * catalogue types, `serializeCatalogue`, and `loadCatalogue` — and nothing
 * about authoring (scanning, compiling, validating, hints).
 *
 * The computer imports this subpath (`@earlytexts/corpus/wire`) instead of
 * the full library, so the corpus/computer boundary — the computer reads
 * `dist/`, it never scans or compiles `.mit` — is enforced by the import
 * graph rather than by convention.
 */

export * from "./types.ts";
export * from "./serialize.ts";
export * from "./deserialize.ts";
