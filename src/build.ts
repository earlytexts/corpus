/**
 * The build-time surface: compile the corpus's `data/` into the `catalogue/`
 * output, plus the disk-backed `CorpusFs` binding that drives it. This is
 * everything a host needs to *produce* the catalogue — and nothing about
 * authoring rules (validation, hints) or reading it back (that's `wire`).
 *
 * The computer imports this subpath (`@earlytexts/corpus/build`) for its Deno
 * build wrapper — the one place its build seam touches the corpus compiler —
 * while its application code stays fenced to `@earlytexts/corpus/wire`.
 */

// The catalogue build: scan data/, compile, compose, write catalogue/.
export * from "./catalogue/compile.ts";
export * from "./catalogue/write.ts";

// The disk-backed CorpusFs binding (node:fs, which Deno provides too) that the
// build runs on.
export * from "./fs.ts";
