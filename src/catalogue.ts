/**
 * The catalog scans the corpus, compiles every Markit file, and organises the
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
 */

import { compile, type MarkitDocument } from "@earlytexts/markit";
import type { Author, Catalog, CorpusFs, Edition, Work } from "./types.ts";
import {
  borrowedRef,
  normalizePath,
  resolveEdition,
  resolveFile,
  resolveVariant,
  YEAR,
} from "./paths.ts";

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

type LoadContext = {
  fs: CorpusFs;
  cache: Map<string, MarkitDocument | null>;
  stack: Set<string>;
  sources: WeakMap<MarkitDocument, string>;
  warnings: string[];
  /** Absolute path of the corpus's `data/works`, where borrowed children live. */
  worksDir: string;
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
  const text = await ctx.fs.readFile(key);
  if (text === null) {
    ctx.cache.set(key, null);
    return null;
  }
  ctx.stack.add(key);
  const [doc] = compile(text);
  ctx.sources.set(doc, key);
  await resolveChildren(doc, key, ctx);
  ctx.stack.delete(key);
  ctx.cache.set(key, doc);
  return doc;
};

/**
 * Splice borrowed children into doc.children. A section whose id is wrapped in
 * angle brackets — `## <Hume.EHU.1750>` compiles to an id ending in
 * `<Hume.EHU.1750>` — is a placeholder for another edition: it is replaced, in
 * place, by that edition's recursively-loaded document. Ordinary inline sections
 * are left untouched, so the two kinds keep their file order. Unresolvable
 * borrowed references are dropped with a warning.
 */
const resolveChildren = async (
  doc: MarkitDocument,
  path: string,
  ctx: LoadContext,
): Promise<void> => {
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
  doc.children = resolved;
};

const makeEdition = (
  workAuthorSlugs: string[],
  workSlug: string,
  slug: string,
  document: MarkitDocument,
): Edition => ({
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
  sourceUrl: metaString(document, "sourceUrl"),
  sourceDesc: metaString(document, "sourceDesc"),
  document,
});

/**
 * Load one work. Every work is a directory `<author>/<work>/` whose
 * `index.mit` is a metadata-only stub (work identity + a `canonical` pointer);
 * the texts live in year-named editions (`1757.mit` or `1758/index.mit`). The
 * stub is never an edition — only year slugs are.
 */
const loadWork = async (
  hostSlug: string,
  entry: Deno.DirEntry,
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

const makeAuthor = (slug: string, doc: MarkitDocument | null): Author => ({
  slug,
  forename: doc === null ? "" : metaString(doc, "forename") ?? "",
  surname: doc === null ? slug : metaString(doc, "surname") ?? slug,
  title: doc === null ? undefined : metaString(doc, "title"),
  birth: doc === null ? undefined : metaNumber(doc, "birth"),
  death: doc === null ? undefined : metaNumber(doc, "death"),
  nationality: doc === null ? undefined : metaString(doc, "nationality"),
  sex: doc === null ? undefined : metaString(doc, "sex"),
  works: [],
});

export const buildCatalog = async (
  fs: CorpusFs,
  corpusDir: string,
): Promise<{ catalog: Catalog; warnings: string[] }> => {
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
    // works (undefined when they have none).
    author.firstPublished = author.works.length > 0
      ? Math.min(...author.works.map((w) => w.firstPublished))
      : undefined;
  }

  const authors = [...byAuthor.values()].sort((a, b) =>
    (a.firstPublished ?? Infinity) - (b.firstPublished ?? Infinity) ||
    a.surname.localeCompare(b.surname)
  );

  return {
    catalog: { authors, byAuthor, sources: ctx.sources },
    warnings: ctx.warnings,
  };
};
