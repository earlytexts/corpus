/**
 * Open VSCode's native diff view on two editions of the same work — the usual
 * way to see what changed between, say, the 1748 and 1758 printings of a text.
 * Invoked from a work node (pick both editions), an edition node (that edition
 * against a sibling), or the command palette (pick the work, then the editions).
 */

import * as vscode from "vscode";
import type { Catalogue, Edition, Work } from "@earlytexts/corpus";
import type { CorpusModel } from "../../corpusModel.ts";
import { editionPath, type TreeNode } from "../../lib/nodes.ts";
import { comparableWorks, nextEdition } from "../../lib/compareScope.ts";

/** Open the native diff view on two editions (left = base), or explain why not. */
const openDiff = async (
  catalogue: Catalogue,
  work: Work,
  left: Edition,
  right: Edition,
): Promise<void> => {
  const leftPath = editionPath(catalogue, left);
  const rightPath = editionPath(catalogue, right);
  if (leftPath === undefined || rightPath === undefined) {
    void vscode.window.showWarningMessage(
      "Compositor: could not locate the source file for one of the editions.",
    );
    return;
  }
  await vscode.commands.executeCommand(
    "vscode.diff",
    vscode.Uri.file(leftPath),
    vscode.Uri.file(rightPath),
    `${work.breadcrumb}: ${left.slug} ↔ ${right.slug}`,
  );
};

const pickEdition = async (
  editions: Edition[],
  placeHolder: string,
): Promise<Edition | undefined> => {
  const items = editions.map((edition) => ({
    label: edition.slug,
    description: edition.title,
    edition,
  }));
  const picked = await vscode.window.showQuickPick(items, {
    placeHolder,
    matchOnDescription: true,
  });
  return picked?.edition;
};

export const compareEditions = async (
  model: CorpusModel,
  node?: TreeNode,
): Promise<void> => {
  const catalogue = model.state?.catalogue;
  if (catalogue === undefined) return;

  // Fix the work from the invoking node, or ask which one. A borrowed node
  // carries its edition's own work, so it fixes the comparison like an edition.
  let work =
    node?.kind === "work" ||
    node?.kind === "edition" ||
    node?.kind === "borrowed"
      ? node.work
      : undefined;
  if (work === undefined) {
    const works = comparableWorks(catalogue.authors);
    if (works.length === 0) {
      void vscode.window.showInformationMessage(
        "Compositor: no work has two editions to compare.",
      );
      return;
    }
    const picked = await vscode.window.showQuickPick(
      works.map((w) => ({
        label: w.breadcrumb,
        description: `${w.editions.length} editions`,
        detail: w.title,
        work: w,
      })),
      { placeHolder: "Work to compare editions of", matchOnDescription: true },
    );
    if (picked === undefined) return;
    work = picked.work;
  }

  if (work.editions.length < 2) {
    void vscode.window.showInformationMessage(
      `Compositor: “${work.breadcrumb}” has only one edition to compare.`,
    );
    return;
  }

  // An edition (or borrowed) node fixes the left side; otherwise pick both.
  const left =
    node?.kind === "edition" || node?.kind === "borrowed"
      ? node.edition
      : await pickEdition(work.editions, "Left-hand (base) edition");
  if (left === undefined) return;
  const right = await pickEdition(
    work.editions.filter((edition) => edition !== left),
    `Compare ${left.slug} with…`,
  );
  if (right === undefined) return;

  await openDiff(catalogue, work, left, right);
};

/**
 * Diff an edition against the one that follows it chronologically (editions are
 * held ascending by year, so its successor in the list). The menu entry hides
 * on the latest/only edition, but guard anyway for palette/programmatic calls.
 */
export const compareWithNext = async (
  model: CorpusModel,
  node?: TreeNode,
): Promise<void> => {
  const catalogue = model.state?.catalogue;
  if (
    catalogue === undefined ||
    (node?.kind !== "edition" && node?.kind !== "borrowed")
  )
    return;
  const { work, edition } = node;
  const next = nextEdition(work, edition);
  if (next === undefined) {
    void vscode.window.showInformationMessage(
      `Compositor: “${edition.slug}” is the latest edition — nothing after ` +
        "it to compare.",
    );
    return;
  }
  await openDiff(catalogue, work, edition, next);
};
