/**
 * The corpus the tree view, diagnostics, and commands share — held **body-free**
 * so its resident memory scales with the corpus's vocabulary and structure, not
 * its file count (see COMPOSITOR_MEMORY_PLAN.md). Instead of a compiled copy of
 * every document, the model keeps one `DerivationRecord` per source file (its
 * register-independent `derived`, its `FileProjection`, its per-file violations,
 * and a block-empty structure `skeleton`) plus a stub-bodied catalogue built
 * from the skeletons. Positioned documents — needed only by search and the
 * edited buffer — are compiled on demand through a bounded cache and released.
 *
 * Cold start seeds everything from the build's `catalogue/derivations.json`
 * (structure via `buildCatalogue` over the skeletons, indexes and doc-free
 * violations via the persisted records) with **no compiles**, so the tree and
 * Problems appear in well under a second rather than after the ~20s cold
 * compile. A background sweep then hashes the sources and, if any changed
 * out-of-session, reconciles (recompiling only the changed files, or a full
 * streamed compile when the set of files changed). A missing or stale
 * derivations file falls back to that full compile, which also rewrites the
 * build output. In-session edits recompile just the touched file and rebuild the
 * indexes/violations/structure from the resident records — no whole-corpus
 * recompile, and no whole-corpus documents resident — then write back just those
 * editions' `catalogue/documents/` (from their recompiled standalone bodies), so
 * the computer's input tracks the edit without the full document rewrite; a
 * deleted edition's document is removed.
 */

import { compileWithPositions } from "@jsr/earlytexts__markit";
import {
  buildCatalogue,
  type Catalogue,
  type CorpusFile,
  type CorpusFs,
  type CorpusFsWrite,
  createValidationCache,
  type DerivationRecord,
  derivationRecord,
  deriveFile,
  type DictionarySnapshot,
  hashText,
  loadCorpus,
  normalizePath,
  precompiledSkeletons,
  readDerivations,
  readDictionarySnapshot,
  sourceDocKeys,
  createCrossFileIndex,
  type FileProjection,
  validateDictionary,
  validateWordAndOverride,
  type Violation,
  writeCatalogue,
  writeCatalogueDictionary,
  writeCatalogueSources,
  writeDerivations,
} from "@earlytexts/corpus";
import { createCompiledFileCache } from "./compiledFileCache.ts";
import { buildTokenIndex, type TokenIndex } from "../dictionary/curation.ts";
import { vocabularyFromFiles } from "../dictionary/resolve.ts";
import { reloadKind } from "./reloadKind.ts";
import {
  createEmitter,
  type Disposable,
  type Event,
} from "../shared/emitter.ts";

/** Watch the corpus's `data/**` for source changes, calling `onEvent` with the
 * absolute fsPath of each created/changed/deleted file. The debounce and
 * coalescing policy stays in the model (see `onEvent` below); the adapter only
 * forwards raw events. Adapter over `vscode.workspace.createFileSystemWatcher`. */
export type CorpusWatcher = (
  root: string,
  onEvent: (path: string) => void,
) => Disposable;

/** The user-facing messages the model needs — currently just the load-failure
 * error. Adapter over `vscode.window.show*`. */
export type Notifier = {
  error: (message: string) => void;
};

/** The outbound ports the model reaches the world through: the corpus
 * filesystem, the source watcher, and user notifications. Production adapters
 * are `nodeCorpusFs` + the vscode watcher/notifier; the tests bring fakes. */
export type CorpusModelDeps = {
  fs: CorpusFsWrite;
  watch: CorpusWatcher;
  notify: Notifier;
};

export type CorpusState = {
  /** Structure only — each `Edition.document` is a stub (its block bodies are
   * empty), rebuilt from the persisted skeletons by `buildCatalogue`. Serves the
   * tree, scoping, compare, scaffolds, and insert-borrowed-ref; consumers that
   * need a positioned body take `getCompiledFile`. */
  catalogue: Catalogue;
  /** Catalogue-build warnings (unresolved children, missing authors, …). */
  warnings: string[];
  /** Every corpus violation, recomposed from the doc-free validation tiers over
   * the resident records (per-file persisted, dict-dependent + cross-file +
   * dictionary recomputed) — never a whole-corpus recompile. */
  violations: Violation[];
  /** The corpus-wide candidate tally per folded surface (see dictionary/curation.ts),
   * merged from the records' per-file summaries. */
  tokenIndex: TokenIndex;
  /** Every folded surface the corpus attests (see dictionary/resolve.ts). */
  vocabulary: Set<string>;
};

/**
 * What a settled load actually changed — the scope each listener narrows its own
 * refresh by, so a one-file save costs work proportional to the file rather than
 * to the corpus. Without it every listener has to assume the worst and re-derive
 * everything, which is what made a single save re-mine the whole corpus.
 */
export type CorpusChange = {
  /** `full` is a whole-corpus rebuild — a cold start, the Rebuild command, a
   * structural change under `data/`, or a failed load: assume everything moved. */
  kind: "full" | "sources" | "dictionary";
  /** The `data/`-relative sources this load recompiled or dropped (empty unless
   * `kind` is `sources`). */
  sources: ReadonlySet<string>;
  /** Whether the catalogue was rebuilt — equivalently, whether any file's
   * skeleton or compile-cleanliness moved, which is exactly the condition under
   * which the cross-file validation tier's inputs can have changed. A body edit
   * that leaves both alone cannot affect any other file. */
  structural: boolean;
};

export type CorpusModel = {
  /** The corpus root (the directory containing data/). */
  readonly root: string;
  /** Undefined until the first load completes; stale while `loading`. */
  readonly state: CorpusState | undefined;
  /** The compiled file for a data/-relative path, compiled on demand and cached
   * (a bounded working set — see lib/compiledFileCache), or undefined when the
   * source is gone. The one path to a positioned body, so no consumer depends on
   * the whole corpus being resident. */
  getCompiledFile: (path: string) => Promise<CorpusFile | undefined>;
  /** Compile one source *without* admitting it to the working-set cache — for
   * the one-shot whole-corpus streams (the markup-hint miner) that would
   * otherwise pull far more than the budget through it and evict the editions
   * actually being worked on. */
  compileTransient: (path: string) => Promise<CorpusFile | undefined>;
  /** The resident `works/**` source paths — the set the markup-hint miner
   * streams through `compileTransient` (see suggestMarkup). */
  workSourcePaths: () => string[];
  readonly loading: boolean;
  /** What to tell the user about the model right now (see the tree/status bar). */
  readonly status: "loading" | "ready" | "failed";
  /** True once a first load has completed — the indexes and violations then
   * reflect real data rather than nothing. */
  readonly loaded: boolean;
  /** A load has begun and the state is now stale — for the spinner and the
   * "reloading" view message, and nothing else. */
  readonly onDidStartLoading: Event<void>;
  /** A load has *settled*, with the scope of what it changed. Fired once per
   * load: a listener never has to filter on `loading` to avoid doing its work
   * twice, and it is handed enough to skip the work the change cannot affect. */
  readonly onDidChange: Event<CorpusChange>;
  /** Recompile everything from disk and rewrite the build output — the
   * "Rebuild catalogue" escape hatch. */
  reload: () => Promise<void>;
  dispose: () => void;
};

const RELOAD_DEBOUNCE_MS = 300;

/** The change a load reports when it cannot say anything narrower. */
const fullChange = (): CorpusChange => ({
  kind: "full",
  sources: new Set(),
  structural: true,
});

/** One file's dict-dependent violations: `[w:]` markup and metadata overrides
 * against the register. The tier is per-file independent, which is what lets a
 * save re-derive only the files it touched. */
const wordAndOverrideOf = (
  record: DerivationRecord,
  dictionary: DictionarySnapshot,
): Violation[] =>
  validateWordAndOverride(
    [
      {
        path: record.projection.path,
        clean: record.projection.clean,
        marked: record.derived.marked,
        overrides: record.projection.overrides,
      },
    ],
    dictionary,
  );

export const createCorpusModel = (
  root: string,
  { fs, watch, notify }: CorpusModelDeps,
): CorpusModel => {
  const startEmitter = createEmitter<void>();
  const changeEmitter = createEmitter<CorpusChange>();
  /** One record per source `.mit`, keyed by data/-relative path: the whole
   * resident corpus, bounded by file count in structure but never holding a
   * positioned body. */
  const records = new Map<string, DerivationRecord>();
  /** The on-demand working set of positioned documents (search, the edited
   * buffer): the only place bodies live, and byte-bounded. */
  const compiledCache = createCompiledFileCache((path) =>
    fs.readFile(`${root}/data/${path}`),
  );
  /** Memos for the fixed reference files the dictionary tier reads — one
   * session, one parse of the 106k-line word list. */
  const cache = createValidationCache();
  let state: CorpusState | undefined;
  let loading = false;
  let loaded = false;

  /* -------------------------- reductions -------------------------- */

  /** The records as the indexes read them: path + derivations. */
  const derivedFiles = (): {
    path: string;
    derived: DerivationRecord["derived"];
  }[] => [...records].map(([path, r]) => ({ path, derived: r.derived }));

  /** Rebuild the token index and attested vocabulary from the records. */
  const seedIndexes = (): {
    tokenIndex: TokenIndex;
    vocabulary: Set<string>;
  } => ({
    tokenIndex: buildTokenIndex(derivedFiles(), root),
    vocabulary: vocabularyFromFiles(derivedFiles()),
  });

  /**
   * The doc-free tiers' output, held per tier so a load re-runs only the tiers
   * its change can touch and serves the rest from the last run. The per-file
   * tier is not here — it is persisted on the records themselves.
   */
  const tiers = {
    /** By `data/`-relative path: the tier is per-file independent, so a save
     * re-derives only the files it touched. */
    wordAndOverride: new Map<string, Violation[]>(),
    crossFile: [] as Violation[],
    dictionary: [] as Violation[],
  };

  /** Which tiers a load has to re-run (see `recomputeViolations`). */
  type ViolationScope =
    | { kind: "all" }
    | { kind: "sources"; paths: ReadonlySet<string>; structural: boolean }
    | { kind: "dictionary" };

  /**
   * Recompose every violation from the doc-free tiers over the records, running
   * only the tiers the change can have moved:
   *
   *  - **per-file** — persisted on the records, re-derived by the recompile.
   *  - **dict-dependent** — per file, so a save re-derives just the saved files;
   *    a register edit re-derives all of them.
   *  - **cross-file** — the only tier that touches the filesystem, and it does so
   *    heavily (a recursive walk of `data/**` plus a resolution probe per stub
   *    and per borrowed ref: thousands of syscalls). It reads nothing but the
   *    projections' structure and their compile-cleanliness, both of which a
   *    non-structural save leaves alone — so that save skips it entirely, and a
   *    structural one goes through the index, which re-probes only the files the
   *    change could have reached (see the corpus's validation/crossFile.ts).
   *  - **dictionary** — shards and reference files only; a `.mit` save cannot
   *    move it.
   */
  const recomputeViolations = async (
    scope: ViolationScope,
  ): Promise<Violation[]> => {
    const recs = [...records.values()];
    const dictionary = await dictionarySnapshot(scope.kind !== "sources");

    if (scope.kind === "sources") {
      for (const path of scope.paths) {
        const record = records.get(path);
        if (record === undefined) tiers.wordAndOverride.delete(path);
        else {
          tiers.wordAndOverride.set(
            path,
            wordAndOverrideOf(record, dictionary),
          );
        }
      }
    } else {
      tiers.wordAndOverride.clear();
      for (const record of recs) {
        tiers.wordAndOverride.set(
          record.projection.path,
          wordAndOverrideOf(record, dictionary),
        );
      }
    }

    if (scope.kind === "all") {
      tiers.crossFile = await crossFile.reset(recs.map((r) => r.projection));
    } else if (scope.kind === "sources" && scope.structural) {
      const changes = new Map<string, FileProjection | undefined>();
      for (const path of scope.paths) {
        changes.set(path, records.get(path)?.projection);
      }
      tiers.crossFile = await crossFile.update(changes);
    }

    if (scope.kind !== "sources") {
      tiers.dictionary = await validateDictionary({
        fs,
        root,
        dictionary,
        cache,
      });
    }

    return [
      ...recs.flatMap((r) => r.violations),
      // In first-seen file order (a re-set keeps a key's position), so the
      // Problems list is stable across loads whichever tier last ran.
      ...[...tiers.wordAndOverride.values()].flat(),
      ...tiers.crossFile,
      ...tiers.dictionary,
    ];
  };

  /** The cross-file tier as a resident index rather than a sweep, so a
   * structural save re-probes only the files its change could have reached. */
  const crossFile = createCrossFileIndex({ fs, root });

  /** The register as this load sees it. Held between loads: only a dictionary
   * edit can change it, and both reading and expanding it are passes over every
   * entry — so a `.mit` save reuses the snapshot rather than redoing either. */
  let register: DictionarySnapshot | undefined;
  const dictionarySnapshot = async (
    refresh: boolean,
  ): Promise<DictionarySnapshot> => {
    if (refresh || register === undefined) {
      register = await readDictionarySnapshot(fs, root);
    }
    return register;
  };

  /** Rebuild the stub-bodied catalogue from the records' skeletons — a fast
   * (~compile-free) `buildCatalogue`, so structure stays correct after any edit
   * without a whole-corpus recompile. */
  const buildStructure = (): Promise<{
    catalogue: Catalogue;
    warnings: string[];
  }> => buildCatalogue(fs, root, precompiledSkeletons(records, root));

  /** Rebuild the whole resident state from the current records. */
  const stateFromRecords = async (): Promise<CorpusState> => {
    const [{ catalogue, warnings }, violations] = await Promise.all([
      buildStructure(),
      recomputeViolations({ kind: "all" }),
    ]);
    return { catalogue, warnings, violations, ...seedIndexes() };
  };

  /* --------------------------- disk write-back --------------------------- */

  // A background writer that keeps the build output fresh (the Compositor's own
  // next cold start, and the computer's dev input) without stacking writes or
  // blocking a load. Two scopes: a *full* rewrite (loadFull — the whole
  // `catalogue/` + derivations) and a *docs* write-back (loadIncremental — just
  // the changed editions' documents, plus catalogue.json/dictionary.json). A
  // full rewrite supersedes any pending docs write; a burst of saves coalesces
  // into one docs write, keyed by source so the last operation on each file
  // wins (a re-save overwrites, a delete drops a pending write, and vice versa).
  type PendingWrite =
    | { kind: "full"; run: () => Promise<void> }
    | {
        kind: "docs";
        /** root-relative source path → its freshly compiled standalone doc. */
        docs: Map<string, CorpusFile["doc"]>;
        /** root-relative source path → the docKey to remove (a deleted edition). */
        removals: Map<string, string>;
      }
    /** A register edit: `dictionary.json` (and `catalogue.json`, whose warnings
     * may mention dropped entries) only — the documents are untouched. */
    | { kind: "dictionary" };
  let pending: PendingWrite | undefined;
  let writing = false;
  const drainWrites = (): void => {
    if (writing) return;
    writing = true;
    void (async () => {
      try {
        while (pending !== undefined) {
          const next = pending;
          pending = undefined;
          try {
            if (next.kind === "full") await next.run();
            else if (state === undefined) {
              // nothing resident to serialise; the next load refreshes it
            } else if (next.kind === "dictionary") {
              await writeCatalogueDictionary(
                fs,
                root,
                state.catalogue,
                state.warnings,
              );
            } else {
              await writeCatalogueSources(
                fs,
                root,
                state.catalogue,
                state.warnings,
                next.docs,
                new Set(next.removals.values()),
              );
            }
          } catch {
            // a failed write only costs the cache; the next load refreshes it
          }
        }
      } finally {
        writing = false;
      }
    })();
  };
  const enqueueFull = (run: () => Promise<void>): void => {
    pending = { kind: "full", run }; // supersedes any pending docs write
    drainWrites();
  };
  /** Refresh `catalogue/dictionary.json` after a register edit — without it the
   * computer's input silently drifts from the shards until the next `.mit` save
   * or full rebuild. Superseded by any wider pending write, which covers it. */
  const enqueueDictionary = (): void => {
    if (pending !== undefined) return; // a pending full/docs write covers it
    pending = { kind: "dictionary" };
    drainWrites();
  };
  const enqueueDocs = (
    docs: Map<string, CorpusFile["doc"]>,
    removals: Map<string, string>,
  ): void => {
    if (pending?.kind === "full") return; // the pending full covers everything
    if (pending === undefined || pending.kind === "dictionary") {
      // A docs write rewrites dictionary.json too, so it absorbs a pending one.
      pending = { kind: "docs", docs: new Map(), removals: new Map() };
    }
    for (const [source, doc] of docs) {
      pending.removals.delete(source);
      pending.docs.set(source, doc);
    }
    for (const [source, docKey] of removals) {
      pending.docs.delete(source);
      pending.removals.set(source, docKey);
    }
    drainWrites();
  };

  /* ----------------------------- compiling ----------------------------- */

  /** Compile one source into a full `CorpusFile` (or undefined if it is gone). */
  const compileOne = async (path: string): Promise<CorpusFile | undefined> => {
    const text = await fs.readFile(`${root}/data/${path}`);
    if (text === null) return undefined;
    const { document: doc, errors } = compileWithPositions(text);
    return { path, text, doc, errors, derived: deriveFile(text, doc) };
  };

  /* ------------------------------- loads ------------------------------- */

  /**
   * A full streamed compile: compile every source (transient peak), reduce each
   * to its record, then release the documents. Rewrites the whole build output
   * (`catalogue/` for the computer, with real bodies, plus `derivations.json`).
   * The fallback when the derivations cache is missing/stale, and the path a
   * structural change and the Rebuild command take.
   */
  const loadFull = async (): Promise<CorpusChange> => {
    const files = await loadCorpus(fs, root);
    records.clear();
    compiledCache.clear();
    for (const file of files) {
      records.set(
        file.path,
        await derivationRecord(file, {
          fs,
          root,
        }),
      );
    }
    state = await stateFromRecords();
    // Write the computer's catalogue/ from the full-bodied documents (this needs
    // the bodies, so it happens before they are dropped), plus derivations.
    const precompiled = new Map(
      files.map(
        (f) => [normalizePath(`${root}/data/${f.path}`), f.doc] as const,
      ),
    );
    const full = await buildCatalogue(fs, root, precompiled);
    const snapshot = new Map(records);
    enqueueFull(async () => {
      await writeCatalogue(fs, root, full.catalogue, full.warnings);
      await writeDerivations(fs, root, snapshot);
    });
    // `files`/`full` fall out of scope here — only the records and stubs remain.
    return fullChange();
  };

  /** Recompile just the touched sources and rebuild the resident state from the
   * records. Structure is rebuilt only when a skeleton actually changed (a body
   * edit leaves it untouched), so a plain content save skips the catalogue pass. */
  const loadIncremental = async (paths: Set<string>): Promise<CorpusChange> => {
    // A deleted edition's document is located by the docKey it *had* before this
    // save mutated the catalogue, so capture the mapping lazily (only when a
    // delete is actually seen) off the pre-edit catalogue.
    let docKeysBefore: Map<string, string> | undefined;
    const removalDocKey = async (
      source: string,
    ): Promise<string | undefined> => {
      if (state === undefined) return undefined;
      if (docKeysBefore === undefined) {
        const real = await fs.realPath(root).catch(() => root);
        docKeysBefore = sourceDocKeys(state.catalogue, real);
      }
      return docKeysBefore.get(source);
    };

    // Changed editions' standalone docs (source-keyed as sourceDocKeys keys
    // them, `data/`-relative) and deleted editions' documents, for the write-back.
    const changedDocs = new Map<string, CorpusFile["doc"]>();
    const removals = new Map<string, string>();
    // "Structural" is skeleton *or* compile-cleanliness: the catalogue is built
    // from skeletons alone, but `projection.clean` gates every cross-file rule
    // and is not skeleton-derived (an unclosed inline tag leaves the id,
    // metadata, and children a skeleton keeps entirely untouched). Folding both
    // into one flag keeps "not structural ⇒ no other file's validity moved" true,
    // at the cost of a rare needless catalogue pass when a file stops compiling.
    let structural = false;
    for (const path of paths) {
      const source = `data/${path}`;
      compiledCache.invalidate(path);
      const file = await compileOne(path);
      if (file === undefined) {
        if (records.delete(path)) structural = true;
        const docKey = await removalDocKey(source);
        if (docKey !== undefined) removals.set(source, docKey);
        continue;
      }
      const before = records.get(path);
      const record = await derivationRecord(file, { fs, root });
      records.set(path, record);
      structural ||=
        before === undefined ||
        before.projection.clean !== record.projection.clean ||
        JSON.stringify(before.skeleton) !== JSON.stringify(record.skeleton);
      changedDocs.set(source, file.doc);
      // Keep the file the user just saved warm: it has been compiled already,
      // and search and hover will want it next.
      compiledCache.put(path, file);
    }
    // With nothing resident (a previous load failed) there is no structure to
    // reuse, so the load rebuilds regardless of what the files did.
    const resident = state;
    const catalogue =
      resident === undefined || structural
        ? await buildStructure()
        : { catalogue: resident.catalogue, warnings: resident.warnings };
    state = {
      ...catalogue,
      violations: await recomputeViolations({
        kind: "sources",
        paths,
        structural: structural || resident === undefined,
      }),
      ...seedIndexes(),
    };
    // Write just the touched editions' documents (from their recompiled
    // standalone bodies) plus catalogue.json/dictionary.json — so the computer's
    // input tracks in-session edits, without the ~60MB full document rewrite or
    // any whole-corpus body resident. A delete removes its stale document.
    // The derivations cache is *not* rewritten per save (it is 10s of MB): the
    // next cold start's hash sweep recompiles just these touched files, so the
    // in-memory state is fresh now and the disk cache reconciles cheaply later.
    if (changedDocs.size > 0 || removals.size > 0) {
      enqueueDocs(changedDocs, removals);
    }
    return {
      kind: "sources",
      sources: paths,
      structural: structural || resident === undefined,
    };
  };

  /** A dictionary-shard edit: the documents are untouched (records stay valid),
   * so only the dictionary-dependent and dictionary tiers re-run — no recompiles,
   * and the token index/vocabulary (register-independent) are reused. */
  const loadDictionary = async (): Promise<CorpusChange> => {
    if (state === undefined) return loadFull();
    const violations = await recomputeViolations({ kind: "dictionary" });
    // A shard edit changes exactly one thing in the catalogue — the expanded
    // register — so splice it in rather than re-walking `data/**` to rebuild the
    // structure around it. Leaving it stale is what made a just-registered word
    // keep its squiggle and its old hover reading until the next `.mit` save.
    state = {
      ...state,
      catalogue: {
        ...state.catalogue,
        dictionary: (await dictionarySnapshot(false)).expanded(),
      },
      violations,
    };
    enqueueDictionary();
    return { kind: "dictionary", sources: new Set(), structural: false };
  };

  /* ---------------------------- cold start ---------------------------- */

  /**
   * Seed from `catalogue/derivations.json` with no compiles, then reconcile in
   * the background. A missing/stale/foreign cache (a fresh clone has none — it is
   * gitignored) falls through to a full compile.
   */
  const coldStart = async (): Promise<CorpusChange> => {
    const derivations = await readDerivations(fs, root).catch(() => null);
    const real = await fs.realPath(root).catch(() => root);
    if (derivations === null || derivations.root !== real) return loadFull();
    records.clear();
    for (const [path, record] of derivations.records) records.set(path, record);
    state = await stateFromRecords();
    // Reconcile out-of-session changes in the background (below), after the
    // instant seed has been shown.
    return fullChange();
  };

  /** After the instant seed, hash every source and reconcile: unchanged → done;
   * only contents changed → recompile those; the file set changed → full reload. */
  const sweep = async (): Promise<void> => {
    const diskPaths = await sourcePaths(fs, root);
    const changed = new Set<string>();
    let structural = false;
    for (const path of diskPaths) {
      const text = await fs.readFile(`${root}/data/${path}`);
      if (text === null) continue;
      const record = records.get(path);
      if (
        record !== undefined &&
        record.size === text.length &&
        record.hash === hashText(text)
      ) {
        continue;
      }
      changed.add(path);
      if (record === undefined) structural = true; // a new file
    }
    for (const path of records.keys()) {
      if (!diskPaths.has(path)) structural = true; // a removed file
    }
    if (structural) return run(loadFull);
    if (changed.size > 0) return run(() => loadIncremental(changed));
  };

  /* --------------------------- orchestration --------------------------- */

  // One load at a time; a request arriving mid-load is coalesced and replayed.
  let queued: (() => Promise<CorpusChange>) | undefined;
  const run = (task: () => Promise<CorpusChange>): void => {
    if (loading) {
      queued = task; // latest-wins: a newer request supersedes a queued one
      return;
    }
    loading = true;
    startEmitter.fire();
    void (async () => {
      // A load that threw leaves nothing trustworthy resident, so the fan-out is
      // told to assume everything moved.
      let change = fullChange();
      try {
        change = await task();
      } catch (error) {
        state = undefined;
        const message = error instanceof Error ? error.message : String(error);
        notify.error(`Compositor: corpus load failed: ${message}`);
      } finally {
        loading = false;
        loaded = true;
        changeEmitter.fire(change);
      }
      if (queued !== undefined) {
        const next = queued;
        queued = undefined;
        run(next);
      }
    })();
  };

  /* ------------------------------ watcher ------------------------------ */

  let timer: ReturnType<typeof setTimeout> | undefined;
  let pendingFull = false;
  let pendingPaths = new Set<string>();
  const onEvent = (path: string): void => {
    const rel = path.startsWith(`${root}/data/`)
      ? path.slice(`${root}/data/`.length)
      : undefined;
    const kind = rel === undefined ? "full" : reloadKind(rel);
    // A .mit create/change/delete is handled incrementally: the touched file is
    // recompiled (or dropped) and the structure/indexes/violations rebuilt from
    // the records. A dictionary shard revalidates without recompiling. Anything
    // else is structural and takes the full reload.
    if (kind === "recompile") pendingPaths.add(rel!);
    else if (kind === "full") pendingFull = true;
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      const full = pendingFull;
      const paths = pendingPaths;
      pendingFull = false;
      pendingPaths = new Set();
      if (full) run(loadFull);
      else if (paths.size > 0) run(() => loadIncremental(paths));
      else run(loadDictionary);
    }, RELOAD_DEBOUNCE_MS);
  };

  const watcher = watch(root, onEvent);

  // Kick off: instant seed (or full compile), then the background reconcile.
  run(async () => {
    const change = await coldStart();
    void sweep();
    return change;
  });

  return {
    root,
    get state() {
      return state;
    },
    getCompiledFile: (path) => compiledCache.get(path),
    compileTransient: compileOne,
    workSourcePaths: () =>
      [...records.keys()].filter((p) => p.startsWith("works/")),
    get loading() {
      return loading;
    },
    get status() {
      if (loading || !loaded) return "loading";
      return state === undefined ? "failed" : "ready";
    },
    get loaded() {
      return loaded;
    },
    onDidStartLoading: startEmitter.event,
    onDidChange: changeEmitter.event,
    reload: () => {
      // Fire-and-forget: the tree and Problems refresh via onDidChange when the
      // rebuild settles, so the command need not block on it.
      run(loadFull);
      return Promise.resolve();
    },
    dispose: () => {
      if (timer !== undefined) clearTimeout(timer);
      watcher.dispose();
      startEmitter.dispose();
      changeEmitter.dispose();
    },
  };
};

/** Every `.mit` source under `data/authors` and `data/works`, data/-relative —
 * the set the sweep hashes and the full load walks. */
const sourcePaths = async (
  fs: CorpusFs,
  root: string,
): Promise<Set<string>> => {
  const out = new Set<string>();
  const walk = async (dir: string): Promise<void> => {
    let entries;
    try {
      entries = await fs.readDir(`${root}/data/${dir}`);
    } catch {
      return;
    }
    for (const entry of entries) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory) await walk(rel);
      else if (entry.name.endsWith(".mit")) out.add(rel);
    }
  };
  await walk("authors");
  await walk("works");
  return out;
};
