/**
 * Insert a borrowed-child reference (`## <Author.Work.Edition>`) at the cursor,
 * picking the edition from the catalogue. The borrow targets and the reference
 * line come from core/borrowedRef.ts; this module is only the quick-pick and the
 * snippet insertion.
 */

import * as vscode from "vscode";
import type { CorpusModel } from "../../../core/corpusModel.ts";
import {
  borrowableEditions,
  borrowedRefSnippet,
} from "../../../core/borrowedRef.ts";

export const insertBorrowedRef = async (model: CorpusModel): Promise<void> => {
  const editor = vscode.window.activeTextEditor;
  const catalogue = model.state?.catalogue;
  if (editor === undefined || catalogue === undefined) return;

  const items = borrowableEditions(catalogue).map((choice) => ({
    label: choice.id,
    description: choice.title,
    id: choice.id,
  }));
  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: "Edition to borrow",
    matchOnDescription: true,
  });
  if (picked === undefined) return;

  await editor.insertSnippet(
    new vscode.SnippetString(borrowedRefSnippet(picked.id)),
    editor.selection.active.with({ character: 0 }),
  );
};
