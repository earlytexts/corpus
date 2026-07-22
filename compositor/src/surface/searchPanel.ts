/**
 * The corpus search panel: a docked webview beside the Corpus Browser that
 * searches and replaces across the corpus's works the way VSCode's native
 * Search view does across files — except it scopes by author (not file glob),
 * covers only catalogue editions (never author files, work stubs, or
 * reference material), and matches only block content (lib/searchPanel.ts
 * decides which lines those are). It is thin: on a `search` message it scans
 * the model's compiled files — already in memory, positioned — and posts the
 * grouped, catalogue-labelled results back; the webview owns rendering,
 * debouncing, and dismissal, and every replace arrives as an explicit list of
 * match targets to verify and apply.
 *
 * Replacement follows the discipline the old replace-in-scope command
 * established: edit through a WorkspaceEdit and save (never raw disk writes —
 * rewriting an open file on disk makes VSCode auto-revert its editor), which
 * also gives per-file undo. Each target is verified against the live document
 * first — a match gone stale since the search is skipped and reported, never
 * blindly overwritten. The watcher then recompiles the touched files and the
 * model change re-runs the panel's query, so results refresh themselves.
 */

import * as vscode from "vscode";
import {
  authorRows,
  buildMatcher,
  type Match,
  plural,
  replacementFor,
  scopedEditions,
  searchFile,
  type SearchQuery,
} from "../lib/searchPanel.ts";
import { panelHtml } from "./panelShell.ts";
import { SEARCH_CSS } from "./searchPanelCss.ts";
import type { CorpusModel } from "../corpusModel.ts";

const VIEW_ID = "compositor.searchPanel";

/** Result caps, native-search ballpark: a scan stops here rather than posting
 * an unbounded payload for a one-letter term over ~250k-token editions. */
const MAX_TOTAL = 10_000;
const MAX_PER_FILE = 500;

/** One match the webview asks to replace: located and verbatim, so the
 * extension can verify the text is still there before touching it. */
type ReplaceTarget = {
  path: string;
  line: number;
  start: number;
  end: number;
  matchText: string;
};

/** What the webview posts: `ready` on every (re)load; a debounced `search` per
 * query change; `openMatch` on click; and `replace` with the explicit targets
 * (one match, a file's worth, or everything not dismissed — the webview knows
 * what was dismissed, so no dismissal state lives here). */
type Incoming =
  | { type: "ready" }
  | { type: "search"; query: SearchQuery }
  | {
      type: "openMatch";
      path: string;
      line: number;
      start: number;
      end: number;
    }
  | {
      type: "replace";
      query: SearchQuery;
      replaceText: string;
      targets: ReplaceTarget[];
    };

/** One file's worth of results on the wire: the catalogue label is composed
 * extension-side so the webview never needs the catalogue itself. */
type FileGroup = {
  path: string;
  label: string;
  matches: Match[];
  truncated: boolean;
};

export type SearchPanel = {
  /** The corpus reloaded: re-offer the author list and re-run the query. */
  onCorpusChanged: () => void;
  /** Focus the panel, seeding the term (from the editor context menu). */
  openWith: (term: string) => Promise<void>;
};

export const createSearchPanel = (
  getModel: () => CorpusModel | undefined,
  context: vscode.ExtensionContext,
): SearchPanel => {
  let view: vscode.WebviewView | undefined;
  /** Whether the current webview instance has said `ready` (a hidden view's
   * webview is torn down and reloaded on show, and a message posted before its
   * listener attaches is lost — so a prefill waits for the handshake). */
  let ready = false;
  let pendingPrefill: string | undefined;

  const post = (message: unknown): void => {
    void view?.webview.postMessage(message);
  };

  const postContext = (): void => {
    const catalogue = getModel()?.state?.catalogue;
    post({
      type: "context",
      authors: catalogue === undefined ? [] : authorRows(catalogue),
    });
  };

  /** Scan the scoped editions' compiled files and post the grouped results.
   * Until the first full compile the map is empty (the catalogue cache seeds
   * the tree alone), so an early search posts nothing — the load's change
   * event re-runs it. */
  const runSearch = (query: SearchQuery): void => {
    const model = getModel();
    const catalogue = model?.state?.catalogue;
    const empty = {
      type: "results",
      files: [],
      totalMatches: 0,
      truncated: false,
    };
    if (model === undefined || catalogue === undefined || query.term === "") {
      post(empty);
      return;
    }
    const built = buildMatcher(query);
    if ("error" in built) {
      post({ ...empty, error: built.error });
      return;
    }
    const prefix = `${model.root}/data/`;
    const files: FileGroup[] = [];
    let total = 0;
    let truncated = false;
    for (const { path, label } of scopedEditions(
      catalogue,
      query.include,
      query.exclude,
    )) {
      if (total >= MAX_TOTAL) {
        truncated = true;
        break;
      }
      const file = path.startsWith(prefix)
        ? model.compiledFiles.get(path.slice(prefix.length))
        : undefined;
      if (file === undefined) continue;
      const result = searchFile(
        file,
        built.matcher,
        Math.min(MAX_PER_FILE, MAX_TOTAL - total),
      );
      if (result.matches.length === 0) continue;
      truncated ||= result.truncated;
      total += result.matches.length;
      files.push({
        path,
        label,
        matches: result.matches,
        truncated: result.truncated,
      });
    }
    post({ type: "results", files, totalMatches: total, truncated });
  };

  /** Verify and apply one replace request. Multi-file replaces confirm first;
   * a target whose text moved since the search is skipped and counted. */
  const applyReplace = async (
    query: SearchQuery,
    replaceText: string,
    targets: ReplaceTarget[],
  ): Promise<void> => {
    if (targets.length === 0) return;
    const byPath = new Map<string, ReplaceTarget[]>();
    for (const target of targets) {
      const list = byPath.get(target.path);
      if (list === undefined) byPath.set(target.path, [target]);
      else list.push(target);
    }
    if (byPath.size > 1) {
      const confirmed = await vscode.window.showWarningMessage(
        `Replace ${plural(targets.length, "occurrence")} of “${query.term}” ` +
          `across ${plural(byPath.size, "file")}? This can be undone per ` +
          `file (⌘Z in each editor).`,
        { modal: true },
        "Replace",
      );
      if (confirmed !== "Replace") return;
    }
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "Replacing" },
      async () => {
        const edit = new vscode.WorkspaceEdit();
        const touched: vscode.TextDocument[] = [];
        let count = 0;
        let skipped = 0;
        for (const [path, list] of byPath) {
          let doc: vscode.TextDocument;
          try {
            doc = await vscode.workspace.openTextDocument(
              vscode.Uri.file(path),
            );
          } catch {
            skipped += list.length; // gone since the search
            continue;
          }
          let touchedHere = false;
          for (const target of list) {
            const range = new vscode.Range(
              target.line,
              target.start,
              target.line,
              target.end,
            );
            if (doc.getText(range) !== target.matchText) {
              skipped++;
              continue;
            }
            edit.replace(
              doc.uri,
              range,
              replacementFor(target.matchText, query, replaceText),
            );
            count++;
            touchedHere = true;
          }
          if (touchedHere) touched.push(doc);
        }
        if (count > 0) {
          await vscode.workspace.applyEdit(edit);
          for (const doc of touched) await doc.save();
        }
        void vscode.window.showInformationMessage(
          `Compositor: replaced ${plural(count, "occurrence")} across ` +
            `${plural(touched.length, "file")}` +
            (skipped === 0
              ? "."
              : `; skipped ${skipped} that no longer matched.`),
        );
      },
    );
  };

  const onMessage = (message: Incoming): void => {
    switch (message.type) {
      case "ready":
        ready = true;
        postContext();
        if (pendingPrefill !== undefined) {
          post({ type: "prefill", term: pendingPrefill });
          pendingPrefill = undefined;
        }
        return;
      case "search":
        runSearch(message.query);
        return;
      case "openMatch":
        void vscode.window.showTextDocument(vscode.Uri.file(message.path), {
          selection: new vscode.Range(
            message.line,
            message.start,
            message.line,
            message.end,
          ),
        });
        return;
      case "replace":
        void applyReplace(message.query, message.replaceText, message.targets);
        return;
    }
  };

  const provider: vscode.WebviewViewProvider = {
    resolveWebviewView: (webviewView) => {
      view = webviewView;
      ready = false;
      webviewView.webview.options = {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "dist")],
      };
      webviewView.webview.onDidReceiveMessage(onMessage);
      webviewView.webview.html = panelHtml(
        webviewView.webview,
        context.extensionUri,
        SEARCH_CSS,
        "searchview.js",
      );
      webviewView.onDidDispose(() => {
        if (view === webviewView) {
          view = undefined;
          ready = false;
        }
      });
    },
  };

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(VIEW_ID, provider),
  );

  return {
    onCorpusChanged: () => {
      postContext();
      // The webview re-submits its current query against the fresh compile.
      post({ type: "corpusChanged" });
    },
    openWith: async (term) => {
      pendingPrefill = term === "" ? undefined : term;
      await vscode.commands.executeCommand(`${VIEW_ID}.focus`);
      if (ready && pendingPrefill !== undefined) {
        post({ type: "prefill", term: pendingPrefill });
        pendingPrefill = undefined;
      }
    },
  };
};
