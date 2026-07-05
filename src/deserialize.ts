/**
 * Load the compiled `catalogue/` output back into the in-memory `Catalogue` — the
 * inverse of serialize.ts, kept beside it so the wire format is owned in one
 * place, both directions. The computer builds its artefacts from this; the
 * Compositor uses it as a startup cache while the real compile runs.
 *
 * Documents are read via the `CatalogueReader` port (`catalogueReader` supplies the
 * CorpusFs-backed implementation; the computer's io adapter and the tests
 * bring their own). Composition splices each `{ __ref }` child as the single
 * shared parsed instance of the edition it names, recreating the object graph
 * (shared edition documents, shared blocks) that buildCatalogue produces.
 */

import type { MarkitDocument } from "@earlytexts/markit";
import type {
  Author,
  Catalogue,
  CatalogueFile,
  CorpusFs,
  DocRefNode,
  Edition,
  SerializedDoc,
  Work,
} from "./types.ts";

/**
 * The reader the load needs: the compiled catalogue, and each edition's
 * document by key. Both return null when absent (a corpus that was never
 * built).
 */
export interface CatalogueReader {
  readCatalogue(corpusDir: string): Promise<CatalogueFile | null>;
  readDocument(
    corpusDir: string,
    docKey: string,
  ): Promise<SerializedDoc | null>;
}

/**
 * Load the compiled catalogue into the in-memory `Catalogue`. Reads every
 * edition's document, then composes each lazily — splicing a borrowed child as
 * the single shared instance of the edition it names, so a text borrowed into
 * several collections is one object. (No cycles — the corpus build drops them.)
 * `sources` come back relative to the corpus root, as serialised.
 */
export const loadCatalogue = async (
  reader: CatalogueReader,
  corpusDir: string,
): Promise<{ catalogue: Catalogue; warnings: string[] }> => {
  const file = await reader.readCatalogue(corpusDir);
  if (file === null) {
    throw new Error(
      `no compiled catalogue at ${corpusDir}/catalogue; run the corpus build`,
    );
  }

  // Read every edition's raw (uncomposed) document up front, keyed by docKey.
  // The corpus build writes one document per edition, so each read must hit.
  const raw = new Map<string, SerializedDoc>();
  for (const work of Object.values(file.works)) {
    for (const edition of work.editions) {
      const doc = await reader.readDocument(corpusDir, edition.docKey);
      if (doc === null) {
        throw new Error(
          `missing document ${edition.docKey} in ${corpusDir}/catalogue; ` +
            `re-run the corpus build`,
        );
      }
      raw.set(edition.docKey, doc);
    }
  }

  // Compose a document by reference: each `{ __ref }` child becomes the shared
  // composed instance of that edition. Memoised, so every borrow of an edition
  // resolves to one object.
  const composed = new Map<string, MarkitDocument>();
  const build = (node: SerializedDoc): MarkitDocument =>
    ({
      id: node.id,
      ...(node.metadata !== undefined ? { metadata: node.metadata } : {}),
      blocks: node.blocks,
      children: node.children.map((child) =>
        isRef(child) ? compose(child.__ref) : build(child),
      ),
    }) as MarkitDocument;
  const compose = (docKey: string): MarkitDocument => {
    const cached = composed.get(docKey);
    if (cached !== undefined) return cached;
    const doc = build(raw.get(docKey)!);
    composed.set(docKey, doc);
    return doc;
  };

  const sources = new WeakMap<MarkitDocument, string>();
  const byAuthor = new Map<string, Author>();

  // Rebuild each work once (shared across the authors that list it), then point
  // every author at its works by key — recreating the co-authored sharing. Each
  // entity is its serialised metadata base spread back, plus the live pieces.
  const works = new Map<string, Work>();
  for (const [key, w] of Object.entries(file.works)) {
    const { editions, ...workMeta } = w;
    works.set(key, {
      ...workMeta,
      editions: editions.map((e): Edition => {
        const { docKey, source, ...editionMeta } = e;
        const document = compose(docKey);
        sources.set(document, source);
        return { ...editionMeta, document };
      }),
    });
  }

  const authors = file.authors.map((a): Author => {
    const { works: workKeys, ...authorMeta } = a;
    const author: Author = {
      ...authorMeta,
      works: workKeys.map((key) => works.get(key)!),
    };
    byAuthor.set(a.slug, author);
    return author;
  });

  return {
    catalogue: { authors, byAuthor, sources },
    warnings: file.warnings,
  };
};

/** A `CatalogueReader` over the `catalogue/` files, for CorpusFs-backed callers. */
export const catalogueReader = (fs: CorpusFs): CatalogueReader => {
  const readJson = async <T>(path: string): Promise<T | null> => {
    const text = await fs.readFile(path);
    return text === null ? null : (JSON.parse(text) as T);
  };
  return {
    readCatalogue: (corpusDir) =>
      readJson<CatalogueFile>(`${corpusDir}/catalogue/catalogue.json`),
    readDocument: (corpusDir, docKey) =>
      readJson<SerializedDoc>(
        `${corpusDir}/catalogue/documents/${docKey}.json`,
      ),
  };
};

const isRef = (node: SerializedDoc | DocRefNode): node is DocRefNode =>
  "__ref" in node;
