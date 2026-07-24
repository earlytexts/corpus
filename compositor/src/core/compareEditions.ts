/**
 * Deciding which two editions to diff, and where their sources are — the
 * vscode-free heart of the "compare editions" command. A comparison can be
 * fixed from the invoking tree node (a work, an edition, a borrowed child) or
 * chosen through the editor's picks; either way every judgment (is there
 * anything to compare, which is the base, where do the files live) is made here
 * and handed back as one `CompareOutcome`. The editor layer
 * (commands/compareEditions.ts) supplies the picks and renders the outcome —
 * opening the native diff or explaining why it cannot.
 *
 * The scope rules (which works have two editions, which edition follows which)
 * live in compareScope.ts; this is the interactive walk over them.
 */

import type { Catalogue, Edition, Work } from "@earlytexts/corpus";
import { editionPath, type TreeNode } from "./nodes.ts";
import { comparableWorks, nextEdition } from "./compareScope.ts";

/** How the compare flow ends. The editor renders exactly one of these. */
export type CompareOutcome =
  /** Open the native diff on these two source files (left = base). */
  | { kind: "diff"; leftPath: string; rightPath: string; title: string }
  /** The contributor dismissed a pick — nothing to do. */
  | { kind: "cancelled" }
  /** No work in the corpus has two editions to compare. */
  | { kind: "noComparable" }
  /** The chosen work has only one edition. */
  | { kind: "singleEdition"; work: Work }
  /** Compare-with-next was asked of the latest edition. */
  | { kind: "latestEdition"; edition: Edition }
  /** An edition's source file could not be located in the catalogue. */
  | { kind: "unlocatable" };

/** The picks the compare flow defers to the editor. Each resolves undefined
 * when the contributor dismisses it, ending the flow as a cancel. */
export type ComparePrompts = {
  pickWork: (works: Work[]) => Promise<Work | undefined>;
  pickBaseEdition: (editions: Edition[]) => Promise<Edition | undefined>;
  pickOtherEdition: (
    editions: Edition[],
    base: Edition,
  ) => Promise<Edition | undefined>;
};

/**
 * Choose two editions of one work to diff. The work is fixed by the invoking
 * node (a work/edition/borrowed node) or picked; an edition/borrowed node also
 * fixes the base, otherwise both sides are picked.
 */
export const compareEditions = async (
  catalogue: Catalogue,
  node: TreeNode | undefined,
  prompts: ComparePrompts,
): Promise<CompareOutcome> => {
  // A borrowed node carries its edition's own work, so it fixes the comparison
  // like an edition does.
  let work =
    node?.kind === "work" ||
    node?.kind === "edition" ||
    node?.kind === "borrowed"
      ? node.work
      : undefined;
  if (work === undefined) {
    const works = comparableWorks(catalogue.authors);
    if (works.length === 0) return { kind: "noComparable" };
    work = await prompts.pickWork(works);
    if (work === undefined) return { kind: "cancelled" };
  }
  if (work.editions.length < 2) return { kind: "singleEdition", work };

  const left =
    node?.kind === "edition" || node?.kind === "borrowed"
      ? node.edition
      : await prompts.pickBaseEdition(work.editions);
  if (left === undefined) return { kind: "cancelled" };
  const right = await prompts.pickOtherEdition(
    work.editions.filter((edition) => edition !== left),
    left,
  );
  if (right === undefined) return { kind: "cancelled" };

  return diffOutcome(catalogue, work, left, right);
};

/**
 * Diff an edition against the one that follows it chronologically (editions are
 * held ascending by year, so its successor in the list). Fully determined by
 * the node — no picks — so it needs no prompts.
 */
export const compareWithNext = (
  catalogue: Catalogue,
  node: TreeNode | undefined,
): CompareOutcome => {
  if (node?.kind !== "edition" && node?.kind !== "borrowed") {
    return { kind: "cancelled" };
  }
  const { work, edition } = node;
  const next = nextEdition(work, edition);
  if (next === undefined) return { kind: "latestEdition", edition };
  return diffOutcome(catalogue, work, edition, next);
};

/** The diff of two editions (left = base), or `unlocatable` if either source
 * file is missing from the catalogue. */
const diffOutcome = (
  catalogue: Catalogue,
  work: Work,
  left: Edition,
  right: Edition,
): CompareOutcome => {
  const leftPath = editionPath(catalogue, left);
  const rightPath = editionPath(catalogue, right);
  if (leftPath === undefined || rightPath === undefined) {
    return { kind: "unlocatable" };
  }
  return {
    kind: "diff",
    leftPath,
    rightPath,
    title: `${work.breadcrumb}: ${left.slug} ↔ ${right.slug}`,
  };
};
