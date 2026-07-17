/**
 * How a change under `data/` should reload the corpus model — the pure decision
 * behind the model's filesystem watcher.
 *
 * A `.mit` file recompiles just itself (the compiled document is stale). A
 * dictionary shard changes no *documents* — the compiled files stay valid — so
 * it only needs validation and the catalogue build re-run, both of which re-read
 * the dictionary from disk; recompiling the whole corpus (its ~20s cold path)
 * would be pure waste, and the waste is what the OOM was made of. Anything else
 * under `data/` (a new/renamed/deleted directory, a metadata file that is not a
 * `.mit`) is structural and needs the full reload.
 */
export type ReloadKind = "recompile" | "revalidate" | "full";

/** Classify a `data/`-relative path (the part after `data/`). */
export const reloadKind = (relPath: string): ReloadKind =>
  relPath.endsWith(".mit")
    ? "recompile"
    : relPath.startsWith("dictionary/")
      ? "revalidate"
      : "full";
