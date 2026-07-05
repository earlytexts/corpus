/**
 * Public entry point for consuming the corpus's logic as a library (the
 * Compositor VSCode extension bundles this). Runtime-neutral: everything takes
 * a `CorpusFs`, so callers bring their own filesystem binding. The disk-backed
 * binding (fs.ts, on node:fs) is a separate export — `@earlytexts/corpus/fs` —
 * so this entry point stays free of platform imports.
 *
 * Ordered by altitude: the authoring pipeline first, then the wire contract
 * (also exported alone as `@earlytexts/corpus/wire`, which is all the
 * computer may import), then the foundations both build on.
 */

// The catalogue build: scan data/, compile, compose, write dist/.
export * from "./catalogue.ts";
export * from "./dist.ts";

// Authoring support: validation rules and markup hints (the Compositor's
// diagnostics and suggestions).
export * from "./validate.ts";
export * from "./hints.ts";

// The wire contract: catalogue types, serialize/deserialize, loadCatalogue.
export * from "./wire.ts";

// Foundations: the metadata schema and the path conventions.
export * from "./schema.ts";
export * from "./paths.ts";
