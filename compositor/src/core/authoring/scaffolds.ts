/**
 * The scaffolding flows: New Author, New Work (with its first edition), and
 * New Edition. Each gathers the required metadata, writes the files in the
 * canonical shape (templates.ts), and reveals the result. The vscode-free
 * heart lives here — the flow decisions (which author, which files, whether to
 * make the new edition canonical), the field validators, and the canonical
 * rewrite — written over two ports: the corpus filesystem it writes through,
 * an `open` to reveal a file, and a `ScaffoldPrompts` that gathers each item's
 * metadata.
 *
 * The editor layer (adapters/vscode/commands/scaffolds.ts) implements the
 * prompts as input boxes (wiring in the validators exported here) and provides
 * the fs/open adapters; the corpus watcher picks the new files up, so the tree
 * and diagnostics refresh on their own.
 */

import type { Author, CorpusFsWrite, Work } from "@earlytexts/corpus";
import { YEAR } from "@earlytexts/corpus";
import { capitalize, workDocId } from "../catalogue/nodes.ts";
import type { TreeNode } from "../catalogue/nodes.ts";
import { authorFile, editionFile, stubFile } from "./templates.ts";

/* ------------------------------ validators ------------------------------ */

const SLUG = /^[a-z0-9]+$/;

/** A lowercase file/directory slug (author files, work directories). */
export const slugError = (input: string): string | undefined =>
  SLUG.test(input) ? undefined : "Must be a lowercase slug (a-z, 0-9)";

/** A year slug (1748, 1742a, 1739-40) — an edition's identity. */
export const yearSlugError = (input: string): string | undefined =>
  YEAR.test(input) ? undefined : "Must be a year slug (1748, 1742a, 1739-40)";

/** A plain year (a publication year). */
export const yearError = (input: string): string | undefined =>
  /^\d+$/.test(input.trim()) ? undefined : "Must be a year (number)";

/** A required free-text field. */
export const requiredError = (input: string): string | undefined =>
  input.trim() === "" ? "Required" : undefined;

/* -------------------------------- defaults ------------------------------ */

/** The document ID a new work is seeded with, e.g. hume + ehu → "Hume.EHU". */
export const defaultWorkId = (authorSlug: string, workSlug: string): string =>
  `${capitalize(authorSlug)}.${workSlug.toUpperCase()}`;

/** The publication year a dated edition is seeded with (the slug's leading
 * four digits). */
export const defaultPublished = (yearSlug: string): string =>
  yearSlug.slice(0, 4);

/** Point a work stub's `canonical` at a different edition. */
export const setCanonical = (indexText: string, year: string): string =>
  indexText.replace(/canonical = "[^"]*"/, `canonical = "${year}"`);

/* --------------------------------- ports -------------------------------- */

/** The collected metadata for a new author (already parsed and trimmed). */
export type AuthorMeta = {
  slug: string;
  forename: string;
  surname: string;
  birth: number;
  death: number;
  nationality: string;
  sex: string;
};

/** The collected metadata for a new work and its first edition. */
export type WorkMeta = {
  slug: string;
  id: string;
  title: string;
  breadcrumb: string;
  year: string;
  published: number;
};

/** The collected metadata for a new edition of an existing work. */
export type EditionMeta = { year: string; title: string; published: number };

/** The prompt sequences the scaffolds defer to the editor: gathering each new
 * item's metadata (validated live against `root`/`work`) and the two follow-up
 * choices. Each resolves undefined/false when the contributor dismisses it,
 * abandoning the scaffold. */
export type ScaffoldPrompts = {
  authorDetails: (root: string) => Promise<AuthorMeta | undefined>;
  chooseAuthor: (authors: Author[]) => Promise<Author | undefined>;
  workDetails: (author: Author, root: string) => Promise<WorkMeta | undefined>;
  editionDetails: (work: Work) => Promise<EditionMeta | undefined>;
  confirmCanonical: (year: string) => Promise<boolean>;
};

/** The world the scaffolds reach: the corpus filesystem, a reveal-in-editor, and
 * the prompt sequences. */
export type ScaffoldDeps = {
  fs: CorpusFsWrite;
  open: (path: string) => Promise<void>;
  prompts: ScaffoldPrompts;
};

/* --------------------------------- flows -------------------------------- */

/** New Author: gather the metadata, write `data/authors/<slug>.mit`, open it. */
export const newAuthor = async (
  root: string,
  { fs, open, prompts }: ScaffoldDeps,
): Promise<void> => {
  const meta = await prompts.authorDetails(root);
  if (meta === undefined) return;
  await create(fs, open, {
    path: `${root}/data/authors/${meta.slug}.mit`,
    content: authorFile(meta),
    open: true,
  });
};

/** New Work: fix the author from the invoking node or pick one, gather the
 * metadata, write the work stub (`index.mit`, not opened) and its first edition
 * (opened). */
export const newWork = async (
  root: string,
  node: TreeNode | undefined,
  authors: Author[],
  { fs, open, prompts }: ScaffoldDeps,
): Promise<void> => {
  const author =
    node?.kind === "author" ? node.author : await prompts.chooseAuthor(authors);
  if (author === undefined) return;
  const meta = await prompts.workDetails(author, root);
  if (meta === undefined) return;

  const dir = `${root}/data/works/${author.slug}/${meta.slug}`;
  const shared = {
    title: meta.title,
    breadcrumb: meta.breadcrumb,
    authors: [author.slug],
  };
  await create(fs, open, {
    path: `${dir}/index.mit`,
    content: stubFile({ id: meta.id, ...shared, canonical: meta.year }),
    open: false,
  });
  await create(fs, open, {
    path: `${dir}/${meta.year}.mit`,
    content: editionFile({
      id: `${meta.id}.${meta.year}`,
      ...shared,
      breadcrumb: meta.year,
      published: [meta.published],
    }),
    open: true,
  });
};

/** New Edition: gather the metadata, write and open the dated edition, then
 * offer to make it the work's canonical edition (rewriting the stub if so). */
export const newEdition = async (
  work: Work,
  { fs, open, prompts }: ScaffoldDeps,
): Promise<void> => {
  const meta = await prompts.editionDetails(work);
  if (meta === undefined) return;

  await create(fs, open, {
    path: `${work.dir}/${meta.year}.mit`,
    content: editionFile({
      id: `${workDocId(work)}.${meta.year}`,
      title: meta.title,
      breadcrumb: meta.year,
      authors: work.authorSlugs,
      published: [meta.published],
    }),
    open: true,
  });

  if (!(await prompts.confirmCanonical(meta.year))) return;
  const indexPath = `${work.dir}/index.mit`;
  const text = await fs.readFile(indexPath);
  if (text === null) return;
  await fs.writeFile(indexPath, setCanonical(text, meta.year));
};

/** A file a scaffold writes: its path, contents, and whether to reveal it. */
type ScaffoldFile = { path: string; content: string; open: boolean };

/** Write a scaffold file (creating its parent directory) and, if asked, reveal
 * it in the editor. */
const create = async (
  fs: CorpusFsWrite,
  open: (path: string) => Promise<void>,
  file: ScaffoldFile,
): Promise<void> => {
  await fs.mkdir(file.path.slice(0, file.path.lastIndexOf("/")));
  await fs.writeFile(file.path, file.content);
  if (file.open) await open(file.path);
};
