/**
 * The Corpus Browser: a tree of authors → works → editions built from the
 * catalogue, replacing raw file-tree navigation. Clicking an author or an
 * edition opens its .mit file; works expand to their editions (the stub is on
 * the context menu). Labels come from metadata, so contributors see titles and
 * years, not slugs and paths.
 *
 * A collection edition borrows other editions' text (via `## <Author.Work.Ed>`
 * references). Those borrowed editions expand beneath the collection edition as
 * `borrowed` nodes, so the texts a collection composes are visible even when
 * they are collection-only (non-standalone) works hidden from the author list.
 *
 * The pure model — how authors are grouped, how borrowed children are recovered
 * — lives in lib/nodes.ts; this file is only the VSCode provider that renders it.
 */

import * as vscode from "vscode";
import type { Author, Catalogue, Edition, Work } from "@earlytexts/corpus";
import type { MarkitDocument } from "@jsr/earlytexts__markit";
import type { CorpusModel } from "../corpusModel.ts";
import {
  borrowedChildren,
  editionPath,
  editionsByDocument,
  type EditionRef,
  letterGroups,
  lifespan,
  type TreeNode,
} from "../lib/nodes.ts";

type Lookup = Map<MarkitDocument, EditionRef>;

export const createCorpusTree = (
  /** The model, once a corpus has been found (see extension.ts). */
  getModel: () => CorpusModel | undefined,
): vscode.TreeDataProvider<TreeNode> & { refresh: () => void } => {
  const emitter = new vscode.EventEmitter<TreeNode | undefined>();

  // The document→edition lookup, cached per catalogue (rebuilt on reload).
  let cached: { catalogue: Catalogue; lookup: Lookup } | undefined;
  const lookupFor = (catalogue: Catalogue): Lookup => {
    if (cached?.catalogue !== catalogue) {
      cached = { catalogue, lookup: editionsByDocument(catalogue) };
    }
    return cached.lookup;
  };

  return {
    onDidChangeTreeData: emitter.event,
    refresh: () => emitter.fire(undefined),

    getChildren: (node?: TreeNode): TreeNode[] => {
      const catalogue = getModel()?.state?.catalogue;
      if (catalogue === undefined) return [];
      if (node === undefined) {
        return letterGroups(catalogue.authors);
      }
      if (node.kind === "letter") {
        return node.authors.map((author) => ({ kind: "author", author }));
      }
      if (node.kind === "author") {
        // Collection-only works (standalone === false) are hidden here; they
        // surface beneath the collections that borrow them instead.
        return node.author.works
          .filter((work) => work.standalone)
          .map((work) => ({ kind: "work", work, author: node.author }));
      }
      if (node.kind === "work") {
        return node.work.editions.map((edition) => ({
          kind: "edition",
          edition,
          work: node.work,
        }));
      }
      if (node.kind === "edition" || node.kind === "borrowed") {
        return borrowedChildren(node.edition, lookupFor(catalogue)).map(
          ({ edition, work }) => ({ kind: "borrowed", edition, work }),
        );
      }
      return [];
    },

    getTreeItem: (node: TreeNode): vscode.TreeItem => {
      // Nodes only exist once the model has loaded (see getChildren), so the
      // catalogue and its lookup are always available here.
      const catalogue = getModel()!.state!.catalogue;
      const lookup = lookupFor(catalogue);
      switch (node.kind) {
        case "letter":
          return letterItem(node.letter);
        case "author":
          return authorItem(node.author);
        case "work":
          return workItem(node.work);
        case "borrowed":
          return borrowedItem(node.edition, node.work, catalogue, lookup);
        case "edition":
          return editionItem(node.edition, node.work, catalogue, lookup);
      }
    },
  };
};

const letterItem = (letter: string): vscode.TreeItem => {
  const item = new vscode.TreeItem(
    letter,
    vscode.TreeItemCollapsibleState.Expanded,
  );
  item.contextValue = "letter";
  return item;
};

const authorItem = (author: Author): vscode.TreeItem => {
  const item = new vscode.TreeItem(
    `${author.surname}, ${author.forename}`.replace(/, $/, ""),
    vscode.TreeItemCollapsibleState.Collapsed,
  );
  item.description = lifespan(author);
  item.iconPath = new vscode.ThemeIcon("person");
  item.contextValue = "author";
  item.tooltip = [
    author.title,
    `${author.forename} ${author.surname}`.trim(),
    lifespan(author),
    author.nationality,
  ]
    .filter((part) => part !== undefined && part !== "")
    .join(" · ");
  // No command: a single click toggles the branch (like a letter or a work).
  // Double-clicking opens the author's metadata — synthesised from the
  // expand/collapse pair in extension.ts, since tree views have no
  // double-click event.
  return item;
};

const workItem = (work: Work): vscode.TreeItem => {
  const item = new vscode.TreeItem(
    work.breadcrumb,
    vscode.TreeItemCollapsibleState.Collapsed,
  );
  item.description = String(work.firstPublished);
  item.iconPath = new vscode.ThemeIcon("book");
  item.contextValue = "work";
  item.tooltip = work.title;
  return item;
};

const borrowedItem = (
  edition: Edition,
  work: Work,
  catalogue: Catalogue,
  lookup: Lookup,
): vscode.TreeItem => {
  const nested = borrowedChildren(edition, lookup).length > 0;
  // The title, not the year: unlike a normal edition node, a borrowed one has
  // no work-title parent above it, so it must name the text itself.
  const item = new vscode.TreeItem(
    edition.title,
    nested
      ? vscode.TreeItemCollapsibleState.Collapsed
      : vscode.TreeItemCollapsibleState.None,
  );
  item.description = edition.slug;
  item.iconPath = new vscode.ThemeIcon("references");
  // As with edition nodes, a distinct value when a later edition follows (in
  // the borrowed edition's own work) so "Compare with Next" can hide.
  const hasNext = work.editions.indexOf(edition) < work.editions.length - 1;
  item.contextValue = hasNext ? "borrowedHasNext" : "borrowed";
  item.tooltip = `${edition.title} (borrowed into this collection)`;
  const path = editionPath(catalogue, edition);
  if (path !== undefined) item.command = openCommand(path);
  return item;
};

const editionItem = (
  edition: Edition,
  work: Work,
  catalogue: Catalogue,
  lookup: Lookup,
): vscode.TreeItem => {
  const canonical = edition.slug === work.canonicalSlug;
  // A collection edition borrows other editions; expand to show them.
  const borrows = borrowedChildren(edition, lookup).length > 0;
  const item = new vscode.TreeItem(
    edition.slug,
    borrows
      ? vscode.TreeItemCollapsibleState.Collapsed
      : vscode.TreeItemCollapsibleState.None,
  );
  item.iconPath = new vscode.ThemeIcon(canonical ? "star-full" : "file");
  // A distinct value when a later edition follows (editions are ascending by
  // year), so "Compare with Next" can hide on the latest/only edition.
  const hasNext = work.editions.indexOf(edition) < work.editions.length - 1;
  item.contextValue = hasNext ? "editionHasNext" : "edition";
  item.tooltip = canonical
    ? `${edition.title} (canonical edition)`
    : edition.title;
  const path = editionPath(catalogue, edition);
  if (path !== undefined) item.command = openCommand(path);
  return item;
};

const openCommand = (path: string): vscode.Command => ({
  command: "vscode.open",
  title: "Open",
  arguments: [vscode.Uri.file(path)],
});
