/**
 * The vscode implementation of the model's `Notifier` port: the model's
 * user-facing messages, over `vscode.window`. Translation only.
 */

import * as vscode from "vscode";
import type { Notifier } from "../../core/model/corpusModel.ts";

export const vscodeNotifier: Notifier = {
  error: (message) => void vscode.window.showErrorMessage(message),
};
