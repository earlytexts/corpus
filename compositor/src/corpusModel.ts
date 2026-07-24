/**
 * The in-memory corpus shared by the tree view, the diagnostics, and the
 * commands: one compile pass feeds both the validation rules and the catalogue
 * build (which reuses the compiled documents instead of compiling again), and
 * computes each file's register-independent derivations (formatting verdict,
 * marked tokens, surface tallies) so no later reload re-tokenizes or
 * re-formats an unchanged file. A filesystem watcher keeps it fresh — saving a
 * .mit file recompiles just that file, and saving a dictionary shard reuses
 * every compiled file and the token index outright, so either reload costs
 * well under a second rather than the ~10s of a cold start.
 *
 * The cold start itself is masked by the corpus's compiled `catalogue/`: if it is
 * present the tree shows from it immediately (no violations yet — serialised
 * documents carry no source ranges, so diagnostics always wait for the real
 * compile), and every completed load writes `catalogue/` back, keeping the cache —
 * which is also the computer's input — fresh for next time.
 */

import * as vscode from "vscode";
import { compileWithPositions } from "@jsr/earlytexts__markit";
import {
  buildCatalogue,
  type Catalogue,
  catalogueReader,
  type CorpusFile,
  deriveFile,
  loadCatalogue,
  loadCorpus,
  nodeCorpusFs,
  normalizePath,
  validateCorpus,
  type Violation,
  type Work,
  writeCatalogue,
  writeCatalogueDictionary,
  writeCatalogueSources,
} from "@earlytexts/corpus";
import {
  createCatalogueWriteBack,
  type WriteScope,
} from "./lib/catalogueWriteBack.ts";
import { buildTokenIndex, type TokenIndex } from "./lib/curation.ts";
import { vocabularyFromFiles } from "./lib/dictionaryResolve.ts";
import { reloadKind } from "./lib/reloadKind.ts";

export type CorpusState = {
  catalogue: Catalogue;
  /** Catalogue-build warnings (unresolved children, missing authors, …). */
  warnings: string[];
  violations: Violation[];
  /** The corpus-wide candidate tally per folded surface (see lib/curation.ts)
   * — merged from the files' per-compile summaries, reused untouched across
   * dictionary-only reloads, and empty until the first full load (the
   * catalogue cache carries no token data). */
  tokenIndex: TokenIndex;
  /** Every folded surface the corpus attests (see dictionaryResolve.ts,
   * `vocabularyFromFiles`): register-independent, so — like the token index —
   * built once per document generation and reused untouched across
   * dictionary-only reloads; empty until the first full load. The quick-fix
   * reads it to resolve a respelling/lemma target without re-walking the
   * corpus. */
  vocabulary: Set<string>;
};

export type CorpusModel = {
  /** The corpus root (the directory containing data/). */
  readonly root: string;
  /** Undefined until the first load completes; stale while `loading`. */
  readonly state: CorpusState | undefined;
  /** The compiled files keyed by data/-relative path — the same map the loads
   * keep fresh incrementally. Empty until the first full compile (the
   * catalogue cache seeds `state` alone; serialised documents carry no source
   * ranges, so consumers that need positions must read from here). */
  readonly compiledFiles: ReadonlyMap<string, CorpusFile>;
  readonly loading: boolean;
  /** What to tell the user about the model right now. `loading` covers the whole
   * run-up to the first result (the constructor always kicks a load off, so the
   * model is never idly stateless) and any later reload; `ready` once there is
   * state; `failed` only once a completed load has left none. This is the single
   * source of truth for the tree and status-bar messages — never derive the
   * phase from `loading`/`state` directly, or the pre-first-load window reads as
   * a failure. */
  readonly status: "loading" | "ready" | "failed";
  /** True once a full load has completed — the token index and violations then
   * reflect a real compile, not the provisional catalogue-cache seed (whose
   * token index is empty). Stays true across later reloads, so consumers of the
   * token index (the curation backlog) don't flicker during a reload. */
  readonly loaded: boolean;
  readonly onDidChange: vscode.Event<void>;
  /** Recompile everything from disk. */
  reload: () => Promise<void>;
  dispose: () => void;
};

const RELOAD_DEBOUNCE_MS = 300;

export const createCorpusModel = (root: string): CorpusModel => {
  const emitter = new vscode.EventEmitter<void>();
  /** Compiled files keyed by data/-relative path, kept fresh incrementally. */
  const files = new Map<string, CorpusFile>();
  let state: CorpusState | undefined;
  let loading = false;
  /** Whether a full load() body has ever run to completion. Distinguishes the
   * pre-first-load window (state undefined but nothing has failed) from a real
   * failure, and marks the token index as real rather than cache-seeded. */
  let loaded = false;
  /** Changes that arrived mid-load, replayed afterwards. undefined = idle. */
  let queuedFull = false;
  let queuedPaths: Set<string> | undefined;
  /** The background `catalogue/` refresh — a latest-wins drainer that keeps a
   * burst of edits from stacking full catalogues in memory (see its module). */
  const writeBack = createCatalogueWriteBack(
    async (catalogue, warnings) => {
      await writeCatalogue(nodeCorpusFs, root, catalogue, warnings);
    },
    async (catalogue, warnings) => {
      await writeCatalogueDictionary(nodeCorpusFs, root, catalogue, warnings);
    },
    async (catalogue, warnings, paths) => {
      await writeCatalogueSources(
        nodeCorpusFs,
        root,
        catalogue,
        warnings,
        paths,
      );
    },
  );

  /**
   * Seed the tree from the compiled `catalogue/` (written by the corpus build or by
   * a previous session's write-back) so it shows in ~a second instead of after
   * the ~20s cold compile. Validation still needs the compile — serialised
   * documents carry no source ranges — so violations start empty and the full
   * load, which follows immediately, replaces the whole state. The wire format
   * keeps paths relative to the corpus root; the tree expects the absolute
   * paths buildCatalogue produces, so absolutise them on the way in. A missing or
   * partial catalogue/ (e.g. a write-back cut off mid-way) is simply skipped.
   */
  const loadFromCache = async (): Promise<void> => {
    try {
      const { catalogue, warnings } = await loadCatalogue(
        catalogueReader(nodeCorpusFs),
        root,
      );
      const seen = new Set<Work>();
      for (const author of catalogue.authors) {
        for (const work of author.works) {
          if (seen.has(work)) continue; // co-authored works are shared
          seen.add(work);
          work.dir = `${root}/${work.dir}`;
          for (const edition of work.editions) {
            const source = catalogue.sources.get(edition.document);
            if (source !== undefined) {
              catalogue.sources.set(edition.document, `${root}/${source}`);
            }
          }
        }
      }
      if (state === undefined) {
        state = {
          catalogue,
          warnings,
          violations: [],
          tokenIndex: new Map(),
          vocabulary: new Set(),
        };
        emitter.fire();
      }
    } catch {
      // no compiled catalogue (or a stale/partial one): wait for the full load
    }
  };

  /** Recompile one file in place (or drop it, if it's gone). */
  const refreshFile = async (path: string): Promise<void> => {
    const text = await nodeCorpusFs.readFile(`${root}/data/${path}`);
    if (text === null) {
      files.delete(path);
      return;
    }
    const { document: doc, errors } = compileWithPositions(text);
    files.set(path, {
      path,
      text,
      doc,
      errors,
      derived: deriveFile(text, doc),
    });
  };

  const load = async (full: boolean, paths?: Set<string>): Promise<void> => {
    if (loading) {
      queuedFull ||= full;
      if (paths !== undefined) {
        queuedPaths = new Set([...(queuedPaths ?? []), ...paths]);
      }
      return;
    }
    loading = true;
    emitter.fire();
    // Whether any *documents* change in this load. A dictionary-only reload
    // (full=false, no paths) reuses the compiled files, the token index, and —
    // via the write-back — the serialised documents on disk.
    const docsChanged =
      full || files.size === 0 || (paths !== undefined && paths.size > 0);
    try {
      if (full || files.size === 0) {
        files.clear();
        for (const file of await loadCorpus(nodeCorpusFs, root)) {
          files.set(file.path, file);
        }
      } else {
        for (const path of paths ?? []) await refreshFile(path);
      }
      const list = [...files.values()].sort((a, b) =>
        a.path.localeCompare(b.path),
      );
      const violations = await validateCorpus({
        files: list,
        fs: nodeCorpusFs,
        root,
      });
      // The catalogue reuses the documents compiled above (keyed the way
      // buildCatalogue looks them up: normalised absolute paths).
      const precompiled = new Map(
        list.map((f) => [normalizePath(`${root}/data/${f.path}`), f.doc]),
      );
      const { catalogue, warnings } = await buildCatalogue(
        nodeCorpusFs,
        root,
        precompiled,
      );
      // The token index survives dictionary-only reloads untouched — it is
      // register-independent, and rebuilding it is the merge of every file's
      // summary. (Until the first full load completes, docsChanged is always
      // true, so a cache-seeded state's empty index is never carried forward.)
      const tokenIndex =
        docsChanged || state === undefined
          ? buildTokenIndex(files.values(), root)
          : state.tokenIndex;
      // The attested vocabulary is register-independent too, so it rides the
      // same reuse rule as the token index (see CorpusState.vocabulary).
      const vocabulary =
        docsChanged || state === undefined
          ? vocabularyFromFiles(files.values())
          : state.vocabulary;
      state = { catalogue, warnings, violations, tokenIndex, vocabulary };
      // Refresh the compiled catalogue/ in the background (next startup's instant
      // tree, and the computer's dev input). A full reload rewrites everything; a
      // per-file reload rewrites only its documents; a dictionary-only reload
      // refreshes just catalogue.json/dictionary.json — so a single save no
      // longer serialises all ~1300 documents (the memory spike). The latest
      // catalogue supersedes any still-unwritten one, so rapid edits can't pin
      // more than one extra generation; a failure only costs the cache.
      const scope: WriteScope =
        full || files.size === 0
          ? { kind: "full" }
          : paths !== undefined && paths.size > 0
            ? {
                kind: "docs",
                paths: new Set([...paths].map((p) => `data/${p}`)),
              }
            : { kind: "dictionary" };
      writeBack.enqueue(catalogue, warnings, scope);
    } catch (error) {
      state = undefined;
      const message = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(
        `Compositor: corpus load failed: ${message}`,
      );
    } finally {
      loading = false;
      loaded = true;
      emitter.fire();
    }
    if (queuedFull || queuedPaths !== undefined) {
      const nextFull = queuedFull;
      const nextPaths = queuedPaths;
      queuedFull = false;
      queuedPaths = undefined;
      await load(nextFull, nextPaths);
    }
  };

  /** Watcher events, debounced into one load. A change to a .mit file reloads
   * just that file; a dictionary shard revalidates without recompiling any
   * documents (they stay valid — see reloadKind); anything else (directory
   * create/delete/rename, a non-.mit metadata file) is structural and forces a
   * full reload. A bare revalidate leaves both pending flags clear: load(false,
   * <no paths>) reuses the compiled files and just re-runs validation and the
   * catalogue build, both of which re-read the dictionary from disk. */
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pendingFull = false;
  let pendingPaths = new Set<string>();
  const onEvent = (uri: vscode.Uri, isDelete = false): void => {
    const path = uri.fsPath;
    const rel = path.startsWith(`${root}/data/`)
      ? path.slice(`${root}/data/`.length)
      : undefined;
    const kind = rel === undefined ? "full" : reloadKind(rel);
    if (kind === "recompile" && !isDelete) {
      pendingPaths.add(rel!);
    } else if (kind === "full" || (kind === "recompile" && isDelete)) {
      // A deleted .mit would otherwise leave its stale documents/<docKey>.json
      // behind the incremental write (catalogue/ is also the computer's input),
      // so a delete forces a full rewrite rather than a per-file one.
      pendingFull = true;
    }
    // "revalidate": nothing to flag — the debounced load below revalidates.
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      const full = pendingFull;
      const paths = pendingPaths;
      pendingFull = false;
      pendingPaths = new Set();
      void load(full, paths);
    }, RELOAD_DEBOUNCE_MS);
  };

  const watcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(root, "data/**"),
  );
  watcher.onDidCreate((uri) => onEvent(uri));
  watcher.onDidChange((uri) => onEvent(uri));
  watcher.onDidDelete((uri) => onEvent(uri, true));

  void loadFromCache().then(() => load(true));

  return {
    root,
    get state() {
      return state;
    },
    compiledFiles: files,
    get loading() {
      return loading;
    },
    get status() {
      // Not-yet-loaded and mid-load both read as "loading"; a settled load with
      // no state is the only "failed".
      if (loading || !loaded) return "loading";
      return state === undefined ? "failed" : "ready";
    },
    get loaded() {
      return loaded;
    },
    onDidChange: emitter.event,
    reload: () => load(true),
    dispose: () => {
      if (timer !== undefined) clearTimeout(timer);
      watcher.dispose();
      emitter.dispose();
    },
  };
};
