/**
 * The vscode implementation of the model's `CorpusWatcher` port: watch a
 * corpus's `data/**` and forward each create/change/delete to the model as an
 * absolute fsPath. Translation only — the debounce and coalescing that turn this
 * raw stream into loads live in the core model, not here.
 */

import * as vscode from "vscode";
import type { CorpusWatcher } from "../../core/model/corpusModel.ts";

export const createCorpusWatcher: CorpusWatcher = (root, onEvent) => {
  const watcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(root, "data/**"),
  );
  const forward = (uri: vscode.Uri): void => onEvent(uri.fsPath);
  watcher.onDidCreate(forward);
  watcher.onDidChange(forward);
  watcher.onDidDelete(forward);
  return watcher;
};
