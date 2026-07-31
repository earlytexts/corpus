/**
 * The editor layer of the TCP import: the id input box (validated by the core's
 * wrapper around the corpus's own TCP pattern), the modal that reports what
 * arrived, and the two ways of taking it — a preview in an untitled document,
 * or a `WorkspaceEdit` over the open file. Every decision is in
 * core/importTcp.ts; this only asks and applies.
 *
 * Progress goes to the status bar rather than a progress notification, because
 * the flow puts an input box and a modal on the screen either side of the
 * fetch, and a notification would sit behind both.
 *
 * The applied edit replaces the whole document with the core's prospective
 * text, whose prefix is the file's existing content unchanged. That is still an
 * append — but it guarantees that what a preview showed is exactly what lands,
 * and it stays one undo step.
 */

import * as vscode from "vscode";
import {
  type ImportPrompts,
  type ImportReport,
  planTcpImport,
  tcpIdError,
} from "../../../core/importTcp.ts";
import { tcpTextSource } from "../../http/tcpText.ts";

/** Import a TCP text into the open edition. */
export const importTcpText = async (): Promise<void> => {
  const editor = vscode.window.activeTextEditor;
  if (editor?.document.languageId !== "markit") {
    await vscode.window.showWarningMessage(
      "Open the edition you want to import into first (a .mit file).",
    );
    return;
  }
  const document = editor.document;

  let progress: vscode.Disposable | undefined;
  const plan = await planTcpImport(document.getText(), {
    source: tcpTextSource,
    prompts,
    progress: (message) => {
      progress?.dispose();
      progress = vscode.window.setStatusBarMessage(`$(sync~spin) ${message}`);
    },
  }).finally(() => progress?.dispose());

  if (plan.kind === "declined") {
    if (plan.message !== undefined) {
      await vscode.window.showWarningMessage(plan.message);
    }
    return;
  }

  if (plan.kind === "preview") {
    const preview = await vscode.workspace.openTextDocument({
      content: plan.document,
      language: "markit",
    });
    await vscode.window.showTextDocument(preview, { preview: false });
    return;
  }

  const edit = new vscode.WorkspaceEdit();
  edit.replace(
    document.uri,
    document.validateRange(new vscode.Range(0, 0, document.lineCount, 0)),
    plan.document,
  );
  await vscode.workspace.applyEdit(edit);
  await document.save();
};

const prompts: ImportPrompts = {
  tcpId: (prefill) =>
    Promise.resolve(
      vscode.window.showInputBox({
        title: "Import TEI Text from TCP",
        prompt: "The TCP id of the transcription to import",
        placeHolder: "A59472",
        value: prefill,
        validateInput: tcpIdError,
        ignoreFocusOut: true,
      }),
    ),
  confirm: async (id, report) => {
    const choice = await vscode.window.showWarningMessage(
      `Append the TCP transcription ${id} to this edition?`,
      { modal: true, detail: summarise(report) },
      "Append",
      "Preview",
    );
    return choice === "Append"
      ? "append"
      : choice === "Preview"
        ? "preview"
        : undefined;
  },
};

/** What arrived, in the modal's own words — the shape of the text, then the
 * markup worth knowing about before it lands. */
const summarise = (report: ImportReport): string =>
  [
    `${report.lines} lines: ${report.sections} sections, ` +
      `${report.blocks} blocks.`,
    `${report.diagnostics} compile diagnostics, ` +
      `${report.escapes} <<tag>> escapes, ` +
      `${report.pageMarkers} inline page markers, ` +
      `${report.puncGlyphs} ▪ glyphs.`,
    "This is the converter's raw output, unshaped: expect schema violations " +
      "(type/n keys, book_1 section ids, missing title/breadcrumb) as soon as " +
      "the file saves. Undo with the usual undo.",
  ].join("\n\n");
