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
  context: vscode.ExtensionContext,
): DictionaryPanel => {
  let view: vscode.WebviewView | undefined;

  /** The Curation tab's rows, cached per catalogue. Deriving them walks the
   * whole corpus (the accounting rule over every edition), so it must not re-run
   * on every visibility flip or edit — only when the catalogue itself changes.
   * The lemma/variant views come from disk instead, so they stay live between
   * catalogue rebuilds; curation lags one rebuild behind, as the old tree did. */
  let curationCache:
    { catalogue: unknown; rows: ReturnType<typeof curationRows> } | undefined;
  const curation = (): ReturnType<typeof curationRows> => {
    const catalogue = getModel()?.state?.catalogue;
    if (catalogue === undefined) return { rows: [], total: 0 };
    if (curationCache?.catalogue !== catalogue) {
      curationCache = {
        catalogue,
        rows: curationRows(catalogue, MAX_CURATION),
      };
    }
    return curationCache.rows;
  };

  /** Read the shards, derive the two views, tally the curation backlog, and post
   * all three to the webview. */
  const refresh = async (): Promise<void> => {
    if (view === undefined || !view.visible) return;
    const root = getModel()?.root;
    if (root === undefined) {
      void view.webview.postMessage({
        type: "data",
        variants: [],
        lemmas: [],
        curation: [],
        curationTotal: 0,
      });
      return;
    }
    const { dictionary } = parseDictionary(
      await readDictionaryShards(nodeCorpusFs, root),
    );
    const { variants, lemmas } = dictionaryViews(dictionary);
    const { rows, total } = curation();
    void view.webview.postMessage({
      type: "data",
      variants,
      lemmas,
      curation: rows,
      curationTotal: total,
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

/** The webview shell: a strict CSP (nonce for the one script and the one inline
 * stylesheet, nothing else), the styles, and the bundled front-end. */
const panelHtml = (
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
): string => {
  const nonce = makeNonce();
  const script = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "dist", "webview.js"),
  );
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';"
    />
    <style nonce="${nonce}">${PANEL_CSS}</style>
  </head>
  <body>
    <script nonce="${nonce}" src="${script}"></script>
  </body>
</html>`;
};

/** A random script/style nonce (the extension host has global crypto only from
 * node 20, so a plain random string keeps the engines floor at 1.85). */
const makeNonce = (): string => {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let text = "";
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
};

const PANEL_CSS = `
* { box-sizing: border-box; }
body {
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size);
  color: var(--vscode-foreground);
  padding: 8px 8px 16px;
}
button {
  font-family: inherit;
  font-size: inherit;
  color: var(--vscode-button-foreground);
  background: var(--vscode-button-background);
  border: none;
  border-radius: 2px;
  padding: 3px 9px;
  cursor: pointer;
}
button:hover { background: var(--vscode-button-hoverBackground); }
button.ghost {
  color: var(--vscode-foreground);
  background: transparent;
  border: 1px solid var(--vscode-panel-border);
}
button.ghost:hover { background: var(--vscode-toolbar-hoverBackground); }
button.ghost.selected {
  color: var(--vscode-button-foreground);
  background: var(--vscode-button-background);
  border-color: transparent;
}
button:disabled { opacity: 0.4; cursor: default; }
input {
  font-family: inherit;
  font-size: inherit;
  color: var(--vscode-input-foreground);
  background: var(--vscode-input-background);
  border: 1px solid var(--vscode-input-border, transparent);
  border-radius: 2px;
  padding: 3px 6px;
}
.tabs { display: flex; gap: 4px; margin-bottom: 8px; }
.tabs button { flex: 1; }
.letters { display: flex; flex-wrap: wrap; gap: 3px; margin-bottom: 8px; }
.letters button { min-width: 24px; padding: 2px 5px; text-transform: uppercase; }
.add { display: flex; gap: 4px; margin-bottom: 8px; }
.add input { flex: 1; min-width: 0; }
.rows { display: flex; flex-direction: column; }
.row {
  padding: 6px 2px;
  border-bottom: 1px solid var(--vscode-panel-border);
}
.head { display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap; }
.surface { font-weight: 600; }
button.link {
  font-weight: 600;
  color: var(--vscode-textLink-foreground);
  background: transparent;
  border: none;
  border-radius: 0;
  padding: 0;
}
button.link:hover { background: transparent; text-decoration: underline; }
.arrow { opacity: 0.6; }
.count-tag {
  font-variant-numeric: tabular-nums;
  opacity: 0.7;
}
.curate { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
.tag {
  font-size: 0.8em;
  opacity: 0.65;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.spacer { flex: 1; }
.forms { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 5px; }
.chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  background: var(--vscode-badge-background);
  color: var(--vscode-badge-foreground);
  border-radius: 10px;
  padding: 1px 4px 1px 9px;
}
.x {
  background: transparent;
  color: inherit;
  border: none;
  border-radius: 8px;
  padding: 0 4px;
  cursor: pointer;
  line-height: 1.4;
}
.x:hover { color: var(--vscode-errorForeground); background: transparent; }
.formadd { display: flex; gap: 4px; margin-top: 5px; }
.pager {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
}
.pager .spacer { flex: 1; }
.empty, .count { opacity: 0.65; padding: 8px 2px; }
`;
