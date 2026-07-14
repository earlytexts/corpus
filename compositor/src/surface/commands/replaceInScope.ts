/**
 * Whole-word, case-sensitive find/replace across every edition of the current
 * work — or, at the contributor's choice, every work by its author(s).
 * Triggered from the editor context menu on a .mit file: the selection (or the
 * word under the cursor) is the search term. Matching is whole-word only, so
 * replacing "vertue" with "virtue" leaves "vertuous" untouched, and
 * case-sensitive, so "Reason" and "reason" stay distinct.
 *
 * Only edition source files are touched (never author files or work stubs); the
 * watcher revalidates the affected files afterwards. Which files a scope covers
 * is decided by lib/replaceScope.ts; this module gathers the word and applies
 * the edits.
 */

import * as vscode from "vscode";
import type { CorpusModel } from "../../corpusModel.ts";
import { replaceWholeWord } from "../../lib/wholeWord.ts";
import {
  findEdition,
  plural,
  type ReplaceScope,
  replaceScopes,
} from "../../lib/replaceScope.ts";

export const replaceInScope = async (model: CorpusModel): Promise<void> => {
  const editor = vscode.window.activeTextEditor;
  const catalogue = model.state?.catalogue;
  if (editor === undefined || catalogue === undefined) return;

  const found = findEdition(catalogue, editor.document.uri.fsPath);
  if (found === undefined) {
    void vscode.window.showWarningMessage(
      "Compositor: the active file isn't a known edition — open an edition " +
        "of a work to replace words across it.",
    );
    return;
  }
  const { work, edition } = found;

  // The word: the selection, or (failing that) the word under the cursor.
  const range = editor.selection.isEmpty
    ? editor.document.getWordRangeAtPosition(editor.selection.active)
    : editor.selection;
  const search =
    range === undefined ? "" : editor.document.getText(range).trim();
  if (search === "") {
    void vscode.window.showWarningMessage(
      "Compositor: select a word (or place the cursor in one) to replace.",
    );
    return;
  }

  const replacement = await vscode.window.showInputBox({
    title: `Replace “${search}”`,
    prompt: "Whole-word, case-sensitive replacement across the chosen scope",
    value: search,
    valueSelection: [0, search.length],
    // Corpus-model reloads and editor refreshes fire in the background while
    // this command runs; without this the prompt is dismissed the moment one
    // of them steals focus, which reads as "Enter did nothing".
    ignoreFocusOut: true,
  });
  if (replacement === undefined || replacement === search) return;

  const scopes = replaceScopes(catalogue, work, edition);
  const scope: ReplaceScope | undefined =
    scopes.length === 1
      ? scopes[0]
      : await vscode.window.showQuickPick(scopes, {
          title: `Replace “${search}” with “${replacement}” in…`,
          ignoreFocusOut: true,
        });
  if (scope === undefined) return;

  const confirmed = await vscode.window.showWarningMessage(
    `Replace every whole-word “${search}” with “${replacement}” across ${plural(
      scope.files.length,
      "file",
    )}? This can be undone per file (⌘Z in each editor).`,
    { modal: true },
    "Replace",
  );
  if (confirmed !== "Replace") return;

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: "Replacing" },
    async () => {
      // Edit through a WorkspaceEdit (not raw disk writes): rewriting an open
      // file on disk makes VSCode auto-revert its editor, and that revert lands
      // asynchronously — dismissing whatever dialog the next invocation has
      // open. Editing in memory then saving avoids the external-change revert
      // (and gives per-file undo). getText() also respects unsaved edits.
      const edit = new vscode.WorkspaceEdit();
      const touched: vscode.TextDocument[] = [];
      let occurrences = 0;
      for (const path of scope.files) {
        let doc: vscode.TextDocument;
        try {
          doc = await vscode.workspace.openTextDocument(vscode.Uri.file(path));
        } catch {
          continue; // gone since the catalogue was built
        }
        const text = doc.getText();
        const { text: next, count } = replaceWholeWord(
          text,
          search,
          replacement,
        );
        if (count === 0) continue;
        edit.replace(
          doc.uri,
          new vscode.Range(doc.positionAt(0), doc.positionAt(text.length)),
          next,
        );
        touched.push(doc);
        occurrences += count;
      }
      if (occurrences > 0) {
        await vscode.workspace.applyEdit(edit);
        for (const doc of touched) await doc.save();
      }
      void vscode.window.showInformationMessage(
        occurrences === 0
          ? `Compositor: no whole-word “${search}” found in ${plural(
              scope.files.length,
              "file",
            )}.`
          : `Compositor: replaced ${plural(occurrences, "occurrence")} of “${
              search
            }” with “${replacement}” across ${plural(touched.length, "file")}.`,
      );
    },
  );
};
