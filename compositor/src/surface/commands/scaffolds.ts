/**
 * Scaffolding commands: New Author, New Work (with its first edition), and New
 * Edition. Each walks the user through the required metadata, writes files in
 * the canonical shape (src/templates.ts), and opens the result. The corpus
 * watcher picks the new files up, so the tree and diagnostics refresh on
 * their own.
 */

import * as vscode from "vscode";
import type { Author, Work } from "@earlytexts/corpus";
import { nodeCorpusFs, YEAR } from "@earlytexts/corpus";
import type { CorpusModel } from "../../corpusModel.ts";
import type { TreeNode } from "../../lib/nodes.ts";
import { authorFile, editionFile, stubFile } from "../../lib/templates.ts";

const SLUG = /^[a-z0-9]+$/;

const writeAndOpen = async (path: string, content: string): Promise<void> => {
  const uri = vscode.Uri.file(path);
  await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(content));
  await vscode.window.showTextDocument(uri);
};

const ask = (
  prompt: string,
  options: Omit<vscode.InputBoxOptions, "prompt"> = {},
): Thenable<string | undefined> =>
  vscode.window.showInputBox({ prompt, ignoreFocusOut: true, ...options });

const askRequired = (prompt: string, value?: string) =>
  ask(prompt, {
    ...(value === undefined ? {} : { value }),
    validateInput: (input) => (input.trim() === "" ? "Required" : undefined),
  });

const askYear = (prompt: string) =>
  ask(prompt, {
    placeHolder: "e.g. 1748, 1742a, 1739-40",
    validateInput: (input) =>
      YEAR.test(input)
        ? undefined
        : "Must be a year slug (1748, 1742a, 1739-40)",
  });

const askNumber = (prompt: string, value?: string) =>
  ask(prompt, {
    ...(value === undefined ? {} : { value }),
    validateInput: (input) =>
      /^\d+$/.test(input.trim()) ? undefined : "Must be a year (number)",
  });

const capitalize = (slug: string): string =>
  slug.charAt(0).toUpperCase() + slug.slice(1);

/** The work's document ID (e.g. "Hume.EHU"), from any edition's root ID. */
export const workDocId = (work: Work): string => {
  const id = work.editions[0]?.document.id;
  return id !== undefined && id.includes(".")
    ? id.split(".").slice(0, -1).join(".")
    : `${capitalize(work.hostSlug)}.${work.slug.toUpperCase()}`;
};

export const newAuthor = async (model: CorpusModel): Promise<void> => {
  const slug = await ask("Author slug (the file name, e.g. hume)", {
    validateInput: async (input) => {
      if (!SLUG.test(input)) return "Must be a lowercase slug (a-z, 0-9)";
      const exists = await nodeCorpusFs.stat(
        `${model.root}/data/authors/${input}.mit`,
      );
      return exists === null ? undefined : "That author file already exists";
    },
  });
  if (slug === undefined) return;
  const forename = await askRequired("Forename");
  if (forename === undefined) return;
  const surname = await askRequired("Surname");
  if (surname === undefined) return;
  const birth = await askNumber("Year of birth");
  if (birth === undefined) return;
  const death = await askNumber("Year of death");
  if (death === undefined) return;
  const nationality = await askRequired("Nationality (e.g. English, Scottish)");
  if (nationality === undefined) return;
  const sex = await vscode.window.showQuickPick(["Male", "Female"], {
    placeHolder: "Sex",
    ignoreFocusOut: true,
  });
  if (sex === undefined) return;

  await writeAndOpen(
    `${model.root}/data/authors/${slug}.mit`,
    authorFile({
      slug,
      forename: forename.trim(),
      surname: surname.trim(),
      birth: Number(birth),
      death: Number(death),
      nationality: nationality.trim(),
      sex,
    }),
  );
};

const pickAuthor = async (model: CorpusModel): Promise<Author | undefined> => {
  const authors = model.state?.catalogue.authors ?? [];
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

export const newWork = async (
  model: CorpusModel,
  node?: TreeNode,
): Promise<void> => {
  const author =
    node?.kind === "author" ? node.author : await pickAuthor(model);
  if (author === undefined) return;

  const slug = await ask("Work slug (the directory name, e.g. ehu)", {
    validateInput: async (input) => {
      if (!SLUG.test(input)) return "Must be a lowercase slug (a-z, 0-9)";
      const exists = await nodeCorpusFs.stat(
        `${model.root}/data/works/${author.slug}/${input}`,
      );
      return exists === null ? undefined : "That work already exists";
    },
  });
  if (slug === undefined) return;
  const id = await askRequired(
    "Document ID",
    `${capitalize(author.slug)}.${slug.toUpperCase()}`,
  );
  if (id === undefined) return;
  const title = await askRequired("Title");
  if (title === undefined) return;
  const breadcrumb = await askRequired("Breadcrumb (short title)", title);
  if (breadcrumb === undefined) return;
  const year = await askYear("First edition (a year slug)");
  if (year === undefined) return;
  const published = await askNumber("Publication year", year.slice(0, 4));
  if (published === undefined) return;

  const dir = `${model.root}/data/works/${author.slug}/${slug}`;
  const shared = {
    title: title.trim(),
    breadcrumb: breadcrumb.trim(),
    authors: [author.slug],
  };
  await vscode.workspace.fs.writeFile(
    vscode.Uri.file(`${dir}/index.mit`),
    new TextEncoder().encode(
      stubFile({ id: id.trim(), ...shared, canonical: year }),
    ),
  );
  await writeAndOpen(
    `${dir}/${year}.mit`,
    editionFile({
      id: `${id.trim()}.${year}`,
      ...shared,
      breadcrumb: year,
      published: [Number(published)],
    }),
  );
};

export const newEdition = async (
  model: CorpusModel,
  node?: TreeNode,
): Promise<void> => {
  if (node?.kind !== "work") return;
  const { work } = node;

  const year = await ask("Edition (a year slug)", {
    placeHolder: "e.g. 1748, 1742a, 1739-40",
    validateInput: async (input) => {
      if (!YEAR.test(input)) {
        return "Must be a year slug (1748, 1742a, 1739-40)";
      }
      const taken =
        work.editions.some((e) => e.slug === input) ||
        (await nodeCorpusFs.stat(`${work.dir}/${input}.mit`)) !== null;
      return taken ? "That edition already exists" : undefined;
    },
  });
  if (year === undefined) return;
  const title = await askRequired("Title", work.title);
  if (title === undefined) return;
  const published = await askNumber("Publication year", year.slice(0, 4));
  if (published === undefined) return;

  await writeAndOpen(
    `${work.dir}/${year}.mit`,
    editionFile({
      id: `${workDocId(work)}.${year}`,
      title: title.trim(),
      breadcrumb: year,
      authors: work.authorSlugs,
      published: [Number(published)],
    }),
  );

  const canonical = await vscode.window.showQuickPick(["No", "Yes"], {
    placeHolder: `Make ${year} the canonical edition?`,
  });
  if (canonical === "Yes") {
    const stubUri = vscode.Uri.file(`${work.dir}/index.mit`);
    const text = new TextDecoder().decode(
      await vscode.workspace.fs.readFile(stubUri),
    );
    await vscode.workspace.fs.writeFile(
      stubUri,
      new TextEncoder().encode(
        text.replace(/canonical = "[^"]*"/, `canonical = "${year}"`),
      ),
    );
  }
};
