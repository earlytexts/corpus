/**
 * Scaffold templates for new corpus files. Pure string builders, each run
 * through the Markit formatter so what the scaffolds write is exactly what the
 * corpus's format rule expects (see corpus data/ for real examples of these
 * shapes, and corpus/tests/harness.ts for the same contract in test form).
 */

import { format } from "@jsr/earlytexts__markit";

type Scalar = string | number | boolean;

const tomlValue = (value: Scalar | Scalar[]): string =>
  Array.isArray(value)
    ? `[${value.map(tomlValue).join(", ")}]`
    : typeof value === "string"
      ? JSON.stringify(value)
      : String(value);

const document = (
  heading: string,
  meta: Record<string, Scalar | Scalar[]>,
): string =>
  format(
    `# ${heading}\n\n[metadata]\n` +
      Object.entries(meta)
        .map(([key, value]) => `${key} = ${tomlValue(value)}`)
        .join("\n") +
      "\n",
  );

export type AuthorInput = {
  slug: string;
  forename: string;
  surname: string;
  birth: number;
  death: number;
  nationality: string;
  sex: string;
};

/** data/authors/<slug>.mit — author metadata, no text. */
export const authorFile = (input: AuthorInput): string =>
  document(input.slug.charAt(0).toUpperCase() + input.slug.slice(1), {
    forename: input.forename,
    surname: input.surname,
    birth: input.birth,
    death: input.death,
    nationality: input.nationality,
    sex: input.sex,
  });

export type StubInput = {
  /** The work's document ID, e.g. "Hume.EHU". */
  id: string;
  title: string;
  breadcrumb: string;
  authors: string[];
  canonical: string;
};

/** data/works/<host>/<work>/index.mit — the work's edition-independent identity. */
export const stubFile = (input: StubInput): string =>
  document(input.id, {
    title: input.title,
    breadcrumb: input.breadcrumb,
    authors: input.authors,
    canonical: input.canonical,
  });

export type EditionInput = {
  /** The edition's document ID, e.g. "Hume.EHU.1748". */
  id: string;
  title: string;
  breadcrumb: string;
  authors: string[];
  published: number[];
};

/** data/works/<host>/<work>/<year>.mit — a dated edition, text to be added. */
export const editionFile = (input: EditionInput): string =>
  document(input.id, {
    // The scaffold has no text yet; flip to true once the text is in place.
    imported: false,
    title: input.title,
    breadcrumb: input.breadcrumb,
    authors: input.authors,
    published: input.published,
  });
