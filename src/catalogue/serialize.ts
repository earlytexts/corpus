/**
 * Serialise the in-memory catalogue (built by buildCatalogue) into the compiled
 * output the computer consumes: a `catalogue.json` describing the structure and
 * metadata, plus one document file per edition under `documents/`.
 *
 * The documents are kept *uncomposed* — a borrowed child becomes a `{ __ref }`
 * placeholder naming the edition's document key, not an inlined copy. This lets
 * the computer splice the single shared parsed instance back in when it loads,
 * recreating the object graph (shared edition documents, shared blocks) that the
 * build relies on. Source positions are stripped on the way out (the compositor
 * builds its catalogue from position-compiled documents — see corpusModel), so
 * the written catalogue is identical however the documents were compiled.
 *
 * Each entity's serialised form is its shared metadata base (see types.ts)
 * spread verbatim, plus the layer-specific fields — so a new metadata key
 * flows through here with no code change.
 */

import { type MarkitDocument, stripPositions } from "@earlytexts/markit";
import type {
  Catalogue,
  CatalogueAuthor,
  CatalogueEdition,
  CatalogueFile,
  CatalogueWork,
  Edition,
  SerializedDoc,
  Work,
} from "./types.ts";

/**
 * Serialise a catalogue. `root` is the real-path'd corpus directory used to make
 * the `dir`/`source` paths relative (so they are portable across machines).
 * Returns the catalogue.json payload, a map of document key → JSON text, and
 * the dictionary.json text — the dictionary already lives expanded in memory
 * (explicit spelling + lemma per word per reading), so its wire form is a
 * plain stringify and consumers never parse the entry micro-syntax.
 * `emitDocuments` selects which document JSONs to serialise (their keys always
 * serialise into the structure regardless): `true` (the default) all of them;
 * `false` none — the dictionary-only write path, where the documents on disk
 * are already current and stringifying them is the bulk of the cost; a
 * predicate only those docKeys it accepts — the incremental per-source path
 * (writeCatalogueSources), where a handful changed and the rest stay current.
 */
export const serializeCatalogue = (
  catalogue: Catalogue,
  warnings: string[],
  root: string,
  emitDocuments: boolean | ((docKey: string) => boolean) = true,
): {
  catalogue: CatalogueFile;
  documents: Map<string, string>;
  dictionary: string;
} => {
  const includeDocument = typeof emitDocuments === "function"
    ? emitDocuments
    : () => emitDocuments;
  // Map every edition document to its key, so a borrowed child (which is another
  // edition's document instance) serialises as a ref rather than an inlined copy.
  const docKeys = new WeakMap<MarkitDocument, string>();
  const docKeyedWorks = new Set<Work>();
  for (const author of catalogue.authors) {
    for (const work of author.works) {
      if (docKeyedWorks.has(work)) continue;
      docKeyedWorks.add(work);
      for (const edition of work.editions) {
        docKeys.set(edition.document, docKeyOf(work, edition));
      }
    }
  }

  const documents = new Map<string, string>();
  const serializeEdition = (work: Work, edition: Edition): CatalogueEdition => {
    const { document, ...meta } = edition;
    const docKey = docKeyOf(work, edition);
    if (includeDocument(docKey)) {
      documents.set(docKey, JSON.stringify(serializeDoc(document, docKeys)));
    }
    return {
      ...meta,
      docKey,
      source: relative(catalogue.sources.get(document) ?? "", root),
    };
  };

  const works: Record<string, CatalogueWork> = {};
  const serializedWorks = new Set<Work>();
  for (const author of catalogue.authors) {
    for (const work of author.works) {
      if (serializedWorks.has(work)) continue;
      serializedWorks.add(work);
      const { editions, ...meta } = work;
      works[`${work.hostSlug}/${work.slug}`] = {
        ...meta,
        dir: relative(work.dir, root),
        editions: editions.map((edition) => serializeEdition(work, edition)),
      };
    }
  }

  const authors: CatalogueAuthor[] = catalogue.authors.map((author) => {
    const { works: authorWorks, ...meta } = author;
    return {
      ...meta,
      works: authorWorks.map((work) => `${work.hostSlug}/${work.slug}`),
    };
  });

  return {
    catalogue: { authors, works, warnings },
    documents,
    dictionary: JSON.stringify(catalogue.dictionary),
  };
};

/** The document key (and `documents/<docKey>.json` path) for an edition. */
export const docKeyOf = (work: Work, edition: Edition): string =>
  `${work.hostSlug}/${work.slug}/${edition.slug}`;

/**
 * Map each edition's serialised source path (relative to `root`, the form the
 * catalogue's `source` fields carry) to its document key — the inverse the
 * incremental write needs to turn a set of changed `.mit` files into the
 * documents to re-emit. Each work is visited once (a co-authored work lists
 * under each author).
 */
export const sourceDocKeys = (
  catalogue: Catalogue,
  root: string,
): Map<string, string> => {
  const map = new Map<string, string>();
  const seen = new Set<Work>();
  for (const author of catalogue.authors) {
    for (const work of author.works) {
      if (seen.has(work)) continue;
      seen.add(work);
      for (const edition of work.editions) {
        map.set(
          relative(catalogue.sources.get(edition.document) ?? "", root),
          docKeyOf(work, edition),
        );
      }
    }
  }
  return map;
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
  blocks: doc.blocks.map(stripPositions),
  children: doc.children.map((child) => {
    const key = docKeys.get(child);
    return key !== undefined ? { __ref: key } : serializeDoc(child, docKeys);
  }),
});

/** A path made relative to the (real-path'd) corpus root. */
const relative = (absolute: string, root: string): string =>
  absolute.startsWith(`${root}/`) ? absolute.slice(root.length + 1) : absolute;
