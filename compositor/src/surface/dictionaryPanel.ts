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
  parseDictionary,
  type RawDictionary,
  readDictionaryShards,
  shardOf,
} from "@earlytexts/corpus";
import { dictionaryViews } from "../lib/dictionaryViews.ts";
import { type CurationRow, curationRows } from "../lib/curation.ts";
import {
  dropCuratedRows,
  replaceShardEntries,
} from "../lib/dictionaryPanelData.ts";
import { removeEntryText, upsertEntryText } from "../lib/dictionaryEdits.ts";
import {
  type EntryEdit,
  formEntry,
  lemmaEntry,
  variantEntry,
} from "../lib/dictionaryPanelInput.ts";
import { readShardText, updateShard } from "./dictionaryShardIO.ts";
import { PANEL_CSS } from "./dictionaryPanelCss.ts";
import { panelHtml } from "./panelShell.ts";
import type { CorpusModel } from "../corpusModel.ts";

const VIEW_ID = "compositor.dictionaryPanel";

/** The curation command the editor quick-fixes register (its full resolution
 * cascade): the Curation tab drives the very same one the old tree view did. */
const ENTRY_COMMAND = "compositor.dictionaryEntry";

/** How many unaccounted surfaces the Curation tab carries — the most frequent,
 * the ones worth curating first (paged client-side). Until the register is
 * backfilled the backlog is most of the vocabulary, so it is capped to keep the
 * posted payload small; the true total travels alongside for the tab's note. */
const MAX_CURATION = 2000;

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
  /** The corpus reloaded (or a shard was written elsewhere): re-derive. While a
   * reload is mid-flight the panel only flags itself stale (the corpus-wide
   * re-rank is not ready yet); a completed reload re-derives in full. */
  onCorpusChanged: () => void;
  /** A quick-fix cascade just wrote these surfaces' entries (the shards are on
   * disk): patch them in immediately, the same as a panel edit, rather than
   * waiting for the watcher's debounced reload. */
  onEntriesWritten: (surfaces: ReadonlySet<string>) => void;
};

/** The panel's cached derivation, kept so a single-surface edit can patch just
 * its shard instead of re-reading all of them and re-ranking the whole backlog.
 * The variant/lemma views are re-derived from `dictionary` on each post (a
 * cheap in-memory pass); the curation backlog is held ranked so an edit only
 * drops the rows it accounts for, deferring the corpus-wide re-rank to the
 * reload. */
type PanelCache = {
  dictionary: RawDictionary;
  curation: CurationRow[];
  curationTotal: number;
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

  /** Derive the two views from a dictionary and post everything to the webview,
   * tagged with the panel's status and whether it is `stale` (an optimistic
   * patch the reload has yet to confirm — the webview shows an "Updating…"
   * hint). The curation backlog is keyed on the token index, empty until the
   * first full compile (`model.loaded`), so it carries its own readiness flag. */
  const postReady = (data: PanelCache, stale: boolean): void => {
    const { variants, lemmas } = dictionaryViews(data.dictionary);
    void view?.webview.postMessage({
      type: "data",
      status: "ready",
      variants,
      lemmas,
      curation: data.curation,
      curationTotal: data.curationTotal,
      curationReady: getModel()?.loaded ?? false,
      stale,
    });
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
      void view.webview.postMessage({
        type: "data",
        status: corpusSettled() ? "no-corpus" : "loading",
        variants: [],
        lemmas: [],
        curation: [],
        curationTotal: 0,
        curationReady: false,
        stale: false,
      });
      return;
    }
    const { dictionary } = parseDictionary(
      await readDictionaryShards(nodeCorpusFs, root),
    );
    const { rows, total } = curationRows(
      model?.state?.tokenIndex ?? new Map(),
      dictionary,
      MAX_CURATION,
    );
    cache = { dictionary, curation: rows, curationTotal: total };
    postReady(cache, false);
  };

  /** Patch just the written surfaces into the cache and post at once: re-read
   * only their shards (byte-identical to a full re-read for those entries),
   * swap them in, drop the curation rows they account for, and mark the result
   * stale — the reload that follows re-ranks the backlog and clears the flag.
   * Falls back to a full refresh before the first one has cached anything. */
  const patch = async (surfaces: string[]): Promise<void> => {
    if (view === undefined || !view.visible) return;
    const root = getModel()?.root;
    if (root === undefined || cache === undefined) {
      await refreshFull();
      return;
    }
    let dictionary = cache.dictionary;
    for (const shard of new Set(surfaces.map(shardOf))) {
      const text = await readShardText(root, shard);
      const { dictionary: entries } = parseDictionary(
        new Map([[shard, text.trim() === "" ? "{}" : text]]),
      );
      dictionary = replaceShardEntries(dictionary, shard, entries);
    }
    cache = {
      dictionary,
      curation: dropCuratedRows(cache.curation, new Set(surfaces)),
      curationTotal: cache.curationTotal,
    };
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

  /** A corpus reload: while it is mid-flight the token index (and so the backlog
   * re-rank) is stale, so only flag the panel; a completed reload re-derives in
   * full. This collapses the reload's two fires (start and finish) — and the
   * optimistic patch that preceded them — to a single authoritative refresh. */
  const onCorpusChanged = (): void => {
    if (view === undefined || !view.visible) return;
    if (getModel()?.loading) {
      void view.webview.postMessage({ type: "stale", stale: true });
      return;
    }
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
    onCorpusChanged,
    onEntriesWritten: (surfaces) => void patch([...surfaces]),
  };
};

/** Write a validated add edit, or throw its validation error. */
const writeAdd = async (root: string, entry: EntryEdit): Promise<void> => {
  if ("error" in entry) throw new Error(entry.error);
  await updateShard(root, shardOf(entry.surface), (current) =>
    upsertEntryText(current, entry.surface, entry.value),
  );
};

/** Remove a surface's entry, refusing an ambiguous one — its other readings
 * would go with it, so those stay editable through the editor quick-fix. */
const removeEntry = async (root: string, surface: string): Promise<void> => {
  const shard = shardOf(surface);
  await updateShard(root, shard, (text) => {
    const { dictionary } = parseDictionary(
      new Map([[shard, text.trim() === "" ? "{}" : text]]),
    );
    if ((dictionary[surface]?.readings.length ?? 0) > 1) {
      throw new Error(
        `“${surface}” is an ambiguous entry — edit it with the editor quick-fix.`,
      );
    }
    return removeEntryText(text, surface);
  });
};
