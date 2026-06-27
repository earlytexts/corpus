/**
 * The catalogue's types. The corpus is the single source of truth for the shape
 * of the catalogue and the corpus metadata; the computer consumes the compiled
 * output (see serialize.ts) and mirrors only the wire types it needs.
 *
 * Two layers live here:
 *  - the in-memory `Catalog` (with live `MarkitDocument`s) that `buildCatalog`
 *    produces, used by the build task before it serialises; and
 *  - the serialised contract (`CatalogueFile`, `DocRefNode`) written to the
 *    gitignored `dist/` directory that the computer reads.
 */

import type { MarkitDocument } from "@earlytexts/markit";

/**
 * The filesystem capability the catalog scan needs. The corpus file set is
 * discovered by parsing (children references, case-insensitive lookups), so the
 * I/O cannot be hoisted ahead of the walk — it is injected as this port instead.
 * `readFile` and `stat` return null when the path is absent; `readDir` throws
 * (as Deno.readDir does) so a missing corpus directory surfaces.
 */
export interface CorpusFs {
  readFile(path: string): Promise<string | null>;
  readDir(path: string): Promise<Deno.DirEntry[]>;
  realPath(path: string): Promise<string>;
  stat(path: string): Promise<{ isFile: boolean } | null>;
}

/* ------------------------- in-memory catalogue ------------------------ */

export type Author = {
  slug: string;
  forename: string;
  surname: string;
  title?: string; // honorific, e.g. "Lord Kames"
  birth?: number;
  death?: number;
  published?: number; // year of first publication; used for ordering
  nationality?: string;
  sex?: string;
  works: Work[]; // ascending by first publication year
};

export type Edition = {
  /** Author slugs, in title order; [0] is the host (the directory it lives in). */
  authorSlugs: string[];
  workSlug: string;
  slug: string; // a year slug, e.g. "1757", "1742a"
  title: string;
  breadcrumb: string;
  imported: boolean;
  published: number[];
  copytext: string[];
  sourceUrl?: string;
  sourceDesc?: string;
  document: MarkitDocument;
};

export type Work = {
  /**
   * Author slugs, in title order. [0] is the host — the directory the work
   * lives in and the primary author used for the artefact path and identity.
   * A co-authored work is registered under every slug here (see buildCatalog).
   */
  authorSlugs: string[];
  slug: string;
  title: string;
  breadcrumb: string;
  imported: boolean;
  published: number[];
  canonicalSlug: string; // slug of the canonical (default) edition
  /**
   * Whether the work appears as its own text in UI indexes. A work borrowed
   * into a collection (its editions spliced in as borrowed children) is also a
   * standalone directory, so it lists independently by default. Setting
   * `standalone = false` on the work's `index.mit` keeps it out of the indexes,
   * leaving it reachable only through the collection(s) that borrow it.
   */
  standalone: boolean;
  dir: string; // directory owning this work's files (relative to the corpus root)
  editions: Edition[]; // dated editions, ascending by year
};

export type Catalog = {
  authors: Author[]; // ascending by year of first publication
  byAuthor: Map<string, Author>;
  /** Source file path (relative to the corpus root) for every loaded edition. */
  sources: WeakMap<MarkitDocument, string>;
};

/* --------------------------- serialised form -------------------------- */

/**
 * A borrowed child in a serialised document: a placeholder naming another
 * edition's document file by its key. The computer splices the (shared) parsed
 * instance back in at this point, recreating the composed tree.
 */
export type DocRefNode = { __ref: string };

/** A serialised edition: its metadata plus pointers to its document file. */
export type CatalogueEdition = {
  authorSlugs: string[];
  workSlug: string;
  slug: string;
  title: string;
  breadcrumb: string;
  imported: boolean;
  published: number[];
  copytext: string[];
  sourceUrl?: string;
  sourceDesc?: string;
  /** Document file key, under `dist/documents/<docKey>.json`. */
  docKey: string;
  /** Source `.mit` path, relative to the corpus root (for ownership checks). */
  source: string;
};

export type CatalogueWork = {
  authorSlugs: string[];
  slug: string;
  title: string;
  breadcrumb: string;
  imported: boolean;
  published: number[];
  canonicalSlug: string;
  standalone: boolean;
  dir: string; // relative to the corpus root
  editions: CatalogueEdition[];
};

export type CatalogueAuthor = {
  slug: string;
  forename: string;
  surname: string;
  title?: string;
  birth?: number;
  death?: number;
  published?: number;
  nationality?: string;
  sex?: string;
  /** Work keys (`<hostAuthor>/<work>`), in order; resolved against `works`. */
  works: string[];
};

/**
 * The whole catalogue, serialised to `dist/catalogue.json`. Works are listed
 * once and referenced by key from each author, so a co-authored work keeps a
 * single identity across the authors that list it.
 */
export type CatalogueFile = {
  authors: CatalogueAuthor[];
  works: Record<string, CatalogueWork>;
  warnings: string[];
};
