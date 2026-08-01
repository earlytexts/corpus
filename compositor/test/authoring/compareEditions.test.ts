/**
 * The vscode-free heart of "compare editions": choosing two editions to diff and
 * locating their sources, handed back as one `CompareOutcome`. Every variant of
 * the union is steered here by feeding a real catalogue plus prompt fakes that
 * record their calls, in the spirit of workflow.test.ts. `compareWithNext` is
 * pure (no prompts).
 */

import { expect, test } from "vitest";
import { buildCatalogue } from "@earlytexts/corpus";
import type { Catalogue, Edition, Work } from "@earlytexts/corpus";
import { CORPUS_ROOT, corpus, memoryCorpus } from "@earlytexts/corpus/test";
import {
  compareEditions,
  compareWithNext,
  type ComparePrompts,
} from "../../src/core/authoring/compareEditions.ts";
import type { TreeNode } from "../../src/core/catalogue/nodes.ts";

// Hume: the Enquiry (two editions, comparable) and the Treatise (one only).
const fixture = () =>
  corpus()
    .author("hume", { forename: "David", surname: "Hume" })
    .work("hume", "enquiry", {
      title: "An Enquiry",
      breadcrumb: "Enquiry",
      canonical: "1748",
    })
    .edition("hume", "enquiry", "1748", {
      imported: false,
      title: "An Enquiry",
      breadcrumb: "1748",
      published: [1748],
    })
    .edition("hume", "enquiry", "1758", {
      imported: false,
      title: "An Enquiry",
      breadcrumb: "1758",
      published: [1758],
    })
    .work("hume", "treatise", {
      title: "A Treatise",
      breadcrumb: "Treatise",
      canonical: "1739",
    })
    .edition("hume", "treatise", "1739", {
      imported: false,
      title: "A Treatise",
      breadcrumb: "1739",
      published: [1739],
    })
    .build();

const catalogue = async (): Promise<Catalogue> => {
  const { catalogue } = await buildCatalogue(
    memoryCorpus(fixture()),
    CORPUS_ROOT,
  );
  return catalogue;
};

const enquiry = (cat: Catalogue): Work =>
  cat.byAuthor.get("hume")!.works.find((w) => w.breadcrumb === "Enquiry")!;

const treatise = (cat: Catalogue): Work =>
  cat.byAuthor.get("hume")!.works.find((w) => w.breadcrumb === "Treatise")!;

/** A ComparePrompts that records its calls and answers from fixtures. */
const fakePrompts = (
  answers: {
    work?: Work;
    base?: Edition;
    other?: Edition;
  } = {},
): ComparePrompts & { calls: string[] } => {
  const calls: string[] = [];
  return {
    calls,
    pickWork: (works) => {
      calls.push(`pickWork(${works.map((w) => w.breadcrumb).join(",")})`);
      return Promise.resolve(answers.work);
    },
    pickBaseEdition: (editions) => {
      calls.push(`pickBaseEdition(${editions.map((e) => e.slug).join(",")})`);
      return Promise.resolve(answers.base);
    },
    pickOtherEdition: (editions, base) => {
      calls.push(
        `pickOtherEdition(${editions.map((e) => e.slug).join(",")}|${base.slug})`,
      );
      return Promise.resolve(answers.other);
    },
  };
};

/* ------------------------------ diff outcome ------------------------------ */

test("both editions picked (no node) opens the diff, base on the left", async () => {
  const cat = await catalogue();
  const work = enquiry(cat);
  const [first, second] = work.editions;
  const prompts = fakePrompts({ work, base: first, other: second });

  const outcome = await compareEditions(cat, undefined, prompts);

  expect(outcome).toEqual({
    kind: "diff",
    leftPath: `${CORPUS_ROOT}/data/works/hume/enquiry/1748.mit`,
    rightPath: `${CORPUS_ROOT}/data/works/hume/enquiry/1758.mit`,
    title: "Enquiry: 1748 ↔ 1758",
  });
  // The work was picked, then the base, then the other from the rest.
  expect(prompts.calls).toEqual([
    "pickWork(Enquiry)",
    "pickBaseEdition(1748,1758)",
    "pickOtherEdition(1758|1748)",
  ]);
});

test("an edition node fixes both the work and the base, picking only the other", async () => {
  const cat = await catalogue();
  const work = enquiry(cat);
  const [first, second] = work.editions;
  const node: TreeNode = { kind: "edition", edition: first, work };
  const prompts = fakePrompts({ other: second });

  const outcome = await compareEditions(cat, node, prompts);

  expect(outcome).toMatchObject({
    kind: "diff",
    title: "Enquiry: 1748 ↔ 1758",
  });
  // No work or base pick — only the other side.
  expect(prompts.calls).toEqual(["pickOtherEdition(1758|1748)"]);
});

test("a borrowed node behaves like an edition node", async () => {
  const cat = await catalogue();
  const work = enquiry(cat);
  const [first, second] = work.editions;
  const node: TreeNode = { kind: "borrowed", edition: first, work };
  const prompts = fakePrompts({ other: second });

  const outcome = await compareEditions(cat, node, prompts);

  expect(outcome).toMatchObject({ kind: "diff" });
  expect(prompts.calls).toEqual(["pickOtherEdition(1758|1748)"]);
});

/* ------------------------------ dead ends -------------------------------- */

test("nothing in the corpus has two editions", async () => {
  const cat = await catalogue();
  // Strip the Enquiry, leaving only the single-edition Treatise.
  const only = treatise(cat);
  const trimmed = {
    ...cat,
    authors: [{ ...cat.byAuthor.get("hume")!, works: [only] }],
  } as Catalogue;
  const prompts = fakePrompts();

  expect(await compareEditions(trimmed, undefined, prompts)).toEqual({
    kind: "noComparable",
  });
  expect(prompts.calls).toEqual([]);
});

test("the chosen work has only one edition", async () => {
  const cat = await catalogue();
  const work = treatise(cat);
  const node: TreeNode = { kind: "work", work, author: cat.authors[0] };

  expect(await compareEditions(cat, node, fakePrompts())).toEqual({
    kind: "singleEdition",
    work,
  });
});

test("dismissing the work pick cancels", async () => {
  const cat = await catalogue();
  const prompts = fakePrompts({ work: undefined });
  expect(await compareEditions(cat, undefined, prompts)).toEqual({
    kind: "cancelled",
  });
  expect(prompts.calls).toEqual(["pickWork(Enquiry)"]);
});

test("dismissing the base pick cancels", async () => {
  const cat = await catalogue();
  const work = enquiry(cat);
  const prompts = fakePrompts({ work, base: undefined });
  expect(await compareEditions(cat, undefined, prompts)).toEqual({
    kind: "cancelled",
  });
});

test("dismissing the other pick cancels", async () => {
  const cat = await catalogue();
  const work = enquiry(cat);
  const [first] = work.editions;
  const prompts = fakePrompts({ work, base: first, other: undefined });
  expect(await compareEditions(cat, undefined, prompts)).toEqual({
    kind: "cancelled",
  });
});

test("an edition whose source is not in the catalogue is unlocatable", async () => {
  const cat = await catalogue();
  const work = enquiry(cat);
  const [first, second] = work.editions;
  const node: TreeNode = { kind: "edition", edition: first, work };
  // A catalogue that can locate no source files at all.
  const blind = { ...cat, sources: new WeakMap() } as Catalogue;

  expect(
    await compareEditions(blind, node, fakePrompts({ other: second })),
  ).toEqual({ kind: "unlocatable" });
});

/* ---------------------------- compareWithNext ---------------------------- */

test("compareWithNext diffs an edition against its successor", async () => {
  const cat = await catalogue();
  const work = enquiry(cat);
  const [first] = work.editions;
  const node: TreeNode = { kind: "edition", edition: first, work };

  expect(compareWithNext(cat, node)).toEqual({
    kind: "diff",
    leftPath: `${CORPUS_ROOT}/data/works/hume/enquiry/1748.mit`,
    rightPath: `${CORPUS_ROOT}/data/works/hume/enquiry/1758.mit`,
    title: "Enquiry: 1748 ↔ 1758",
  });
});

test("compareWithNext on the latest edition has nothing to diff", async () => {
  const cat = await catalogue();
  const work = enquiry(cat);
  const second = work.editions[1];
  const node: TreeNode = { kind: "borrowed", edition: second, work };

  expect(compareWithNext(cat, node)).toEqual({
    kind: "latestEdition",
    edition: second,
  });
});

test("compareWithNext off an edition/borrowed node cancels", async () => {
  const cat = await catalogue();
  const node: TreeNode = {
    kind: "work",
    work: enquiry(cat),
    author: cat.authors[0],
  };
  expect(compareWithNext(cat, node)).toEqual({ kind: "cancelled" });
  expect(compareWithNext(cat, undefined)).toEqual({ kind: "cancelled" });
});
