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
  readDictionaryShards,
  shardOf,
} from "@earlytexts/corpus";
import { dictionaryViews } from "../lib/dictionaryViews.ts";
import { curationRows } from "../lib/curation.ts";
import { removeEntryText, upsertEntryText } from "../lib/dictionaryEdits.ts";
import {
  type EntryEdit,
  formEntry,
  lemmaEntry,
  variantEntry,
} from "../lib/dictionaryPanelInput.ts";
import { updateShard } from "./dictionaryShardIO.ts";
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
  /** The corpus reloaded (or a shard was written elsewhere): re-derive. */
  onCorpusChanged: () => void;
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

  /** Read the shards, derive the two views, tally the curation backlog, and post
   * all three to the webview, tagged with the panel's status so the webview can
   * tell "still loading" from "genuinely empty". The lemma/variant views come
   * straight from the shards on disk, so they are ready the moment a corpus root
   * is known — but the curation backlog is keyed on the token index, which is
   * empty until the first full compile completes (`model.loaded`), so it carries
   * its own readiness flag. */
  const refresh = async (): Promise<void> => {
    if (view === undefined || !view.visible) return;
    const model = getModel();
    const root = model?.root;
    if (root === undefined) {
      void view.webview.postMessage({
        type: "data",
        status: corpusSettled() ? "no-corpus" : "loading",
        variants: [],
        lemmas: [],
        curation: [],
        curationTotal: 0,
        curationReady: false,
      });
      return;
    }
    const { dictionary } = parseDictionary(
      await readDictionaryShards(nodeCorpusFs, root),
    );
    const { variants, lemmas } = dictionaryViews(dictionary);
    const { rows, total } = curationRows(
      model?.state?.tokenIndex ?? new Map(),
      dictionary,
      MAX_CURATION,
    );
    void view.webview.postMessage({
      type: "data",
      status: "ready",
      variants,
      lemmas,
      curation: rows,
      curationTotal: total,
      curationReady: model?.loaded ?? false,
    });
  };

  /** Run one edit against the corpus root, then re-derive; surface any error
   * (a validation rejection or a bad write) as a message. */
  const edit = async (run: (root: string) => Promise<void>): Promise<void> => {
    const root = getModel()?.root;
    if (root === undefined) {
      void vscode.window.showWarningMessage("Compositor: no corpus loaded.");
      return;
    }
    try {
      await run(root);
      await refresh();
    } catch (error) {
      void vscode.window.showErrorMessage(
        `Compositor: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  const onMessage = (message: Incoming): void => {
    switch (message.type) {
      case "ready":
        void refresh();
        return;
      case "addLemma":
        void edit((root) => writeAdd(root, lemmaEntry(message.lemma)));
        return;
      case "addForm":
        void edit((root) =>
          writeAdd(root, formEntry(message.lemma, message.form)),
        );
        return;
      case "addVariant":
        void edit((root) =>
          writeAdd(root, variantEntry(message.surface, message.spelling)),
        );
        return;
      case "removeEntry":
        void edit((root) => removeEntry(root, message.surface));
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
      webviewView.onDidChangeVisibility(() => void refresh());
      void refresh();
    },
  };

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(VIEW_ID, provider),
  );

  return { onCorpusChanged: () => void refresh() };
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
