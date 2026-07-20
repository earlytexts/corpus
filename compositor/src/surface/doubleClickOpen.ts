/**
 * Double-click on an author or work opens its metadata. Tree views have no
 * double-click event, so we synthesise one: authors and works carry no command,
 * so a single click toggles the branch (firing an expand or collapse event); a
 * double-click toggles it twice, landing it back where it began and giving us
 * two events on the same node in quick succession. Editions carry their own open
 * command and are untouched by this.
 */

import * as vscode from "vscode";
import { authorPath, type TreeNode } from "../lib/nodes.ts";
import type { CorpusModel } from "../corpusModel.ts";

const DOUBLE_CLICK_MS = 500;

/** Wire the synthesised double-click onto a tree view; returns the two event
 * subscriptions for the caller to dispose. */
export const registerDoubleClickOpen = (
  view: vscode.TreeView<TreeNode>,
  getModel: () => CorpusModel | undefined,
): vscode.Disposable[] => {
  let lastToggle: { node: TreeNode; at: number } | undefined;
  const openMetadata = (node: TreeNode): void => {
    const model = getModel();
    if (model === undefined) return;
    const uri =
      node.kind === "author"
        ? vscode.Uri.file(authorPath(model.root, node.author))
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
  return [
    view.onDidExpandElement((e) => onToggle(e.element)),
    view.onDidCollapseElement((e) => onToggle(e.element)),
  ];
};
