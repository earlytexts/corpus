/**
 * Publishes the corpus validation rules to the Problems panel and summarises
 * them in the status bar. Compile errors in open documents are left to the
 * Markit language server (which reports them live as you type); the compositor
 * adds what the LSP cannot see — corpus-wide rules, and compile errors in
 * files that aren't open.
 *
 * All the decisions (suppression, ranges, status text) are the pure
 * planDiagnostics in lib/; this module only gathers the model phase, applies
 * the plan to the DiagnosticCollection, and drives the status bar item.
 */

import * as vscode from "vscode";
import type { CorpusModel } from "../corpusModel.ts";
import {
  type ModelPhase,
  type PlainDiagnostic,
  planDiagnostics,
} from "../lib/diagnosticsPlan.ts";

const toDiagnostic = (d: PlainDiagnostic): vscode.Diagnostic => {
  const diagnostic = new vscode.Diagnostic(
    new vscode.Range(d.startLine, d.startColumn, d.endLine, d.endColumn),
    d.message,
    d.severity === "warning"
      ? vscode.DiagnosticSeverity.Warning
      : vscode.DiagnosticSeverity.Error,
  );
  diagnostic.source = "compositor";
  diagnostic.code = d.rule;
  return diagnostic;
};

export const registerDiagnostics = (
  model: CorpusModel,
  context: vscode.ExtensionContext,
): void => {
  const collection = vscode.languages.createDiagnosticCollection("compositor");
  const status = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    10,
  );
  status.name = "Compositor";
  status.command = "workbench.actions.view.problems";
  status.show();

  const openPaths = (): Set<string> =>
    new Set(
      vscode.workspace.textDocuments
        .filter((doc) => doc.uri.scheme === "file")
        .map((doc) => doc.uri.fsPath),
    );

  const phase = (): ModelPhase =>
    model.loading
      ? { phase: "loading" }
      : model.state === undefined
        ? { phase: "failed" }
        : {
            phase: "loaded",
            violations: model.state.violations,
            openPaths: openPaths(),
            root: model.root,
          };

  const update = (): void => {
    const plan = planDiagnostics(phase());
    if (plan.collection.action === "clear") {
      collection.clear();
    } else if (plan.collection.action === "replace") {
      collection.clear();
      for (const { path, diagnostics } of plan.collection.files) {
        collection.set(vscode.Uri.file(path), diagnostics.map(toDiagnostic));
      }
    }
    status.text = plan.status.text;
    status.tooltip = plan.status.tooltip;
  };

  context.subscriptions.push(
    collection,
    status,
    model.onDidChange(update),
    // Opening/closing a file hands its compile errors back and forth between
    // the LSP and this collection.
    vscode.workspace.onDidOpenTextDocument(update),
    vscode.workspace.onDidCloseTextDocument(update),
  );
  update();
};
