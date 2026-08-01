/**
 * The scaffolding flows — New Author, New Work, New Edition — over fake ports:
 * the prompts hand back whole metadata structs (or undefined to cancel), the
 * writable in-memory corpus captures what is written, and `open` records which
 * file is revealed. Also the field validators, the id/year defaults, and the
 * canonical rewrite the New Edition follow-up performs.
 */

import { expect, test } from "vitest";
import type { Author, Work } from "@earlytexts/corpus";
import { CORPUS_ROOT } from "@earlytexts/corpus/test";
import {
  authorFile,
  editionFile,
  stubFile,
} from "../../src/core/authoring/templates.ts";
import type { TreeNode } from "../../src/core/catalogue/nodes.ts";
import {
  defaultPublished,
  defaultWorkId,
  newAuthor,
  newEdition,
  newWork,
  requiredError,
  type ScaffoldDeps,
  type ScaffoldPrompts,
  setCanonical,
  slugError,
  yearError,
  yearSlugError,
} from "../../src/core/authoring/scaffolds.ts";
import { writableCorpus } from "../writableCorpus.ts";

const AUTHOR_META = {
  slug: "hume",
  forename: "David",
  surname: "Hume",
  birth: 1711,
  death: 1776,
  nationality: "Scottish",
  sex: "Male",
};

const WORK_META = {
  slug: "ehu",
  id: "Hume.EHU",
  title: "An Enquiry",
  breadcrumb: "First Enquiry",
  year: "1748",
  published: 1748,
};

const EDITION_META = { year: "1758", title: "An Enquiry", published: 1758 };

/** A no-op prompt set; each flow's test overrides just the prompts it drives. */
const noPrompts: ScaffoldPrompts = {
  authorDetails: () => Promise.resolve(undefined),
  chooseAuthor: () => Promise.resolve(undefined),
  workDetails: () => Promise.resolve(undefined),
  editionDetails: () => Promise.resolve(undefined),
  confirmCanonical: () => Promise.resolve(false),
};

/** Deps over a writable corpus, recording which files `open` reveals. */
const deps = (
  files: Record<string, string>,
  prompts: Partial<ScaffoldPrompts>,
): ScaffoldDeps & { opened: string[] } => {
  const opened: string[] = [];
  return {
    opened,
    fs: writableCorpus(files),
    open: (path) => {
      opened.push(path);
      return Promise.resolve();
    },
    prompts: { ...noPrompts, ...prompts },
  };
};

/* ------------------------------- validators ------------------------------ */

test("slugError accepts lowercase slugs and rejects everything else", () => {
  expect(slugError("ehu2")).toBeUndefined();
  expect(slugError("EHU")).toBe("Must be a lowercase slug (a-z, 0-9)");
  expect(slugError("")).toBe("Must be a lowercase slug (a-z, 0-9)");
});

test("yearSlugError accepts year slugs and rejects other input", () => {
  expect(yearSlugError("1748")).toBeUndefined();
  expect(yearSlugError("1742a")).toBeUndefined();
  expect(yearSlugError("1739-40")).toBeUndefined();
  expect(yearSlugError("later")).toBe(
    "Must be a year slug (1748, 1742a, 1739-40)",
  );
});

test("yearError accepts a bare year (trimmed) and rejects non-numbers", () => {
  expect(yearError("1748")).toBeUndefined();
  expect(yearError("  1748  ")).toBeUndefined();
  expect(yearError("MDCCXLVIII")).toBe("Must be a year (number)");
});

test("requiredError flags blank input", () => {
  expect(requiredError("Hume")).toBeUndefined();
  expect(requiredError("")).toBe("Required");
  expect(requiredError("   ")).toBe("Required");
});

/* -------------------------------- defaults ------------------------------- */

test("defaultWorkId composes the author and work slugs", () => {
  expect(defaultWorkId("hume", "ehu")).toBe("Hume.EHU");
});

test("defaultPublished takes the slug's leading four digits", () => {
  expect(defaultPublished("1742a")).toBe("1742");
  expect(defaultPublished("1739-40")).toBe("1739");
});

test("setCanonical repoints the stub's canonical edition", () => {
  const stub = stubFile({
    id: "Hume.EHU",
    title: "An Enquiry",
    breadcrumb: "First Enquiry",
    authors: ["hume"],
    canonical: "1748",
  });
  expect(setCanonical(stub, "1758")).toContain('canonical = "1758"');
  expect(setCanonical(stub, "1758")).not.toContain('canonical = "1748"');
});

/* ------------------------------- New Author ------------------------------ */

test("New Author writes the author file and opens it", async () => {
  const files: Record<string, string> = {};
  const d = deps(files, {
    authorDetails: () => Promise.resolve(AUTHOR_META),
  });

  await newAuthor(CORPUS_ROOT, d);

  const path = `${CORPUS_ROOT}/data/authors/hume.mit`;
  expect(files[path]).toBe(authorFile(AUTHOR_META));
  expect(d.opened).toEqual([path]);
});

test("New Author dismissed writes nothing", async () => {
  const files: Record<string, string> = {};
  const d = deps(files, { authorDetails: () => Promise.resolve(undefined) });

  await newAuthor(CORPUS_ROOT, d);

  expect(files).toEqual({});
  expect(d.opened).toEqual([]);
});

/* -------------------------------- New Work ------------------------------- */

const dir = `${CORPUS_ROOT}/data/works/hume/ehu`;

test("New Work from an author node writes the stub and edition, opening only the edition", async () => {
  const files: Record<string, string> = {};
  const author = { slug: "hume" } as Author;
  const node: TreeNode = { kind: "author", author };
  const d = deps(files, { workDetails: () => Promise.resolve(WORK_META) });

  await newWork(CORPUS_ROOT, node, [], d);

  expect(files[`${dir}/index.mit`]).toBe(
    stubFile({
      id: "Hume.EHU",
      title: "An Enquiry",
      breadcrumb: "First Enquiry",
      authors: ["hume"],
      canonical: "1748",
    }),
  );
  expect(files[`${dir}/1748.mit`]).toBe(
    editionFile({
      id: "Hume.EHU.1748",
      title: "An Enquiry",
      breadcrumb: "1748",
      authors: ["hume"],
      published: [1748],
    }),
  );
  // The stub is not opened; only the first edition is revealed.
  expect(d.opened).toEqual([`${dir}/1748.mit`]);
});

test("New Work with no node picks the author, then scaffolds", async () => {
  const files: Record<string, string> = {};
  const author = { slug: "hume" } as Author;
  const picked: Author[] = [];
  const d = deps(files, {
    chooseAuthor: (authors) => {
      picked.push(...authors);
      return Promise.resolve(author);
    },
    workDetails: () => Promise.resolve(WORK_META),
  });

  await newWork(CORPUS_ROOT, undefined, [author], d);

  expect(picked).toEqual([author]);
  expect(files[`${dir}/index.mit`]).toBeDefined();
  expect(files[`${dir}/1748.mit`]).toBeDefined();
});

test("New Work with no author chosen writes nothing", async () => {
  const files: Record<string, string> = {};
  const d = deps(files, { chooseAuthor: () => Promise.resolve(undefined) });

  await newWork(CORPUS_ROOT, undefined, [], d);

  expect(files).toEqual({});
  expect(d.opened).toEqual([]);
});

test("New Work with the details dismissed writes nothing", async () => {
  const files: Record<string, string> = {};
  const author = { slug: "hume" } as Author;
  const node: TreeNode = { kind: "author", author };
  const d = deps(files, { workDetails: () => Promise.resolve(undefined) });

  await newWork(CORPUS_ROOT, node, [], d);

  expect(files).toEqual({});
  expect(d.opened).toEqual([]);
});

/* ------------------------------ New Edition ------------------------------ */

const work = (): Work =>
  ({
    dir,
    authorSlugs: ["hume"],
    hostSlug: "hume",
    slug: "ehu",
    editions: [],
  }) as unknown as Work;

const existingStub = stubFile({
  id: "Hume.EHU",
  title: "An Enquiry",
  breadcrumb: "First Enquiry",
  authors: ["hume"],
  canonical: "1748",
});

test("New Edition writes and opens the dated edition, then makes it canonical", async () => {
  const files: Record<string, string> = { [`${dir}/index.mit`]: existingStub };
  const d = deps(files, {
    editionDetails: () => Promise.resolve(EDITION_META),
    confirmCanonical: () => Promise.resolve(true),
  });

  await newEdition(work(), d);

  expect(files[`${dir}/1758.mit`]).toBe(
    editionFile({
      id: "Hume.EHU.1758",
      title: "An Enquiry",
      breadcrumb: "1758",
      authors: ["hume"],
      published: [1758],
    }),
  );
  expect(d.opened).toEqual([`${dir}/1758.mit`]);
  // The stub's canonical pointer was rewritten to the new edition.
  expect(files[`${dir}/index.mit`]).toContain('canonical = "1758"');
});

test("New Edition declining the canonical offer leaves the stub alone", async () => {
  const files: Record<string, string> = { [`${dir}/index.mit`]: existingStub };
  const d = deps(files, {
    editionDetails: () => Promise.resolve(EDITION_META),
    confirmCanonical: () => Promise.resolve(false),
  });

  await newEdition(work(), d);

  expect(files[`${dir}/1758.mit`]).toBeDefined();
  expect(files[`${dir}/index.mit`]).toBe(existingStub);
});

test("New Edition dismissed writes nothing", async () => {
  const files: Record<string, string> = {};
  const d = deps(files, { editionDetails: () => Promise.resolve(undefined) });

  await newEdition(work(), d);

  expect(files).toEqual({});
  expect(d.opened).toEqual([]);
});

test("New Edition made canonical with no stub on disk cannot rewrite it", async () => {
  // The edition is written and opened, but the missing index.mit leaves nothing
  // to repoint.
  const files: Record<string, string> = {};
  const d = deps(files, {
    editionDetails: () => Promise.resolve(EDITION_META),
    confirmCanonical: () => Promise.resolve(true),
  });

  await newEdition(work(), d);

  expect(files[`${dir}/1758.mit`]).toBeDefined();
  expect(files[`${dir}/index.mit`]).toBeUndefined();
});
