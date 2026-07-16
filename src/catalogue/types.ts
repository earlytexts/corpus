/**
 * The catalogue's types. The corpus is the single source of truth for the shape
 * of the catalogue and the corpus metadata; the computer imports these types
 * (via `@earlytexts/corpus/wire`) rather than mirroring them.
 *
 * Two layers live here, sharing one set of metadata bases so they cannot
 * drift apart:
 *  - the in-memory `Catalogue` (with live `MarkitDocument`s) that
 *    `buildCatalogue` produces and `loadCatalogue` reconstructs; and
 *  - the serialised contract (`CatalogueFile`, `DocRefNode`) written to the
 *    gitignored `catalogue/` directory that the computer reads.
 *
 * Each entity is its shared `…Meta` base plus the one field that differs
 * between the layers: a live document/object graph in memory, a key or
 * reference on the wire. The filesystem ports these run on live in ../ports.ts.
 */

import type { MarkitDocument } from "@earlytexts/markit";
import type { Dictionary } from "../dictionary/types.ts";

/* --------------------------- the catalogue ---------------------------- */

/** The in-memory catalogue: what `buildCatalogue` produces and
 * `loadCatalogue` reconstructs from `catalogue/`. */
export type Catalogue = {
  authors: Author[]; // ascending by year of first publication
  byAuthor: Map<string, Author>;
  /** Source `.mit` path for every loaded edition: absolute when built from
   * source (buildCatalogue), relative to the corpus root when loaded from the
   * compiled `catalogue/` (loadCatalogue). */
  sources: WeakMap<MarkitDocument, string>;
  /** The curated register of surface forms (see dictionary.ts). Serialised
   * expanded — every spelling and lemma explicit — as its own file,
   * `catalogue/dictionary.json`, keeping `catalogue.json` lean; empty when
   * loading a catalogue compiled before the dictionary existed. */
  dictionary: Dictionary;
};

/**
 * The whole catalogue, serialised to `catalogue/catalogue.json`. Works are listed
 * once and referenced by key from each author, so a co-authored work keeps a
 * single identity across the authors that list it.
 */
export type CatalogueFile = {
  authors: CatalogueAuthor[];
  works: Record<string, CatalogueWork>;
  warnings: string[];
};

/* ------------------------------- authors ------------------------------ */

/** Author metadata, shared by the in-memory and serialised forms. */
export type AuthorMeta = {
  slug: string;
  forename: string;
  surname: string;
  title?: string; // honorific, e.g. "Lord Kames"
  birth?: number;
  death?: number;
  /** Earliest `firstPublished` across the author's works (derived); undefined
   * if they have none. Authors are ordered by it. */
  firstPublished?: number;
  nationality?: string;
  sex?: string;
};

/** An author in memory: their metadata plus their live works. */
export type Author = AuthorMeta & {
  works: Work[]; // ascending by first publication year
};

/** A serialised author: their metadata plus work keys into `CatalogueFile.works`. */
export type CatalogueAuthor = AuthorMeta & {
  /** Work keys (`<hostSlug>/<work>`), in order; resolved against `works`. */
  works: string[];
};

/* -------------------------------- works ------------------------------- */

/** Work metadata, shared by the in-memory and serialised forms. */
export type WorkMeta = {
  /**
   * Author slugs, in title order — the people who wrote it. The work is
   * registered under every slug here, so it lists on each author's page (see
   * buildCatalogue). For its identity/URL, see `hostSlug`.
   */
  authorSlugs: string[];
  /**
   * Identity slug: the directory the work lives in, used for its id, docKey, and
   * URL. For a single-author work this equals authorSlugs[0]; for a co-authored
   * work it is the joint slug (e.g. "astell-norris"), which is not itself an
   * author.
   */
  hostSlug: string;
  slug: string;
  title: string;
  breadcrumb: string;
  imported: boolean;
  /** Earliest publication year across all editions (derived, not stored). */
  firstPublished: number;
  canonicalSlug: string; // slug of the canonical (default) edition
  /**
   * Whether the work appears as its own text in UI indexes. A work borrowed
   * into a collection (its editions spliced in as borrowed children) is also a
   * standalone directory, so it lists independently by default. Setting
   * `standalone = false` on the work's `index.mit` keeps it out of the indexes,
   * leaving it reachable only through the collection(s) that borrow it.
   */
  standalone: boolean;
  /** Directory owning this work's files: absolute when built from source,
   * relative to the corpus root when serialised (and so when loaded back). */
  dir: string;
};

/** A work in memory: its metadata plus its live, dated editions. */
export type Work = WorkMeta & {
  editions: Edition[]; // dated editions, ascending by year
};

/** A serialised work: its metadata plus its serialised editions. */
export type CatalogueWork = WorkMeta & {
  editions: CatalogueEdition[];
};

/* ------------------------------ editions ------------------------------ */

/** Edition metadata, shared by the in-memory and serialised forms. */
export type EditionMeta = {
  /** Author slugs, in title order; [0] is the host (the directory it lives in). */
  authorSlugs: string[];
  workSlug: string;
  slug: string; // a year slug, e.g. "1757", "1742a"
  title: string;
  breadcrumb: string;
  imported: boolean;
  published: number[];
  sourceUrl?: string;
  sourceDesc?: string;
};

/** An edition in memory: its metadata plus its live Markit document. */
export type Edition = EditionMeta & {
  document: MarkitDocument;
};

/** A serialised edition: its metadata plus pointers to its document file. */
export type CatalogueEdition = EditionMeta & {
  /** Document file key, under `catalogue/documents/<docKey>.json`. */
  docKey: string;
  /** Source `.mit` path, relative to the corpus root (for ownership checks). */
  source: string;
};

/* --------------------------- documents on disk ------------------------ */

/**
 * A serialised document node: a Markit document whose borrowed children are
 * `DocRefNode` placeholders. Written by serialize.ts (one file per edition,
 * under `catalogue/documents/<docKey>.json`), read back by deserialize.ts.
 */
export type SerializedDoc = {
  id: string;
  metadata?: MarkitDocument["metadata"];
  blocks: MarkitDocument["blocks"];
  children: (SerializedDoc | DocRefNode)[];
};

/**
 * A borrowed child in a serialised document: a placeholder naming another
 * edition's document file by its key. The computer splices the (shared) parsed
 * instance back in at this point, recreating the composed tree.
 */
export type DocRefNode = { __ref: string };
