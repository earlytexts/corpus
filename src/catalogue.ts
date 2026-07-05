/**
 * The catalogue scans the corpus, compiles every Markit file, and organises the
 * results into authors, works, and editions. This is the corpus's
 * responsibility: the computer consumes the compiled output (serialize.ts), it
 * does not scan or compile the corpus itself.
 *
 * Corpus layout (see ../README.md):
 *  - `data/authors/<author>.mit` holds an author's metadata (no text).
 *  - `data/works/<author>/<work>/` is a work. Its `index.mit` is a metadata-only
 *    stub: the work's edition-independent identity (title, breadcrumb) plus a
 *    `canonical` key naming the default edition. The texts
 *    are year-named editions — sibling entries whose names look like years
 *    (`1757.mit`, `1742a.mit`, or directories `1758/index.mit`).
 *  - A document's children are its inline `##` sections, in file order. A
 *    section whose id is wrapped in angle brackets — e.g. `## <Hume.EHU.1750>`
 *    — is a borrowed child: a placeholder naming another edition by id, which
 *    is loaded recursively and spliced in at that point. Inline and borrowed
 *    children mix freely, letting composite works (collections like ETSS, FD,
 *    HE) interleave their own sections with text shared from other works.
 *  - Cascading metadata (imported, published, sourceUrl, sourceDesc) flows
 *    down the composed tree: a section without the key takes the nearest
 *    ancestor's value.
 *
 * Reads top-down: `buildCatalogue` is the entry point, and each helper
 * appears below its caller.
 */

import { compile, type MarkitDocument } from "@earlytexts/markit";
import type {
  Author,
  Catalogue,
  CorpusFs,
  DirEntry,
  Edition,
  Work,
} from "./types.ts";
import {
  borrowedRef,
  normalizePath,
  resolveEdition,
  resolveFile,
  resolveVariant,
  YEAR,
} from "./paths.ts";

export const buildCatalogue = async (
  fs: CorpusFs,
  corpusDir: string,
  /** Already-compiled documents keyed by normalised absolute path (see
   * LoadContext.precompiled); misses simply compile from disk. */
  precompiled?: ReadonlyMap<string, MarkitDocument>,
): Promise<{ catalogue: Catalogue; warnings: string[] }> => {
  // Canonicalise so that work directories and child-reference paths agree.
  corpusDir = await fs.realPath(corpusDir);
  const dataDir = `${corpusDir}/data`;
  const ctx: LoadContext = {
    fs,
    cache: new Map(),
    stack: new Set(),
    sources: new WeakMap(),
    warnings: [],
    worksDir: `${dataDir}/works`,
    precompiled,
  };
  const byAuthor = new Map<string, Author>();

  try {
    for (const entry of await fs.readDir(`${dataDir}/authors`)) {
      if (!entry.isFile || !entry.name.endsWith(".mit")) continue;
      const slug = entry.name.slice(0, -4).toLowerCase();
      const doc = await loadDocument(`${dataDir}/authors/${entry.name}`, ctx);
      byAuthor.set(slug, makeAuthor(slug, doc));
    }
  } catch {
    ctx.warnings.push(`no authors directory in ${dataDir}`);
  }

  // Load every work under its host directory. A host directory names either one
  // author (the usual case) or, when its slug is joined with `-`, several — the
  // joint host is not itself an author.
  const loaded: Work[] = [];
  for (const entry of await fs.readDir(`${dataDir}/works`)) {
    if (!entry.isDirectory) continue;
    const hostSlug = entry.name.toLowerCase();
    const hostDir = `${dataDir}/works/${entry.name}`;
    for (const sub of await fs.readDir(hostDir)) {
      const work = await loadWork(hostSlug, sub, hostDir, ctx);
      if (work !== undefined) loaded.push(work);
    }
  }

  // Register every work under each of its authors, so a co-authored work lives
  // once on disk (under its joint host) but lists on every author's page. All
  // the authors share the one work object (and so its single hostSlug identity).
  for (const work of loaded) {
    for (const slug of work.authorSlugs) {
      let author = byAuthor.get(slug);
      if (author === undefined) {
        ctx.warnings.push(
          `data/works/${work.hostSlug}/${work.slug} has no data/authors/${slug}.mit`,
        );
        author = makeAuthor(slug, null);
        byAuthor.set(slug, author);
      }
      if (!author.works.includes(work)) author.works.push(work);
    }
  }

  for (const author of byAuthor.values()) {
    author.works.sort((a, b) =>
      a.firstPublished - b.firstPublished ||
      a.slug.localeCompare(b.slug)
    );
    // An author's first-publication year is derived: the earliest across their
    // works (left unset when they have none).
    if (author.works.length > 0) {
      author.firstPublished = Math.min(
        ...author.works.map((w) => w.firstPublished),
      );
    }
  }

  const authors = [...byAuthor.values()].sort((a, b) =>
    (a.firstPublished ?? Infinity) - (b.firstPublished ?? Infinity) ||
    a.surname.localeCompare(b.surname)
  );

  return {
    catalogue: { authors, byAuthor, sources: ctx.sources },
    warnings: ctx.warnings,
  };
};

/**
 * Load one work. Every work is a directory `<author>/<work>/` whose
 * `index.mit` is a metadata-only stub (work identity + a `canonical` pointer);
 * the texts live in year-named editions (`1757.mit` or `1758/index.mit`). The
 * stub is never an edition — only year slugs are.
 */
const loadWork = async (
  hostSlug: string,
  entry: DirEntry,
  hostDir: string,
  ctx: LoadContext,
): Promise<Work | undefined> => {
  if (!entry.isDirectory) return undefined;
  const dir = `${hostDir}/${entry.name}`;
  const indexPath = await resolveFile(ctx.fs, `${dir}/index.mit`);
  if (indexPath === undefined) return undefined; // not a work
  const slug = entry.name.toLowerCase();
  const stub = await loadDocument(indexPath, ctx);
  if (stub === null) return undefined;

  // The work's authors (the people who wrote it), from the stub's `authors`. A
  // joint host directory ("astell-norris") is not itself an author: its declared
  // authors are authoritative, falling back to the directory's `-`-joined parts.
  // A single-author host directory names the author, listed first.
  const declaredAuthors = metaAuthors(stub) ?? [];
  const authorSlugs = hostSlug.includes("-")
    ? (declaredAuthors.length > 0 ? declaredAuthors : hostSlug.split("-"))
    : [hostSlug, ...declaredAuthors.filter((s) => s !== hostSlug)];

  const editionSlugs: string[] = [];
  for (const sub of await ctx.fs.readDir(dir)) {
    const name = sub.isFile && sub.name.endsWith(".mit")
      ? sub.name.slice(0, -4)
      : sub.isDirectory
      ? sub.name
      : undefined;
    if (name !== undefined && YEAR.test(name)) {
      editionSlugs.push(name);
    }
  }
  editionSlugs.sort();
  const editions: Edition[] = [];
  for (const editionSlug of editionSlugs) {
    const file = await resolveVariant(ctx.fs, `${dir}/${editionSlug}`);
    const doc = file === undefined ? null : await loadDocument(file, ctx);
    if (doc !== null) {
      editions.push(makeEdition(authorSlugs, slug, editionSlug, doc));
    }
  }
  if (editions.length === 0) {
    ctx.warnings.push(`data/works/${hostSlug}/${slug}: no editions`);
    return undefined;
  }

  // Canonical edition: the stub's `canonical` key, else the latest edition.
  const declared = metaString(stub, "canonical")?.toLowerCase();
  const canonical = editions.find((e) => e.slug === declared) ??
    editions[editions.length - 1];
  if (declared !== undefined && canonical.slug !== declared) {
    ctx.warnings.push(
      `data/works/${hostSlug}/${slug}: canonical "${declared}" is not an edition`,
    );
  }

  const title = metaString(stub, "title") ?? stub.id;
  // A work's first-publication year is derived, not stored: the earliest year
  // across all its editions (stub editions for pre-corpus printings included).
  const firstPublished = Math.min(...editions.flatMap((e) => e.published));
  return {
    authorSlugs,
    hostSlug,
    slug,
    title,
    breadcrumb: metaString(stub, "breadcrumb") ?? title,
    imported: canonical.imported,
    firstPublished,
    canonicalSlug: canonical.slug,
    // Works list independently unless the stub opts out (collection-only subworks).
    standalone: metaBoolean(stub, "standalone") ?? true,
    dir,
    editions,
  };
};

const makeEdition = (
  workAuthorSlugs: string[],
  workSlug: string,
  slug: string,
  document: MarkitDocument,
): Edition => {
  const sourceUrl = metaString(document, "sourceUrl");
  const sourceDesc = metaString(document, "sourceDesc");
  return {
    // An edition usually inherits the work's authors; it may name its own with
    // an `authors` key (e.g. a co-authored edition's root lists both).
    authorSlugs: metaAuthors(document) ?? workAuthorSlugs,
    workSlug,
    slug,
    title: metaString(document, "title") ?? document.id,
    breadcrumb: metaString(document, "breadcrumb") ??
      metaString(document, "title") ?? document.id,
    // Texts are assumed present unless the corpus says otherwise; only files
    // with broken metadata lack the key entirely.
    imported: metaBoolean(document, "imported") ?? true,
    published: metaArray(document, "published").map(Number).filter((n) =>
      !Number.isNaN(n)
    ),
    // Optional keys are set only when present, so an edition spreads into its
    // serialised form without undefined-valued properties.
    ...(sourceUrl !== undefined ? { sourceUrl } : {}),
    ...(sourceDesc !== undefined ? { sourceDesc } : {}),
    document,
  };
};

const makeAuthor = (slug: string, doc: MarkitDocument | null): Author => {
  const title = doc === null ? undefined : metaString(doc, "title");
  const birth = doc === null ? undefined : metaNumber(doc, "birth");
  const death = doc === null ? undefined : metaNumber(doc, "death");
  const nationality = doc === null ? undefined : metaString(doc, "nationality");
  const sex = doc === null ? undefined : metaString(doc, "sex");
  return {
    slug,
    forename: doc === null ? "" : metaString(doc, "forename") ?? "",
    surname: doc === null ? slug : metaString(doc, "surname") ?? slug,
    // As in makeEdition: no undefined-valued properties, so authors spread
    // cleanly into their serialised form.
    ...(title !== undefined ? { title } : {}),
    ...(birth !== undefined ? { birth } : {}),
    ...(death !== undefined ? { death } : {}),
    ...(nationality !== undefined ? { nationality } : {}),
    ...(sex !== undefined ? { sex } : {}),
    works: [],
  };
};

/* ---------------------------- document loading ------------------------- */

type LoadContext = {
  fs: CorpusFs;
  cache: Map<string, MarkitDocument | null>;
  stack: Set<string>;
  sources: WeakMap<MarkitDocument, string>;
  warnings: string[];
  /** Absolute path of the corpus's `data/works`, where borrowed children live. */
  worksDir: string;
  /** Already-compiled (uncomposed) documents, keyed by normalised absolute
   * path. A hit skips reading and compiling the file — the expensive part of a
   * build — so a caller that has just compiled the corpus for validation can
   * hand its documents over instead of paying for a second compile. */
  precompiled?: ReadonlyMap<string, MarkitDocument> | undefined;
};

/**
 * Load and compile a Markit file, recursively resolving `children` metadata.
 * Returns null (and records a warning) if the file cannot be read.
 */
const loadDocument = async (
  path: string,
  ctx: LoadContext,
): Promise<MarkitDocument | null> => {
  const key = normalizePath(path);
  const cached = ctx.cache.get(key);
  if (cached !== undefined) return cached;
  if (ctx.stack.has(key)) {
    ctx.warnings.push(`circular child reference involving ${key}`);
    return null;
  }
  let doc = ctx.precompiled?.get(key);
  if (doc === undefined) {
    const text = await ctx.fs.readFile(key);
    if (text === null) {
      ctx.cache.set(key, null);
      return null;
    }
    [doc] = compile(text);
  }
  ctx.stack.add(key);
  const composed = await resolveChildren(doc, key, ctx);
  ctx.stack.delete(key);
  ctx.sources.set(composed, key);
  ctx.cache.set(key, composed);
  return composed;
};

/**
 * Compose a document: a copy of `doc` with borrowed children spliced in. A
 * section whose id is wrapped in angle brackets — `## <Hume.EHU.1750>` compiles
 * to an id ending in `<Hume.EHU.1750>` — is a placeholder for another edition:
 * it is replaced by that edition's recursively-loaded document. Ordinary inline
 * sections are kept, so the two kinds keep their file order. Unresolvable
 * borrowed references are dropped with a warning. The input document is not
 * mutated, so a precompiled document survives the build untouched and can be
 * reused by later builds.
 */
const resolveChildren = async (
  doc: MarkitDocument,
  path: string,
  ctx: LoadContext,
): Promise<MarkitDocument> => {
  const resolved: MarkitDocument[] = [];
  for (const child of doc.children) {
    const ref = borrowedRef(child.id);
    if (ref === undefined) {
      resolved.push(child); // an ordinary inline section
      continue;
    }
    const file = await resolveEdition(ctx.fs, ctx.worksDir, ref);
    const borrowed = file === undefined ? null : await loadDocument(file, ctx);
    if (borrowed !== null) {
      resolved.push(borrowed);
    } else {
      ctx.warnings.push(`unresolved child "${ref}" in ${path}`);
    }
  }
  // The spread keeps Markit's symbol-keyed ranges (own enumerable symbols).
  return { ...doc, children: resolved };
};

/* ---------------------------- metadata readers ------------------------- */

const metaString = (doc: MarkitDocument, key: string): string | undefined => {
  const value = doc.metadata?.[key];
  return typeof value === "string" ? value : undefined;
};

const metaNumber = (doc: MarkitDocument, key: string): number | undefined => {
  const value = doc.metadata?.[key];
  return typeof value === "number" ? value : undefined;
};

const metaBoolean = (doc: MarkitDocument, key: string): boolean | undefined => {
  const value = doc.metadata?.[key];
  return typeof value === "boolean" ? value : undefined;
};

const metaArray = (doc: MarkitDocument, key: string): (string | number)[] => {
  const value = doc.metadata?.[key];
  if (Array.isArray(value)) return value as (string | number)[];
  if (typeof value === "string" || typeof value === "number") return [value];
  return [];
};

/**
 * The author slugs a text declares with the cascading `authors` key (lowercased),
 * or undefined when it sets none — so a caller can fall back to the inherited
 * value. A bare string is treated as a one-element list.
 */
const metaAuthors = (doc: MarkitDocument): string[] | undefined => {
  const value = doc.metadata?.authors;
  if (Array.isArray(value)) {
    return value.map((s) => String(s).toLowerCase());
  }
  if (typeof value === "string") return [value.toLowerCase()];
  return undefined;
};
