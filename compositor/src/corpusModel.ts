/**
 * The in-memory corpus shared by the tree view, the diagnostics, and the
 * commands: one compile pass feeds both the validation rules and the catalogue
 * build (which reuses the compiled documents instead of compiling again). A
 * filesystem watcher keeps it fresh — saving a .mit file recompiles just that
 * file, then re-runs validation and recomposes the catalogue, so a reload
 * costs a couple of seconds rather than the ~20s of a cold start.
 *
 * The cold start itself is masked by the corpus's compiled `catalogue/`: if it is
 * present the tree shows from it immediately (no violations yet — serialised
 * documents carry no source ranges, so diagnostics always wait for the real
 * compile), and every completed load writes `catalogue/` back, keeping the cache —
 * which is also the computer's input — fresh for next time.
 */

import * as vscode from "vscode";
import { compile } from "@jsr/earlytexts__markit";
import {
  buildCatalogue,
  type Catalogue,
  catalogueReader,
  type CorpusFile,
  loadCatalogue,
  loadCorpus,
  nodeCorpusFs,
  normalizePath,
  validateCorpus,
  type Violation,
  type Work,
  writeCatalogue,
} from "@earlytexts/corpus";

export type CorpusState = {
  catalogue: Catalogue;
  /** Catalogue-build warnings (unresolved children, missing authors, …). */
  warnings: string[];
  violations: Violation[];
};

export type CorpusModel = {
  /** The corpus root (the directory containing data/). */
  readonly root: string;
  /** Undefined until the first load completes; stale while `loading`. */
  readonly state: CorpusState | undefined;
  readonly loading: boolean;
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
  /** Changes that arrived mid-load, replayed afterwards. undefined = idle. */
  let queuedFull = false;
  let queuedPaths: Set<string> | undefined;
  /** The catalogue/ write-back chain (see load); serialises overlapping writes. */
  let catalogueWrite = Promise.resolve();

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
        state = { catalogue, warnings, violations: [] };
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
    const [doc, errors] = compile(text);
    files.set(path, { path, text, doc, errors });
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
      state = { catalogue, warnings, violations };
      // Refresh the compiled catalogue/ in the background (next startup's instant
      // tree, and the computer's dev input). Writes are chained so overlapping
      // loads can never interleave inside catalogue/; a failure only costs the cache.
      catalogueWrite = catalogueWrite
        .then(() => writeCatalogue(nodeCorpusFs, root, catalogue, warnings))
        .then(
          () => {},
          () => {},
        );
    } catch (error) {
      state = undefined;
      const message = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(
        `Compositor: corpus load failed: ${message}`,
      );
    } finally {
      loading = false;
      emitter.fire();
    }
    if (queuedFull || queuedPaths !== undefined) {
      const full = queuedFull;
      const paths = queuedPaths;
      queuedFull = false;
      queuedPaths = undefined;
      await load(full, paths);
    }
  };

  /** Watcher events, debounced into one load. A change to a .mit file reloads
   * just that file; anything else (directory create/delete/rename) is a
   * structural change, handled with a full reload. */
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pendingFull = false;
  let pendingPaths = new Set<string>();
  const onEvent = (uri: vscode.Uri): void => {
    const path = uri.fsPath;
    if (path.endsWith(".mit") && path.startsWith(`${root}/data/`)) {
      pendingPaths.add(path.slice(`${root}/data/`.length));
    } else {
      pendingFull = true;
    }
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
  watcher.onDidCreate(onEvent);
  watcher.onDidChange(onEvent);
  watcher.onDidDelete(onEvent);

  void loadFromCache().then(() => load(true));

  return {
    root,
    get state() {
      return state;
    },
    get loading() {
      return loading;
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
