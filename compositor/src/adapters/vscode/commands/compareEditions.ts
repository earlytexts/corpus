/**
 * The editor surface of the compare-editions command: it supplies the edition
 * picks the flow needs and renders the outcome core/compareEditions.ts decides
 * — opening VSCode's native diff on two editions of the same work, or saying
 * why it cannot. Invoked from a work node (pick both editions), an edition node
 * (that edition against a sibling), or the command palette (pick the work, then
 * the editions).
 */

import * as vscode from "vscode";
import type { Edition, Work } from "@earlytexts/corpus";
import type { CorpusModel } from "../../../core/model/corpusModel.ts";
import type { TreeNode } from "../../../core/catalogue/nodes.ts";
import {
  type CompareOutcome,
  type ComparePrompts,
  compareEditions as decideCompare,
  compareWithNext as decideWithNext,
} from "../../../core/authoring/compareEditions.ts";

const pickEdition = async (
  editions: Edition[],
  placeHolder: string,
): Promise<Edition | undefined> => {
  const picked = await vscode.window.showQuickPick(
    editions.map((edition) => ({
      label: edition.slug,
      description: edition.title,
      edition,
    })),
    { placeHolder, matchOnDescription: true },
  );
  return picked?.edition;
};

const prompts: ComparePrompts = {
  pickWork: async (works: Work[]) => {
    const picked = await vscode.window.showQuickPick(
      works.map((work) => ({
        label: work.breadcrumb,
        description: `${work.editions.length} editions`,
        detail: work.title,
        work,
      })),
      { placeHolder: "Work to compare editions of", matchOnDescription: true },
    );
    return picked?.work;
  },
  pickBaseEdition: (editions) =>
    pickEdition(editions, "Left-hand (base) edition"),
  pickOtherEdition: (editions, base) =>
    pickEdition(editions, `Compare ${base.slug} with…`),
};

/** Act on the flow's decision: open the diff, or explain why not. */
const render = async (outcome: CompareOutcome): Promise<void> => {
  switch (outcome.kind) {
    case "diff":
      await vscode.commands.executeCommand(
        "vscode.diff",
        vscode.Uri.file(outcome.leftPath),
        vscode.Uri.file(outcome.rightPath),
        outcome.title,
      );
      return;
    case "noComparable":
      void vscode.window.showInformationMessage(
        "Compositor: no work has two editions to compare.",
      );
      return;
    case "singleEdition":
      void vscode.window.showInformationMessage(
        `Compositor: “${outcome.work.breadcrumb}” has only one edition to compare.`,
      );
      return;
    case "latestEdition":
      void vscode.window.showInformationMessage(
        `Compositor: “${outcome.edition.slug}” is the latest edition — nothing ` +
          "after it to compare.",
      );
      return;
    case "unlocatable":
      void vscode.window.showWarningMessage(
        "Compositor: could not locate the source file for one of the editions.",
      );
      return;
    case "cancelled":
      return;
  }
};

export const compareEditions = async (
  model: CorpusModel,
  node?: TreeNode,
): Promise<void> => {
  const catalogue = model.state?.catalogue;
  if (catalogue === undefined) return;
  await render(await decideCompare(catalogue, node, prompts));
};

export const compareWithNext = async (
  model: CorpusModel,
  node?: TreeNode,
): Promise<void> => {
  const catalogue = model.state?.catalogue;
  if (catalogue === undefined) return;
  await render(decideWithNext(catalogue, node));
};
