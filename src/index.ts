/**
 * Public entry point for consuming the corpus's logic as a library (the
 * Compositor VSCode extension bundles this). The full authoring surface — one
 * door to everything the Compositor needs — so it re-exports the two focused
 * subpaths (`build` and `wire`) that the computer imports in isolation, and
 * adds the authoring-only rules on top.
 *
 * Ordered by altitude: the build surface first (also exported alone as
 * `@earlytexts/corpus/build`), then authoring rules, then the wire contract
 * (also `@earlytexts/corpus/wire`, all the computer's app code may import),
 * then the foundations both build on.
 */

// The build surface: scan data/, compile, compose, write catalogue/, plus the
// disk-backed CorpusFs binding that drives it.
export * from "./build.ts";

// Authoring support: validation rules and markup hints (the Compositor's
// diagnostics and suggestions).
export * from "./validate.ts";
export * from "./hints.ts";

// The wire contract: catalogue types, serialize/deserialize, loadCatalogue.
export * from "./wire.ts";

// Foundations: the metadata schema and the path conventions.
export * from "./schema.ts";
export * from "./paths.ts";
