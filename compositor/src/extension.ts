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
import { authorPath, type TreeNode } from "./lib/nodes.ts";
import { registerDiagnostics } from "./surface/diagnostics.ts";
import { nodeCorpusFs } from "@earlytexts/corpus";
import {
  newAuthor,
  newEdition,
  newWork,
  workDocId,
} from "./surface/commands/scaffolds.ts";
import { fixFormatting } from "./surface/commands/fixFormatting.ts";
import { insertBorrowedRef } from "./surface/commands/insertBorrowedRef.ts";
import {
  compareEditions,
  compareWithNext,
} from "./surface/commands/compareEditions.ts";
import { replaceInScope } from "./surface/commands/replaceInScope.ts";
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

export const activate = async (
  context: vscode.ExtensionContext,
): Promise<void> => {
  let model: CorpusModel | undefined;

  const suggestions: SuggestionController = createSuggestionController(
    () => model,
    context,
  );
  context.subscriptions.push({ dispose: () => suggestions.dispose() });

  const dictionary: DictionaryController = createDictionaryController(
    () => model,
    context,
  );
  context.subscriptions.push({ dispose: () => dictionary.dispose() });

  const dictionaryPanel: DictionaryPanel = createDictionaryPanel(
    () => model,
    context,
  );

  const tree = createCorpusTree(() => model);
  const view = vscode.window.createTreeView("compositor.corpusBrowser", {
    treeDataProvider: tree,
    showCollapseAll: true,
  });
  const updateView = (): void => {
    tree.refresh();
    // With no model, leave message and badge unset so the view's welcome
    // content (package.json viewsWelcome) shows instead.
    view.message =
      model === undefined
        ? undefined
        : model.loading
          ? "Loading the corpus…"
          : model.state === undefined
            ? "The corpus failed to load."
            : undefined;
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

  // Double-click on an author or work opens its metadata. Tree views have no
  // double-click event, so we synthesise one: authors and works carry no
  // command, so a single click toggles the branch (firing an expand or collapse
  // event); a double-click toggles it twice, landing it back where it began and
  // giving us two events on the same node in quick succession. Editions carry
  // their own open command and are untouched by this.
  const DOUBLE_CLICK_MS = 500;
  let lastToggle: { node: TreeNode; at: number } | undefined;
  const openMetadata = (node: TreeNode): void => {
    const uri =
      node.kind === "author"
        ? vscode.Uri.file(authorPath(model!.root, node.author))
        : node.kind === "work"
          ? vscode.Uri.file(`${node.work.dir}/index.mit`)
          : undefined;
    if (uri !== undefined) void vscode.window.showTextDocument(uri);
  };
  const onToggle = (node: TreeNode): void => {
    if (node.kind !== "author" && node.kind !== "work") return;
    const now = Date.now();
    if (lastToggle?.node === node && now - lastToggle.at < DOUBLE_CLICK_MS) {
      lastToggle = undefined;
      openMetadata(node);
      return;
    }
    lastToggle = { node, at: now };
  };
  context.subscriptions.push(
    view.onDidExpandElement((e) => onToggle(e.element)),
    view.onDidCollapseElement((e) => onToggle(e.element)),
  );

  /** Look for the corpus and attach the model to it; true if attached. */
  const attach = async (): Promise<boolean> => {
    if (model !== undefined) return true;
    const root = await findCorpusRoot();
    if (root === undefined) return false;
    model = createCorpusModel(root);
    context.subscriptions.push(
      { dispose: () => model?.dispose() },
      model.onDidChange(updateView),
      model.onDidChange(() => suggestions.onCorpusChanged()),
      model.onDidChange(() => dictionary.onCorpusChanged()),
      model.onDidChange(() => dictionaryPanel.onCorpusChanged()),
    );
    registerDiagnostics(model, context);
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
    command("compositor.refresh", () => withModel((m) => m.reload())),
    command("compositor.validate", () => withModel((m) => m.reload())),
    command("compositor.fixFormatting", () => withModel(fixFormatting)),
    command("compositor.newAuthor", () => withModel(newAuthor)),
    command("compositor.newWork", (node) => withModel((m) => newWork(m, node))),
    command("compositor.newEdition", (node) =>
      withModel((m) => newEdition(m, node)),
    ),
    command("compositor.insertBorrowedRef", () => withModel(insertBorrowedRef)),
    command("compositor.replaceInScope", () => withModel(replaceInScope)),
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

  await attach();
};

export const deactivate = (): void => {};
