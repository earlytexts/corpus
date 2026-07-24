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
  distinctTargetFiles,
  planReplace,
  plural,
  type ReplaceTarget,
  searchCorpus,
  type SearchQuery,
} from "../../core/searchPanel.ts";
import { panelHtml } from "./panelShell.ts";
import { SEARCH_CSS } from "./searchPanelCss.ts";
import type { CorpusModel } from "../../core/corpusModel.ts";

const VIEW_ID = "compositor.searchPanel";

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
  /** Bumped on every new search (and on a corpus change); a run that finds it
   * superseded mid-scan drops its results rather than posting stale ones. The
   * scan is async now — each edition is pulled through the model's on-demand
   * compile cache — so a later query or reload can overtake it. */
  let searchSeq = 0;

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

  /** Run the query over the model's compiled files (`core/searchCorpus`) and
   * post the grouped results — unless a newer query or reload superseded this
   * scan (`searchSeq`), in which case core returns undefined and nothing is
   * posted. */
  const runSearch = async (query: SearchQuery): Promise<void> => {
    const seq = ++searchSeq;
    const model = getModel();
    const results = await searchCorpus(
      query,
      model?.state?.catalogue,
      model?.root ?? "",
      (rel) => model?.getCompiledFile(rel) ?? Promise.resolve(undefined),
      () => seq === searchSeq,
    );
    if (results !== undefined) post({ type: "results", ...results });
  };

  /** Verify and apply one replace request. A cross-file replace confirms first;
   * then `core/planReplace` checks each target against the live document and the
   * survivors are applied as one WorkspaceEdit, saving the touched files. */
  const applyReplace = async (
    query: SearchQuery,
    replaceText: string,
    targets: ReplaceTarget[],
  ): Promise<void> => {
    if (targets.length === 0) return;
    const fileCount = distinctTargetFiles(targets);
    if (fileCount > 1) {
      const confirmed = await vscode.window.showWarningMessage(
        `Replace ${plural(targets.length, "occurrence")} of “${query.term}” ` +
          `across ${plural(fileCount, "file")}? This can be undone per ` +
          `file (⌘Z in each editor).`,
        { modal: true },
        "Replace",
      );
      if (confirmed !== "Replace") return;
    }
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "Replacing" },
      async () => {
        // Open each file once; core reads ranges through this and decides which
        // targets still match, we keep the docs to save the ones we touch.
        const opened = new Map<string, vscode.TextDocument>();
        const plan = await planReplace(
          query,
          replaceText,
          targets,
          async (path) => {
            let doc = opened.get(path);
            if (doc === undefined) {
              try {
                doc = await vscode.workspace.openTextDocument(
                  vscode.Uri.file(path),
                );
              } catch {
                return undefined; // gone since the search
              }
              opened.set(path, doc);
            }
            return (line, start, end) =>
              doc!.getText(new vscode.Range(line, start, line, end));
          },
        );
        if (plan.edits.length > 0) {
          const edit = new vscode.WorkspaceEdit();
          for (const e of plan.edits) {
            edit.replace(
              vscode.Uri.file(e.path),
              new vscode.Range(e.line, e.start, e.line, e.end),
              e.newText,
            );
          }
          await vscode.workspace.applyEdit(edit);
          for (const path of new Set(plan.edits.map((e) => e.path))) {
            await opened.get(path)!.save();
          }
        }
        void vscode.window.showInformationMessage(
          `Compositor: replaced ${plural(plan.edits.length, "occurrence")} ` +
            `across ${plural(plan.filesTouched, "file")}` +
            (plan.skipped === 0
              ? "."
              : `; skipped ${plan.skipped} that no longer matched.`),
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
        void runSearch(message.query);
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
      // Supersede any in-flight scan: its files may be mid-recompile, and the
      // webview re-submits its current query against the fresh compile anyway.
      searchSeq++;
      postContext();
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
