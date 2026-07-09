/**
 * Public entry point for consuming the corpus's logic as a library (the
 * Compositor VSCode extension bundles this). The authoring surface — one door
 * to everything the Compositor needs to build and validate the corpus — so it
 * re-exports the two focused subpaths (`build` and `wire`) that the computer
 * imports in isolation, and adds validation on top. Read-side suggestion logic
 * (markup hints) is the Compositor's own; it does not live here.
 *
 * Ordered by altitude: the build surface first (also exported alone as
 * `@earlytexts/corpus/build`), then the validation rules, then the wire
 * contract (also `@earlytexts/corpus/wire`, all the computer's app code may
 * import), then the foundations both build on.
 */

// The build surface: scan data/, compile, compose, write catalogue/, plus the
// disk-backed CorpusFs binding that drives it.
export * from "./build.ts";

// Validation: the corpus rules that drive corpus validation (part of
// `deno task test`) and the Compositor's editor diagnostics.
export * from "./validate.ts";

// The wire contract: catalogue types, serialize/deserialize, loadCatalogue.
export * from "./wire.ts";

// Foundations: the metadata schema and the path conventions.
export * from "./schema.ts";
export * from "./paths.ts";
