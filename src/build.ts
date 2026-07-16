/**
 * The build-time surface: compile the corpus's `data/` into the `catalogue/`
 * output, plus the disk-backed `CorpusFs` binding that drives it. This is
 * everything a host needs to *produce* the catalogue — and nothing about
 * authoring rules (validation, hints) or reading it back (that's `wire`).
 *
 * In-repo barrel only: it is re-exported from `index.ts` for the Compositor
 * (which bundles the corpus from source), and mirrors `scripts/build.ts`. It is
 * no longer a published subpath — the computer builds the catalogue by running
 * the corpus checkout's own `deno task build`, and only reaches for the
 * compiler itself (`buildCatalogue`, via `@earlytexts/corpus/test`) to compile
 * fixtures in its tests.
 */

// The catalogue build: scan data/, compile, compose, write catalogue/.
export * from "./catalogue/compile.ts";
export * from "./catalogue/write.ts";

// The disk-backed CorpusFs binding (node:fs, which Deno provides too) that the
// build runs on.
export * from "./fs.ts";
