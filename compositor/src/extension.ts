/**
 * Activation and wiring. The extension assumes the user has cloned the corpus
 * themselves and opened VSCode in it (or set compositor.corpusRoot to its
 * workspace-relative path); git stays in the user's hands. Everything runs
 * in-process — corpus logic is bundled from @earlytexts/corpus, so
 * contributors need nothing beyond VSCode.
 *
 * Views and commands are always registered; the corpus model attaches when a
 * corpus is found (at startup, on Refresh, or when workspace folders change),
 * so a non-corpus window degrades to a welcome message rather than errors.
 */

import * as vscode from "vscode";
import { type CorpusModel, createCorpusModel } from "./corpusModel.ts";
import { createCorpusTree } from "./surface/corpusTree.ts";
import { registerDoubleClickOpen } from "./surface/doubleClickOpen.ts";
import { authorPath, type TreeNode, workDocId } from "./lib/nodes.ts";
import { registerDiagnostics } from "./surface/diagnostics.ts";
import { registerHover } from "./surface/hover.ts";
import { nodeCorpusFs } from "@earlytexts/corpus";
import {
  newAuthor,
  newEdition,
  newWork,
} from "./surface/commands/scaffolds.ts";
import { fixFormatting } from "./surface/commands/fixFormatting.ts";
import { insertBorrowedRef } from "./surface/commands/insertBorrowedRef.ts";
import {
  compareEditions,
  compareWithNext,
} from "./surface/commands/compareEditions.ts";
import {
  createSuggestionController,
  type SuggestionController,
} from "./surface/commands/suggestMarkup.ts";
import {
  createDictionaryController,
  type DictionaryController,
} from "./surface/commands/dictionaryDiagnostics.ts";
import { configureDiagnostics } from "./surface/commands/configureDiagnostics.ts";
import { runSetup } from "./git/setup.ts";
import {
  createDictionaryPanel,
  type DictionaryPanel,
} from "./surface/dictionaryPanel.ts";
import { createSearchPanel, type SearchPanel } from "./surface/searchPanel.ts";

/** The first workspace folder that looks like the corpus (has data/authors),
 * honouring the compositor.corpusRoot setting. */
const findCorpusRoot = async (): Promise<string | undefined> => {
  const configured = vscode.workspace
    .getConfiguration("compositor")
    .get<string>("corpusRoot", "")
    .replace(/\/$/, "");
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    const root =
      configured === ""
        ? folder.uri.fsPath
        : `${folder.uri.fsPath}/${configured}`;
    const authors = await nodeCorpusFs.stat(`${root}/data/authors`);
    // Canonicalised, so the model's precompiled-document keys line up with the
    // paths buildCatalogue resolves internally.
    if (authors !== null && !authors.isFile) {
      return await nodeCorpusFs.realPath(root);
    }
  }
  return undefined;
};

/** The tree view's status message for the model's current phase, or undefined
 * to fall back to the view's welcome content (package.json viewsWelcome). With
 * no model there is no corpus attached, so the welcome content ("No corpus
 * found…") is exactly right. Otherwise the model's own `status` decides — never
 * the raw `loading`/`state` pair, which reads the pre-first-load window as a
 * failure. */
const viewMessage = (model: CorpusModel | undefined): string | undefined => {
  if (model === undefined) return undefined;
  switch (model.status) {
    case "loading":
      return "Loading the corpus…";
    case "failed":
      return "The corpus failed to load.";
    case "ready":
      return undefined;
  }
};

export const activate = async (
  context: vscode.ExtensionContext,
): Promise<void> => {
  let model: CorpusModel | undefined;
  // True once the first corpus search has finished. Lets the docked panels tell
  // "still looking" (show a spinner) apart from "there is genuinely no corpus"
  // (show the empty state) while the model is absent.
  let searched = false;

  const suggestions: SuggestionController = createSuggestionController(
    () => model,
    context,
  );
  context.subscriptions.push({ dispose: () => suggestions.dispose() });

  const dictionaryPanel: DictionaryPanel = createDictionaryPanel(
    () => model,
    () => searched,
    context,
  );

  const searchPanel: SearchPanel = createSearchPanel(() => model, context);

  const dictionary: DictionaryController = createDictionaryController(
    () => model,
    context,
    // A curation cascade's entries are on disk the moment it completes: re-rank
    // the panel now rather than after the watcher's debounced reload.
    () => dictionaryPanel.onCorpusChanged(),
  );
  context.subscriptions.push({ dispose: () => dictionary.dispose() });

  const tree = createCorpusTree(() => model);
  const view = vscode.window.createTreeView("compositor.corpusBrowser", {
    treeDataProvider: tree,
    showCollapseAll: true,
  });
  // Until the first attach settles, the extension is still looking — say so,
  // rather than momentarily flashing the "No corpus found" welcome. The final
  // updateView() below clears this if no corpus turns up (welcome takes over).
  view.message = "Looking for the corpus…";
  const updateView = (): void => {
    tree.refresh();
    // With no model, leave message and badge unset so the view's welcome
    // content (package.json viewsWelcome) shows instead.
    view.message = viewMessage(model);
    const problems = model?.state?.violations.length ?? 0;
    view.badge =
      problems === 0
        ? undefined
        : {
            value: problems,
            tooltip: `${problems} corpus violation(s)`,
          };
  };
  context.subscriptions.push(view);
  context.subscriptions.push(...registerDoubleClickOpen(view, () => model));

  /** Look for the corpus and attach the model to it; true if attached. */
  const attach = async (): Promise<boolean> => {
    if (model !== undefined) return true;
    const root = await findCorpusRoot();
    if (root === undefined) return false;
    model = createCorpusModel(root);
    context.subscriptions.push(
      { dispose: () => model?.dispose() },
      // One fan-out on each corpus change: refresh the view and let every
      // overlay re-rank against the new state.
      model.onDidChange(() => {
        updateView();
        suggestions.onCorpusChanged();
        dictionary.onCorpusChanged();
        dictionaryPanel.onCorpusChanged();
        searchPanel.onCorpusChanged();
      }),
    );
    registerDiagnostics(model, context);
    registerHover(model, context);
    updateView();
    return true;
  };

  /** Run a handler against the model, or say why there isn't one. */
  const withModel = async (
    handler: (model: CorpusModel) => unknown,
  ): Promise<unknown> => {
    if (await attach()) return handler(model!);
    return vscode.window.showWarningMessage(
      "Compositor: no corpus found — open a clone of the corpus " +
        "(a folder containing data/authors), or set compositor.corpusRoot.",
    );
  };

  const command = (
    id: string,
    handler: (node?: TreeNode) => unknown,
  ): vscode.Disposable => vscode.commands.registerCommand(id, handler);

  context.subscriptions.push(
    // Wrapped git/GitHub onboarding for non-technical contributors: signs in via
    // VSCode's built-in GitHub provider, ensures a fork, clones it with bundled
    // git (no system git required), points upstream at the corpus, and offers to
    // open the result — which activates this extension (workspaceContains:
    // data/authors). No build step is needed: the model compiles in memory, and
    // its first load writes catalogue/.
    command("compositor.setup", () => runSetup()),
    // Refresh and Validate are two menu labels for the one action: a reload
    // recompiles the corpus and re-runs validation, so there is nothing to
    // separate them beyond the wording contributors expect to find.
    command("compositor.refresh", () => withModel((m) => m.reload())),
    command("compositor.validate", () => withModel((m) => m.reload())),
    command("compositor.fixFormatting", () => withModel(fixFormatting)),
    command("compositor.newAuthor", () => withModel(newAuthor)),
    command("compositor.newWork", (node) => withModel((m) => newWork(m, node))),
    command("compositor.newEdition", (node) =>
      withModel((m) => newEdition(m, node)),
    ),
    command("compositor.insertBorrowedRef", () => withModel(insertBorrowedRef)),
    // Focus the search panel, seeded with the selection (or the word under the
    // cursor) as a whole-word, case-sensitive term — the exact semantics the
    // retired "Replace in Work / Author" command had, now with a preview and
    // per-match control. Selections spanning lines don't seed (matches are
    // single-line); the panel just opens.
    command("compositor.search", () =>
      withModel(() => {
        const editor = vscode.window.activeTextEditor;
        const range =
          editor === undefined
            ? undefined
            : editor.selection.isEmpty
              ? editor.document.getWordRangeAtPosition(editor.selection.active)
              : editor.selection;
        const term =
          range === undefined ? "" : editor!.document.getText(range).trim();
        return searchPanel.openWith(term.includes("\n") ? "" : term);
      }),
    ),
    // Attaches the model on first use (via withModel) so the overlay
    // controllers' getModel closures see it, then flips the two overlay
    // settings — which the controllers react to on their own.
    command("compositor.configureDiagnostics", () =>
      withModel(() => configureDiagnostics()),
    ),
    command("compositor.compareEditions", (node) =>
      withModel((m) => compareEditions(m, node)),
    ),
    command("compositor.compareWithNext", (node) =>
      withModel((m) => compareWithNext(m, node)),
    ),
    command("compositor.openAuthorStub", (node) => {
      if (node?.kind !== "author") return;
      return withModel((m) =>
        vscode.window.showTextDocument(
          vscode.Uri.file(authorPath(m.root, node.author)),
        ),
      );
    }),
    command("compositor.openWorkStub", (node) => {
      // A borrowed node has no visible work parent, so this jumps to the
      // borrowed edition's own work metadata.
      if (node?.kind !== "work" && node?.kind !== "borrowed") return;
      return vscode.window.showTextDocument(
        vscode.Uri.file(`${node.work.dir}/index.mit`),
      );
    }),
    command("compositor.copyDocId", (node) => {
      const id =
        node?.kind === "edition" || node?.kind === "borrowed"
          ? node.edition.document.id
          : node?.kind === "work"
            ? workDocId(node.work)
            : undefined;
      if (id !== undefined) return vscode.env.clipboard.writeText(id);
    }),
    // A corpus folder added to the workspace later still gets picked up.
    vscode.workspace.onDidChangeWorkspaceFolders(() => void attach()),
  );

  // Settle the surfaces once the first search finishes: attach() calls
  // updateView on success, but a miss leaves the "Looking for the corpus…"
  // message standing — clear it so the welcome content shows, and let the
  // dictionary panel swap its spinner for the definitive empty state.
  const attached = await attach();
  searched = true;
  if (!attached) {
    updateView();
    dictionaryPanel.onCorpusChanged();
  }
};

export const deactivate = (): void => {};
