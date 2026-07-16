/**
 * The Dictionary Curation view: the corpus-wide backlog of unaccounted
 * surfaces (curation.ts), ranked most-frequent first, as a flat list beside the
 * Corpus Browser. Selecting a surface opens one place it is attested (so the
 * decision can be made in context); the right-click menu curates it — add as
 * modern, respell, or set a lemma — reusing the same shard writer the editor
 * quick-fixes use (`compositor.dictionaryEntry`). Writing a shard reloads the
 * corpus, which refreshes this list, so a curated surface drops off.
 *
 * The list is recomputed from the loaded catalogue (no computer dependency) and
 * capped, since until backfill the backlog is the whole vocabulary; the title
 * reports how many of the total are shown.
 */

import * as vscode from "vscode";
import { type CurationEntry, curationList } from "../lib/curation.ts";
import type { CorpusModel } from "../corpusModel.ts";

/** How many surfaces to show — the most frequent, the ones worth curating first. */
const MAX_SHOWN = 2000;

export type CurationView = {
  /** The corpus reloaded (or a shard was written): recompute the worklist. */
  onCorpusChanged: () => void;
};

export const createCurationView = (
  getModel: () => CorpusModel | undefined,
  context: vscode.ExtensionContext,
): CurationView => {
  const emitter = new vscode.EventEmitter<undefined>();

  /** The worklist, cached per catalogue (recomputed on reload). */
  let cache: { catalogue: unknown; entries: CurationEntry[] } | undefined;
  const entriesOf = (): CurationEntry[] => {
    const catalogue = getModel()?.state?.catalogue;
    if (catalogue === undefined) return [];
    if (cache?.catalogue !== catalogue) {
      cache = { catalogue, entries: curationList(catalogue) };
    }
    return cache.entries;
  };

  const provider: vscode.TreeDataProvider<CurationEntry> = {
    onDidChangeTreeData: emitter.event,
    getChildren: (node) =>
      node === undefined ? entriesOf().slice(0, MAX_SHOWN) : [],
    getTreeItem: (entry) => {
      const item = new vscode.TreeItem(
        entry.surface,
        vscode.TreeItemCollapsibleState.None,
      );
      item.description = `×${entry.count}`;
      item.contextValue = "curationUnaccounted";
      item.iconPath = new vscode.ThemeIcon("warning");
      item.tooltip = `“${entry.surface}” — not in the dictionary, ${entry.count} occurrence(s)`;
      if (entry.example !== undefined) {
        const position = new vscode.Position(entry.example.line, 0);
        item.command = {
          command: "vscode.open",
          title: "Open in context",
          arguments: [
            vscode.Uri.file(entry.example.path),
            { selection: new vscode.Range(position, position) },
          ],
        };
      }
      return item;
    },
  };

  const view = vscode.window.createTreeView("compositor.curation", {
    treeDataProvider: provider,
  });

  const refresh = (): void => {
    const total = entriesOf().length;
    const shown = Math.min(total, MAX_SHOWN);
    view.message =
      total === 0
        ? undefined
        : shown < total
          ? `${shown} of ${total} surfaces to curate (most frequent first)`
          : `${total} surface(s) to curate`;
    emitter.fire(undefined);
  };

  // A curate action reads the surface off the right-clicked node and hands it to
  // the shared shard writer; kind decides which entry it writes.
  const curate =
    (kind: "modern" | "respell" | "lemma") =>
    (entry?: CurationEntry): void => {
      if (entry === undefined) return;
      void vscode.commands.executeCommand(
        "compositor.dictionaryEntry",
        entry.surface,
        kind,
      );
    };

  context.subscriptions.push(
    view,
    emitter,
    vscode.commands.registerCommand(
      "compositor.curateModern",
      curate("modern"),
    ),
    vscode.commands.registerCommand(
      "compositor.curateRespell",
      curate("respell"),
    ),
    vscode.commands.registerCommand("compositor.curateLemma", curate("lemma")),
  );

  refresh();
  return { onCorpusChanged: refresh };
};
