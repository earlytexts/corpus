/**
 * In-repo entry point for consuming the corpus's logic as a library: the
 * Compositor VSCode extension bundles this from source (it lives inside the
 * corpus package, so it never goes via the published tarball). The authoring
 * surface — one door to everything the Compositor needs to build and validate
 * the corpus: the build functions, the validation rules, the dictionary
 * authoring logic, and the wire contract on top. Read-side suggestion logic
 * (markup hints) is the Compositor's own; it does not live here.
 *
 * Not a published export: the package ships only `wire` (the computer's
 * read-side) and `test` (the fixture harness). This barrel is the wider surface
 * the Compositor pulls from the checkout directly.
 *
 * Ordered by altitude: the build surface first, then the validation rules, then
 * the wire contract (also published as `@earlytexts/corpus/wire`, which the
 * computer's app code imports), then the foundations both build on.
 */

// The build surface: scan data/, compile, compose, write catalogue/, plus the
// disk-backed CorpusFs binding that drives it.
export * from "./build.ts";

// Validation: the corpus rules that drive corpus validation (part of
// `deno task test`) and the Compositor's editor diagnostics.
export * from "./validation/rules.ts";

// The dictionary: the curated register of surface forms — the accounting rule,
// the `[w:]`/override resolution, the shard micro-syntax, and expansion with
// its register-level violations. (Word identity — words.ts — arrives via the
// wire contract below.)
export * from "./dictionary/types.ts";
export * from "./dictionary/account.ts";
export * from "./dictionary/resolve.ts";
export * from "./dictionary/shards.ts";
export * from "./dictionary/expand.ts";

// The wire contract: catalogue types, serialize/deserialize, loadCatalogue.
export * from "./wire.ts";

// Foundations: the metadata schema, the path conventions, and the fs ports.
export * from "./validation/schema.ts";
export * from "./paths.ts";
export * from "./ports.ts";
