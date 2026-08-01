/**
 * The dictionary maintenance panel: a docked webview beside the Corpus Browser
 * that browses the two cross-cuts of the surface-keyed shards the curator wants
 * — variant-spelling maps and lemmas with all their forms — filtered by letter
 * and paged, and edits them directly. It is thin: on open, on a shard write,
 * and on a corpus reload it reads the shards, derives both views
 * (lib/dictionaryViews.ts), and posts the whole index to the webview (short
 * strings, well under a couple of MB; filtering/paging are the webview's);
 * every edit the webview posts is a single-surface upsert/remove written back
 * through the corpus's canonicalising parse/serialise, so a change is
 * byte-identical to `deno task fmt` and validated on parse, with the Problems
 * panel reporting any register-level fallout live after the write.
 *
 * The view's data is read straight from the shards on disk, independent of the
 * (slower) catalogue rebuild, so an edit reflects immediately; onCorpusChanged
 * re-reads so an external edit or `deno task fmt` shows up too.
 */

import * as vscode from "vscode";
import {
  nodeCorpusFs,
  readDictionaryShards,
  shardOf,
} from "@earlytexts/corpus";
import { upsertEntryText } from "../../core/dictionary/edits.ts";
import {
  type EntryEdit,
  formEntry,
  lemmaEntry,
  removeSurfaceFromShard,
  variantEntry,
} from "../../core/dictionary/panel/input.ts";
import {
  buildCache,
  dataMessage,
  emptyMessage,
  MAX_CURATION,
  type PanelCache,
  patchCache,
} from "../../core/dictionary/panel/viewModel.ts";
import { readShardText, updateShard } from "../../core/dictionary/shardIO.ts";
import { PANEL_CSS } from "./dictionaryPanelCss.ts";
import { panelHtml } from "./panelShell.ts";
import type { CorpusModel } from "../../core/model/corpusModel.ts";

const VIEW_ID = "compositor.dictionaryPanel";

/** The curation command the editor quick-fixes register (its full resolution
 * cascade): the Curation tab drives the very same one the old tree view did. */
const ENTRY_COMMAND = "compositor.dictionaryEntry";

/** What the webview posts back. `ready` requests the initial data; then the four
 * single-surface edits (three adds and a remove); then the Curation tab's two —
 * `curate` (delegates to the quick-fix cascade) and `openExample`. */
type Incoming =
  | { type: "ready" }
  | { type: "addLemma"; lemma: string }
  | { type: "addForm"; lemma: string; form: string }
  | { type: "addVariant"; surface: string; spelling: string }
  | { type: "removeEntry"; surface: string }
  | { type: "curate"; surface: string; kind: "modern" | "respell" | "lemma" }
  | { type: "openExample"; path: string; line: number };

export type DictionaryPanel = {
  /** A reload has begun: flag the panel stale, since the corpus-wide re-rank it
   * shows is not ready until the reload settles. */
  onLoadingStarted: () => void;
  /** The corpus reloaded (or a shard was written elsewhere): re-derive in full. */
  onCorpusChanged: () => void;
  /** A quick-fix cascade just wrote these surfaces' entries (the shards are on
   * disk): patch them in immediately, the same as a panel edit, rather than
   * waiting for the watcher's debounced reload. */
  onEntriesWritten: (surfaces: ReadonlySet<string>) => void;
};

export const createDictionaryPanel = (
  getModel: () => CorpusModel | undefined,
  /** Whether the first corpus search has finished (see extension.ts): tells the
   * panel to show its definitive empty state rather than a spinner when there is
   * no model. */
  corpusSettled: () => boolean,
  context: vscode.ExtensionContext,
): DictionaryPanel => {
  let view: vscode.WebviewView | undefined;
  let cache: PanelCache | undefined;

  /** Post a cache to the webview as its `data` message (`core/dataMessage`),
   * tagged `stale` for an optimistic patch. The curation backlog is keyed on the
   * token index, empty until the first full compile (`model.loaded`), so it
   * carries its own readiness flag. */
  const postReady = (data: PanelCache, stale: boolean): void => {
    void view?.webview.postMessage(
      dataMessage(data, { curationReady: getModel()?.loaded ?? false, stale }),
    );
  };

  /** Re-read every shard, re-rank the whole backlog, cache it, and post — the
   * authoritative refresh, run on open, on an external change, and after a
   * reload settles. Straight from the shards on disk, so the views are ready the
   * moment a corpus root is known. */
  const refreshFull = async (): Promise<void> => {
    if (view === undefined || !view.visible) return;
    const model = getModel();
    const root = model?.root;
    if (root === undefined) {
      cache = undefined;
      void view.webview.postMessage(emptyMessage(corpusSettled()));
      return;
    }
    cache = buildCache(
      await readDictionaryShards(nodeCorpusFs, root),
      model?.state?.tokenIndex ?? new Map(),
      MAX_CURATION,
    );
    postReady(cache, false);
  };

  /** Patch just the written surfaces into the cache and post at once: re-read
   * only their shards (byte-identical to a full re-read for those entries) and
   * hand them to `core/patchCache`, which swaps them in, drops the curation rows
   * they account for, and leaves the corpus-wide re-rank to the reload that
   * follows. Falls back to a full refresh before the first one has cached
   * anything. */
  const patch = async (surfaces: string[]): Promise<void> => {
    if (view === undefined || !view.visible) return;
    const root = getModel()?.root;
    if (root === undefined || cache === undefined) {
      await refreshFull();
      return;
    }
    const shardTexts = new Map<string, string>();
    for (const shard of new Set(surfaces.map(shardOf))) {
      shardTexts.set(shard, await readShardText(nodeCorpusFs, root, shard));
    }
    cache = patchCache(cache, shardTexts, surfaces);
    postReady(cache, true);
  };

  /** Run one edit against the corpus root, then patch its surfaces in; surface
   * any error (a validation rejection or a bad write) as a message. */
  const edit = async (
    surfaces: string[],
    run: (root: string) => Promise<void>,
  ): Promise<void> => {
    const root = getModel()?.root;
    if (root === undefined) {
      void vscode.window.showWarningMessage("Compositor: no corpus loaded.");
      return;
    }
    try {
      await run(root);
      await patch(surfaces);
    } catch (error) {
      void vscode.window.showErrorMessage(
        `Compositor: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  const onMessage = (message: Incoming): void => {
    switch (message.type) {
      case "ready":
        void refreshFull();
        return;
      case "addLemma":
        void edit([message.lemma], (root) =>
          writeAdd(root, lemmaEntry(message.lemma)),
        );
        return;
      case "addForm":
        void edit([message.form], (root) =>
          writeAdd(root, formEntry(message.lemma, message.form)),
        );
        return;
      case "addVariant":
        void edit([message.surface], (root) =>
          writeAdd(root, variantEntry(message.surface, message.spelling)),
        );
        return;
      case "removeEntry":
        void edit([message.surface], (root) =>
          removeEntry(root, message.surface),
        );
        return;
      case "curate":
        // The Curation tab reuses the editor quick-fix's full resolution
        // cascade (prompts for a respelling/lemma target, resolves it all the
        // way down): the command writes the shard, the model reloads, and
        // onCorpusChanged re-derives — so the curated surface drops off the tab.
        void vscode.commands.executeCommand(
          ENTRY_COMMAND,
          message.surface,
          message.kind,
        );
        return;
      case "openExample":
        void vscode.commands.executeCommand(
          "vscode.open",
          vscode.Uri.file(message.path),
          {
            selection: new vscode.Range(message.line, 0, message.line, 0),
          },
        );
        return;
    }
  };

  /** A reload has begun: the token index (and so the backlog re-rank) is stale
   * until it settles, so flag the panel rather than re-deriving against state
   * that is about to move. */
  const onLoadingStarted = (): void => {
    if (view === undefined || !view.visible) return;
    void view.webview.postMessage({ type: "stale", stale: true });
  };

  /** The reload settled: re-derive in full, superseding both the stale flag and
   * whatever optimistic patch preceded it with one authoritative refresh. */
  const onCorpusChanged = (): void => {
    if (view === undefined || !view.visible) return;
    void refreshFull();
  };

  const provider: vscode.WebviewViewProvider = {
    resolveWebviewView: (webviewView) => {
      view = webviewView;
      webviewView.webview.options = {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "dist")],
      };
      webviewView.webview.html = panelHtml(
        webviewView.webview,
        context.extensionUri,
        PANEL_CSS,
        "webview.js",
      );
      webviewView.webview.onDidReceiveMessage(onMessage);
      webviewView.onDidChangeVisibility(() => void refreshFull());
      webviewView.onDidDispose(() => {
        view = undefined;
      });
      void refreshFull();
    },
  };

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(VIEW_ID, provider),
  );

  return {
    onLoadingStarted,
    onCorpusChanged,
    onEntriesWritten: (surfaces) => void patch([...surfaces]),
  };
};

/** Write a validated add edit, or throw its validation error. */
const writeAdd = async (root: string, entry: EntryEdit): Promise<void> => {
  if ("error" in entry) throw new Error(entry.error);
  await updateShard(nodeCorpusFs, root, shardOf(entry.surface), (current) =>
    upsertEntryText(current, entry.surface, entry.value),
  );
};

/** Remove a surface's entry through the corpus's canonicalising shard write; the
 * ambiguous-entry refusal is `core/removeSurfaceFromShard`. */
const removeEntry = async (root: string, surface: string): Promise<void> => {
  const shard = shardOf(surface);
  await updateShard(nodeCorpusFs, root, shard, (text) =>
    removeSurfaceFromShard(text, shard, surface),
  );
};
