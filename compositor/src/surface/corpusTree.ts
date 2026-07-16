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
 */

import * as vscode from "vscode";
import type { Author, Catalogue, Edition, Work } from "@earlytexts/corpus";
import type { MarkitDocument } from "@jsr/earlytexts__markit";
import type { CorpusModel } from "../corpusModel.ts";
import { editionPath, type TreeNode } from "../lib/nodes.ts";

/** The initial letter an author is filed under (by surname, falling back to slug). */
const authorLetter = (author: Author): string =>
  (author.surname || author.slug).charAt(0).toUpperCase();

/**
 * Group authors under their initial letter, alphabetically. The catalogue
 * orders authors chronologically; the tree re-sorts them by surname then
 * forename so the browser reads like an index.
 */
const letterGroups = (authors: readonly Author[]): TreeNode[] => {
  const sorted = [...authors].sort(
    (a, b) =>
      a.surname.localeCompare(b.surname) ||
      a.forename.localeCompare(b.forename),
  );
  const groups = new Map<string, Author[]>();
  for (const author of sorted) {
    const letter = authorLetter(author);
    const group = groups.get(letter);
    if (group === undefined) groups.set(letter, [author]);
    else group.push(author);
  }
  return [...groups.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([letter, authors]) => ({ kind: "letter", letter, authors }));
};

/**
 * Every edition in the catalogue, keyed by its composed document. A borrowed
 * child is the very same document object as the edition it points at (the
 * catalogue build splices in the loaded edition, not a copy), so this lets us
 * recover the edition — and its work — from a collection's spliced-in children.
 */
const editionsByDocument = (
  catalogue: Catalogue,
): Map<MarkitDocument, { edition: Edition; work: Work }> => {
  const map = new Map<MarkitDocument, { edition: Edition; work: Work }>();
  for (const author of catalogue.authors) {
    for (const work of author.works) {
      for (const edition of work.editions) {
        map.set(edition.document, { edition, work });
      }
    }
  }
  return map;
};

/**
 * The editions an edition borrows: its document's direct children that are
 * themselves editions in the catalogue. Inline sections (a collection's own
 * text) are distinct documents and are skipped; only spliced-in editions match.
 */
const borrowedChildren = (
  edition: Edition,
  lookup: Map<MarkitDocument, { edition: Edition; work: Work }>,
): { edition: Edition; work: Work }[] =>
  edition.document.children
    .map((child) => lookup.get(child))
    .filter((m): m is { edition: Edition; work: Work } => m !== undefined);

const lifespan = (author: Author): string =>
  author.birth !== undefined || author.death !== undefined
    ? `(${author.birth ?? "?"}–${author.death ?? "?"})`
    : "";

const openCommand = (path: string): vscode.Command => ({
  command: "vscode.open",
  title: "Open",
  arguments: [vscode.Uri.file(path)],
});

export const createCorpusTree = (
  /** The model, once a corpus has been found (see extension.ts). */
  getModel: () => CorpusModel | undefined,
): vscode.TreeDataProvider<TreeNode> & { refresh: () => void } => {
  const emitter = new vscode.EventEmitter<TreeNode | undefined>();

  // The document→edition lookup, cached per catalogue (rebuilt on reload).
  let cached:
    | { catalogue: Catalogue; lookup: ReturnType<typeof editionsByDocument> }
    | undefined;
  const lookupFor = (
    catalogue: Catalogue,
  ): ReturnType<typeof editionsByDocument> => {
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
      // Nodes only exist once the model has loaded (see getChildren).
      const model = getModel()!;
      if (node.kind === "letter") {
        const item = new vscode.TreeItem(
          node.letter,
          vscode.TreeItemCollapsibleState.Expanded,
        );
        item.contextValue = "letter";
        return item;
      }
      if (node.kind === "author") {
        const { author } = node;
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
        // No command: a single click toggles the branch (like a letter or a
        // work). Double-clicking opens the author's metadata — synthesised from
        // the expand/collapse pair in extension.ts, since tree views have no
        // double-click event.
        return item;
      }
      if (node.kind === "work") {
        const { work } = node;
        const item = new vscode.TreeItem(
          work.breadcrumb,
          vscode.TreeItemCollapsibleState.Collapsed,
        );
        item.description = String(work.firstPublished);
        item.iconPath = new vscode.ThemeIcon("book");
        item.contextValue = "work";
        item.tooltip = work.title;
        return item;
      }
      const catalogue = model.state!.catalogue;
      if (node.kind === "borrowed") {
        const { edition, work } = node;
        const nested =
          borrowedChildren(edition, lookupFor(catalogue)).length > 0;
        // The title, not the year: unlike a normal edition node, a borrowed one
        // has no work-title parent above it, so it must name the text itself.
        const item = new vscode.TreeItem(
          edition.title,
          nested
            ? vscode.TreeItemCollapsibleState.Collapsed
            : vscode.TreeItemCollapsibleState.None,
        );
        item.description = edition.slug;
        item.iconPath = new vscode.ThemeIcon("references");
        // As with edition nodes, a distinct value when a later edition follows
        // (in the borrowed edition's own work) so "Compare with Next" can hide.
        const hasNext =
          work.editions.indexOf(edition) < work.editions.length - 1;
        item.contextValue = hasNext ? "borrowedHasNext" : "borrowed";
        item.tooltip = `${edition.title} (borrowed into this collection)`;
        const path = editionPath(catalogue, edition);
        if (path !== undefined) item.command = openCommand(path);
        return item;
      }
      const { edition, work } = node;
      const canonical = edition.slug === work.canonicalSlug;
      // A collection edition borrows other editions; expand to show them.
      const borrows =
        borrowedChildren(edition, lookupFor(catalogue)).length > 0;
      const item = new vscode.TreeItem(
        edition.slug,
        borrows
          ? vscode.TreeItemCollapsibleState.Collapsed
          : vscode.TreeItemCollapsibleState.None,
      );
      item.iconPath = new vscode.ThemeIcon(canonical ? "star-full" : "file");
      // A distinct value when a later edition follows (editions are ascending
      // by year), so "Compare with Next" can hide on the latest/only edition.
      const hasNext = work.editions.indexOf(edition) < work.editions.length - 1;
      item.contextValue = hasNext ? "editionHasNext" : "edition";
      item.tooltip = canonical
        ? `${edition.title} (canonical edition)`
        : edition.title;
      const path = editionPath(catalogue, edition);
      if (path !== undefined) item.command = openCommand(path);
      return item;
    },
  };
};
