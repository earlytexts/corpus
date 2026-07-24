/**
 * The editor surface of the scaffolding flows (New Author, New Work, New
 * Edition): it implements the metadata prompts as input boxes — wiring in the
 * validators core/scaffolds.ts exports — and provides the fs/open adapters the
 * flows write through. Every flow decision, the validation rules, and the file
 * contents live in core; this module is the prompts and the writes.
 */

import * as vscode from "vscode";
import type { Author, Work } from "@earlytexts/corpus";
import { nodeCorpusFs } from "@earlytexts/corpus";
import type { CorpusModel } from "../../core/corpusModel.ts";
import type { TreeNode } from "../../core/nodes.ts";
import {
  type AuthorMeta,
  defaultPublished,
  defaultWorkId,
  type EditionMeta,
  newAuthor as coreNewAuthor,
  newEdition as coreNewEdition,
  newWork as coreNewWork,
  requiredError,
  type ScaffoldDeps,
  type ScaffoldPrompts,
  slugError,
  type WorkMeta,
  yearError,
  yearSlugError,
} from "../../core/scaffolds.ts";

const ask = (
  prompt: string,
  options: Omit<vscode.InputBoxOptions, "prompt"> = {},
): Thenable<string | undefined> =>
  vscode.window.showInputBox({ prompt, ignoreFocusOut: true, ...options });

const askRequired = (prompt: string, value?: string) =>
  ask(prompt, {
    ...(value === undefined ? {} : { value }),
    validateInput: requiredError,
  });

const askYear = (prompt: string) =>
  ask(prompt, {
    placeHolder: "e.g. 1748, 1742a, 1739-40",
    validateInput: yearSlugError,
  });

const askNumber = (prompt: string, value?: string) =>
  ask(prompt, {
    ...(value === undefined ? {} : { value }),
    validateInput: yearError,
  });

/** Gather a new author's metadata, or undefined if the contributor backs out. */
const authorDetails = async (root: string): Promise<AuthorMeta | undefined> => {
  const slug = await ask("Author slug (the file name, e.g. hume)", {
    validateInput: async (input) => {
      const bad = slugError(input);
      if (bad !== undefined) return bad;
      const exists = await nodeCorpusFs.stat(
        `${root}/data/authors/${input}.mit`,
      );
      return exists === null ? undefined : "That author file already exists";
    },
  });
  if (slug === undefined) return undefined;
  const forename = await askRequired("Forename");
  if (forename === undefined) return undefined;
  const surname = await askRequired("Surname");
  if (surname === undefined) return undefined;
  const birth = await askNumber("Year of birth");
  if (birth === undefined) return undefined;
  const death = await askNumber("Year of death");
  if (death === undefined) return undefined;
  const nationality = await askRequired("Nationality (e.g. English, Scottish)");
  if (nationality === undefined) return undefined;
  const sex = await vscode.window.showQuickPick(["Male", "Female"], {
    placeHolder: "Sex",
    ignoreFocusOut: true,
  });
  if (sex === undefined) return undefined;
  return {
    slug,
    forename: forename.trim(),
    surname: surname.trim(),
    birth: Number(birth),
    death: Number(death),
    nationality: nationality.trim(),
    sex,
  };
};

const chooseAuthor = async (authors: Author[]): Promise<Author | undefined> => {
  const picked = await vscode.window.showQuickPick(
    authors.map((author) => ({
      label: `${author.surname}, ${author.forename}`.replace(/, $/, ""),
      description: author.slug,
      author,
    })),
    { placeHolder: "Author" },
  );
  return picked?.author;
};

/** Gather a new work's metadata, or undefined if the contributor backs out. */
const workDetails = async (
  author: Author,
  root: string,
): Promise<WorkMeta | undefined> => {
  const slug = await ask("Work slug (the directory name, e.g. ehu)", {
    validateInput: async (input) => {
      const bad = slugError(input);
      if (bad !== undefined) return bad;
      const exists = await nodeCorpusFs.stat(
        `${root}/data/works/${author.slug}/${input}`,
      );
      return exists === null ? undefined : "That work already exists";
    },
  });
  if (slug === undefined) return undefined;
  const id = await askRequired("Document ID", defaultWorkId(author.slug, slug));
  if (id === undefined) return undefined;
  const title = await askRequired("Title");
  if (title === undefined) return undefined;
  const breadcrumb = await askRequired("Breadcrumb (short title)", title);
  if (breadcrumb === undefined) return undefined;
  const year = await askYear("First edition (a year slug)");
  if (year === undefined) return undefined;
  const published = await askNumber("Publication year", defaultPublished(year));
  if (published === undefined) return undefined;
  return {
    slug,
    id: id.trim(),
    title: title.trim(),
    breadcrumb: breadcrumb.trim(),
    year,
    published: Number(published),
  };
};

/** Gather a new edition's metadata, or undefined if the contributor backs out. */
const editionDetails = async (work: Work): Promise<EditionMeta | undefined> => {
  const year = await ask("Edition (a year slug)", {
    placeHolder: "e.g. 1748, 1742a, 1739-40",
    validateInput: async (input) => {
      const bad = yearSlugError(input);
      if (bad !== undefined) return bad;
      const taken =
        work.editions.some((edition) => edition.slug === input) ||
        (await nodeCorpusFs.stat(`${work.dir}/${input}.mit`)) !== null;
      return taken ? "That edition already exists" : undefined;
    },
  });
  if (year === undefined) return undefined;
  const title = await askRequired("Title", work.title);
  if (title === undefined) return undefined;
  const published = await askNumber("Publication year", defaultPublished(year));
  if (published === undefined) return undefined;
  return { year, title: title.trim(), published: Number(published) };
};

const confirmCanonical = async (year: string): Promise<boolean> =>
  (await vscode.window.showQuickPick(["No", "Yes"], {
    placeHolder: `Make ${year} the canonical edition?`,
  })) === "Yes";

const prompts: ScaffoldPrompts = {
  authorDetails,
  chooseAuthor,
  workDetails,
  editionDetails,
  confirmCanonical,
};

const deps: ScaffoldDeps = {
  fs: nodeCorpusFs,
  open: async (path) => {
    await vscode.window.showTextDocument(vscode.Uri.file(path));
  },
  prompts,
};

export const newAuthor = (model: CorpusModel): Promise<void> =>
  coreNewAuthor(model.root, deps);

export const newWork = (model: CorpusModel, node?: TreeNode): Promise<void> =>
  coreNewWork(model.root, node, model.state?.catalogue.authors ?? [], deps);

export const newEdition = (
  model: CorpusModel,
  node?: TreeNode,
): Promise<void> => {
  if (node?.kind !== "work") return Promise.resolve();
  return coreNewEdition(node.work, deps);
};
