/**
 * Serialise the in-memory catalogue (built by buildCatalog) into the compiled
 * output the computer consumes: a `catalogue.json` describing the structure and
 * metadata, plus one document file per edition under `documents/`.
 *
 * The documents are kept *uncomposed* — a borrowed child becomes a `{ __ref }`
 * placeholder naming the edition's document key, not an inlined copy. This lets
 * the computer splice the single shared parsed instance back in when it loads,
 * recreating the object graph (shared edition documents, shared blocks) that the
 * build relies on. Markit's symbol-keyed source ranges are dropped by
 * JSON.stringify, exactly as they already are when the computer writes blocks.
 */

import type { MarkitDocument } from "@earlytexts/markit";
import type {
  Catalog,
  CatalogueAuthor,
  CatalogueEdition,
  CatalogueFile,
  CatalogueWork,
  DocRefNode,
  Edition,
  Work,
} from "./types.ts";

/** The document key (and `documents/<docKey>.json` path) for an edition. */
export const docKeyOf = (work: Work, edition: Edition): string =>
  `${work.authorSlugs[0]}/${work.slug}/${edition.slug}`;

/** A path made relative to the (real-path'd) corpus root. */
const relative = (absolute: string, root: string): string =>
  absolute.startsWith(`${root}/`) ? absolute.slice(root.length + 1) : absolute;

/** A serialised document node: a Markit document with refs for borrowed kids. */
type SerializedDoc = {
  id: string;
  metadata?: MarkitDocument["metadata"];
  blocks: MarkitDocument["blocks"];
  children: (SerializedDoc | DocRefNode)[];
};

/**
 * Convert a (composed) document to its serialised form, replacing every child
 * that is itself a borrowed edition with a `{ __ref }` placeholder so the shared
 * instance is written once (in its own file) and spliced back on load.
 */
const serializeDoc = (
  doc: MarkitDocument,
  docKeys: WeakMap<MarkitDocument, string>,
): SerializedDoc => ({
  id: doc.id,
  ...(doc.metadata !== undefined ? { metadata: doc.metadata } : {}),
  blocks: doc.blocks,
  children: doc.children.map((child) => {
    const key = docKeys.get(child);
    return key !== undefined ? { __ref: key } : serializeDoc(child, docKeys);
  }),
});

/**
 * Serialise a catalogue. `root` is the real-path'd corpus directory used to make
 * the `dir`/`source` paths relative (so they are portable across machines).
 * Returns the catalogue.json payload and a map of document key → JSON text.
 */
export const serializeCatalogue = (
  catalog: Catalog,
  warnings: string[],
  root: string,
): { catalogue: CatalogueFile; documents: Map<string, string> } => {
  // Map every edition document to its key, so a borrowed child (which is another
  // edition's document instance) serialises as a ref rather than an inlined copy.
  const docKeys = new WeakMap<MarkitDocument, string>();
  const seenWorks = new Set<Work>();
  for (const author of catalog.authors) {
    for (const work of author.works) {
      if (seenWorks.has(work)) continue;
      seenWorks.add(work);
      for (const edition of work.editions) {
        docKeys.set(edition.document, docKeyOf(work, edition));
      }
    }
  }

  const documents = new Map<string, string>();
  const works: Record<string, CatalogueWork> = {};
  const serializeEdition = (work: Work, edition: Edition): CatalogueEdition => {
    const docKey = docKeyOf(work, edition);
    documents.set(
      docKey,
      JSON.stringify(serializeDoc(edition.document, docKeys)),
    );
    return {
      authorSlugs: edition.authorSlugs,
      workSlug: edition.workSlug,
      slug: edition.slug,
      title: edition.title,
      breadcrumb: edition.breadcrumb,
      imported: edition.imported,
      published: edition.published,
      copytext: edition.copytext,
      ...(edition.sourceUrl !== undefined
        ? { sourceUrl: edition.sourceUrl }
        : {}),
      ...(edition.sourceDesc !== undefined
        ? { sourceDesc: edition.sourceDesc }
        : {}),
      docKey,
      source: relative(catalog.sources.get(edition.document) ?? "", root),
    };
  };

  seenWorks.clear();
  for (const author of catalog.authors) {
    for (const work of author.works) {
      const key = `${work.authorSlugs[0]}/${work.slug}`;
      if (seenWorks.has(work)) continue;
      seenWorks.add(work);
      works[key] = {
        authorSlugs: work.authorSlugs,
        slug: work.slug,
        title: work.title,
        breadcrumb: work.breadcrumb,
        imported: work.imported,
        published: work.published,
        canonicalSlug: work.canonicalSlug,
        standalone: work.standalone,
        dir: relative(work.dir, root),
        editions: work.editions.map((edition) =>
          serializeEdition(work, edition)
        ),
      };
    }
  }

  const authors: CatalogueAuthor[] = catalog.authors.map((author) => ({
    slug: author.slug,
    forename: author.forename,
    surname: author.surname,
    ...(author.title !== undefined ? { title: author.title } : {}),
    ...(author.birth !== undefined ? { birth: author.birth } : {}),
    ...(author.death !== undefined ? { death: author.death } : {}),
    ...(author.published !== undefined ? { published: author.published } : {}),
    ...(author.nationality !== undefined
      ? { nationality: author.nationality }
      : {}),
    ...(author.sex !== undefined ? { sex: author.sex } : {}),
    works: author.works.map((work) => `${work.authorSlugs[0]}/${work.slug}`),
  }));

  return { catalogue: { authors, works, warnings }, documents };
};
