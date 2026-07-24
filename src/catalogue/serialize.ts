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
  DocRefNode,
  Edition,
  SerializedDoc,
  Work,
} from "./types.ts";
import type { CorpusFs } from "../fs/ports.ts";
import { borrowedRef, resolveEdition } from "../fs/paths.ts";

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
 * Serialise a **standalone** compiled document — one edition's own file, with
 * its borrowed children still `## <ref>` placeholders (as `compileWithPositions`
 * leaves them), never the composed `{ __ref }` form — into the same
 * `SerializedDoc` shape `serializeCatalogue` produces. This is the incremental
 * write-back's door: the Compositor holds a body-free catalogue (every edition's
 * `document` is a stub), so on a save it re-serialises just the touched
 * edition(s) from their freshly recompiled standalone bodies rather than off the
 * stub catalogue.
 *
 * Where `serializeDoc` reads the docKey off the *resolved child instance*
 * (`docKeys.get(child)`), here there is no resolved instance — the child is a
 * placeholder naming another edition by id. Each placeholder's `borrowedRef` is
 * resolved to the file it names (exactly as the build's composition does, via
 * `resolveEdition`), and that file's docKey looked up in `bySource`
 * (`sourceDocKeys`). A placeholder whose file cannot be resolved is **dropped**,
 * matching the build (which drops an unresolvable borrowed child with a
 * warning); inline children recurse, and blocks are position-stripped — so the
 * output is byte-identical to `serializeCatalogue`'s document for the same
 * source on any well-formed corpus (guarded by a round-trip test).
 */
export const serializeSourceDoc = (
  fs: CorpusFs,
  root: string,
  bySource: ReadonlyMap<string, string>,
  doc: MarkitDocument,
): Promise<SerializedDoc> => {
  const worksDir = `${root}/data/works`;
  const refDocKey = async (ref: string): Promise<string | undefined> => {
    const file = await resolveEdition(fs, worksDir, ref);
    return file === undefined ? undefined : bySource.get(relative(file, root));
  };
  const walk = async (node: MarkitDocument): Promise<SerializedDoc> => {
    const children: (SerializedDoc | DocRefNode)[] = [];
    for (const child of node.children) {
      const ref = borrowedRef(child.id);
      if (ref === undefined) {
        children.push(await walk(child)); // an ordinary inline section
        continue;
      }
      const docKey = await refDocKey(ref);
      if (docKey !== undefined) children.push({ __ref: docKey });
      // else drop, exactly as the build drops an unresolvable borrowed child.
    }
    return {
      id: node.id,
      ...(node.metadata !== undefined ? { metadata: node.metadata } : {}),
      blocks: node.blocks.map(stripPositions),
      children,
    };
  };
  return walk(doc);
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
