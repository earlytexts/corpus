/**
 * The pure core of "replace in scope": from the active edition, work out which
 * source files a whole-word replacement should touch, and the labelled scopes
 * to offer (this work, or every work by its author(s)). No VSCode — the command
 * (surface/commands/replaceInScope.ts) gathers the word and applies the edits;
 * everything about *which files* is decided here, and tested.
 */

import type { Catalogue, Edition, Work } from "@earlytexts/corpus";
import { normalizePath } from "@earlytexts/corpus";
import { distinctWorks } from "./catalogueWalk.ts";
import { editionPath } from "./nodes.ts";

/** A replacement scope: a human label, a one-line description, and the edition
 * source files it covers. Shaped to double as a vscode.QuickPickItem. */
export type ReplaceScope = {
  label: string;
  description: string;
  files: string[];
};

/** The work (and edition) whose source file is `filePath`, if any. */
export const findEdition = (
  catalogue: Catalogue,
  filePath: string,
): { work: Work; edition: Edition } | undefined => {
  const target = normalizePath(filePath);
  for (const author of catalogue.authors) {
    for (const work of author.works) {
      for (const edition of work.editions) {
        if (editionPath(catalogue, edition) === target) {
          return { work, edition };
        }
      }
    }
  }
  return undefined;
};

/** The scopes to offer for replacing across `edition`'s work: always "this
 * work", plus "this author" when the author reaches beyond this single work. */
export const replaceScopes = (
  catalogue: Catalogue,
  work: Work,
  edition: Edition,
): ReplaceScope[] => {
  const authorWorks = worksByAuthors(catalogue, edition.authorSlugs);
  const workFiles = editionFiles(catalogue, [work]);
  const authorFiles = editionFiles(catalogue, authorWorks);
  const scopes: ReplaceScope[] = [
    {
      label: "This work",
      description: `${work.breadcrumb} · ${plural(workFiles.length, "edition")}`,
      files: workFiles,
    },
  ];
  if (authorFiles.length > workFiles.length) {
    scopes.push({
      label: "This author",
      description: `${authorNames(catalogue, edition.authorSlugs)} · ${plural(
        authorWorks.length,
        "work",
      )}, ${plural(authorFiles.length, "edition")}`,
      files: authorFiles,
    });
  }
  return scopes;
};

/** Every work by any of `slugs`, each once, in author order. */
const worksByAuthors = (catalogue: Catalogue, slugs: string[]): Work[] =>
  distinctWorks(
    slugs
      .map((slug) => catalogue.byAuthor.get(slug))
      .filter((author) => author !== undefined),
  );

/** The edition source files of `works`, deduplicated, in a stable order. */
const editionFiles = (catalogue: Catalogue, works: Work[]): string[] => {
  const paths = new Set<string>();
  for (const work of works) {
    for (const edition of work.editions) {
      const path = editionPath(catalogue, edition);
      if (path !== undefined) paths.add(path);
    }
  }
  return [...paths];
};

export const plural = (n: number, noun: string): string =>
  `${n} ${noun}${n === 1 ? "" : "s"}`;

/** "David Hume", or "Astell & Norris" for a co-authored work. */
const authorNames = (catalogue: Catalogue, slugs: string[]): string =>
  slugs
    .map((slug) => {
      const author = catalogue.byAuthor.get(slug);
      return author === undefined
        ? slug
        : `${author.forename} ${author.surname}`.trim();
    })
    .join(" & ");
