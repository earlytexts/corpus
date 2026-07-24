/**
 * The build's per-source derivations, persisted beside the catalogue as
 * `catalogue/derivations.json` (see COMPOSITOR_MEMORY_PLAN.md). Where
 * `catalogue/documents/` holds each edition's positioned-stripped body for the
 * computer, this file holds each *source* `.mit`'s register-independent
 * reductions — its `derived` (derive.ts), its `FileProjection` and its per-file
 * violations (rules.ts) — so the Compositor can paint the tree, rebuild its
 * indexes, and validate the corpus at cold start with no compiles, holding no
 * positioned documents resident.
 *
 * The computer ignores this file; it is a Compositor convenience the build
 * emits and the Compositor's write-back keeps fresh. Each record carries the
 * source's byte size and a content hash so a background sweep can tell, without
 * reading, which sources changed out-of-session (a `git checkout`, an external
 * edit) and recompile only those. A schema-version + corpus-root stamp lets the
 * Compositor discard a mismatched or foreign file and fall back to a compile.
 *
 * Keyed by `data/`-relative source path (1305 sources), not edition doc key
 * (886 editions): derivations are per source file, and a composed edition's
 * children are separate section sources.
 */

import type { MarkitDocument } from "@earlytexts/markit";
import { normalizePath } from "../fs/paths.ts";
import type { CorpusFs, CorpusFsWrite } from "../fs/ports.ts";
import type {
  FileDerivations,
  MarkedToken,
  SurfaceSummary,
} from "../validation/derive.ts";
import {
  type CorpusFile,
  type FileProjection,
  projectFile,
  validateFile,
  type Violation,
} from "../validation/rules.ts";

/** Bump when the on-disk shape changes; the Compositor discards on mismatch. */
export const DERIVATIONS_VERSION = 3;

/** One source's resident derivation: everything the doc-free tiers and the
 * indexes need, its structure skeleton, plus the freshness stamp. `derived`'s
 * Map/Set are held live. */
export type DerivationRecord = {
  /** Source byte length (a cheap first freshness check before the hash). */
  size: number;
  /** Content hash of the source (freshness, robust to mtime preservation). */
  hash: number;
  derived: FileDerivations;
  projection: FileProjection;
  /** The source's per-file (file-only tier) violations — register-independent,
   * so they survive a dictionary edit and are recomputed only when it changes. */
  violations: Violation[];
  /** The document with every block emptied at every level — its id, metadata,
   * and (inline/borrowed) children only. `buildCatalogue` reads exactly these,
   * so feeding the skeletons as its `precompiled` documents rebuilds the whole
   * catalogue structure (composition, metadata, warnings) with no compile — the
   * Compositor's body-free tree, cold and after a save (see corpusModel). */
  skeleton: MarkitDocument;
};

/** Empty every block at every level of a document, keeping the id, metadata,
 * and children `buildCatalogue` reads — the structure skeleton. */
export const skeletonOf = (doc: MarkitDocument): MarkitDocument => ({
  id: doc.id,
  ...(doc.metadata !== undefined ? { metadata: doc.metadata } : {}),
  blocks: [],
  children: doc.children.map(skeletonOf),
});

/** The parsed `derivations.json`: the stamp plus the records by source path. */
export type Derivations = {
  version: number;
  /** The real-path'd corpus root the build ran against (portability guard). */
  root: string;
  records: Map<string, DerivationRecord>;
};

/** The serialised shape of one record (Map/Set flattened to arrays; the
 * skeleton is already JSON — empty blocks, plain metadata/children). */
type SerializedRecord = {
  size: number;
  hash: number;
  formatted: boolean;
  marked: MarkedToken[];
  surfaces: [string, SurfaceSummary][];
  exemptSurfaces: string[];
  projection: FileProjection;
  violations: Violation[];
  skeleton: MarkitDocument;
};

type SerializedDerivations = {
  version: number;
  root: string;
  records: Record<string, SerializedRecord>;
};

/** A fast, deterministic content hash (FNV-1a, 32-bit): runtime-neutral and
 * synchronous, so both the Deno build and the Node Compositor produce the same
 * value. Collisions are astronomically unlikely for our purposes, and the
 * manual rebuild command is the backstop if one ever bit. */
export const hashText = (text: string): number => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
};

/** Reduce a compiled file to its persistable record: its derivations (already
 * computed on the compile), its projection, and its per-file violations. */
export const derivationRecord = async (
  file: CorpusFile,
  ctx: { fs: CorpusFs; root: string },
): Promise<DerivationRecord> => ({
  size: file.text.length,
  hash: hashText(file.text),
  derived: file.derived,
  projection: projectFile(file),
  violations: await validateFile(file, ctx),
  skeleton: skeletonOf(file.doc),
});

/** Serialise the records to `derivations.json` text, stamped with the version
 * and (real-path'd) root. */
export const serializeDerivations = (
  records: Iterable<readonly [string, DerivationRecord]>,
  root: string,
): string => {
  const out: Record<string, SerializedRecord> = {};
  for (const [path, record] of records) {
    out[path] = {
      size: record.size,
      hash: record.hash,
      formatted: record.derived.formatted,
      marked: record.derived.marked,
      surfaces: [...record.derived.surfaces],
      exemptSurfaces: [...record.derived.exemptSurfaces],
      projection: record.projection,
      violations: record.violations,
      skeleton: record.skeleton,
    };
  }
  return JSON.stringify(
    { version: DERIVATIONS_VERSION, root, records: out },
  );
};

/** Parse `derivations.json` text back into records, rebuilding `derived`'s
 * Map/Set. Returns null on invalid JSON or a version mismatch (the caller then
 * falls back to a full compile). */
export const deserializeDerivations = (json: string): Derivations | null => {
  let parsed: SerializedDerivations;
  try {
    parsed = JSON.parse(json) as SerializedDerivations;
  } catch {
    return null;
  }
  if (
    parsed === null || typeof parsed !== "object" ||
    parsed.version !== DERIVATIONS_VERSION ||
    typeof parsed.root !== "string" ||
    typeof parsed.records !== "object" || parsed.records === null
  ) {
    return null;
  }
  const records = new Map<string, DerivationRecord>();
  for (const [path, s] of Object.entries(parsed.records)) {
    records.set(path, {
      size: s.size,
      hash: s.hash,
      derived: {
        formatted: s.formatted,
        marked: s.marked,
        surfaces: new Map(s.surfaces),
        exemptSurfaces: new Set(s.exemptSurfaces),
      },
      projection: s.projection,
      violations: s.violations,
      skeleton: s.skeleton,
    });
  }
  return { version: parsed.version, root: parsed.root, records };
};

/** Write `catalogue/derivations.json`. The catalogue directory must already
 * exist (writeCatalogue creates it), so this only writes the one file — the
 * incremental write-back rewrites it whole from the resident records, which are
 * a few MB (far less than the documents), so a full rewrite per save is cheap. */
export const writeDerivations = async (
  fs: CorpusFsWrite,
  root: string,
  records: Iterable<readonly [string, DerivationRecord]>,
): Promise<void> => {
  const real = await fs.realPath(root);
  await fs.writeFile(
    `${real}/catalogue/derivations.json`,
    serializeDerivations(records, real),
  );
};

/** Read `catalogue/derivations.json`, or null when it is absent, invalid, or
 * built by a different schema version. */
export const readDerivations = async (
  fs: CorpusFs,
  corpusDir: string,
): Promise<Derivations | null> => {
  const text = await fs.readFile(`${corpusDir}/catalogue/derivations.json`);
  return text === null ? null : deserializeDerivations(text);
};

/** The records' skeletons keyed the way `buildCatalogue` looks documents up
 * (normalised absolute source path), so `buildCatalogue(fs, root, this)` rebuilds
 * the catalogue structure from the skeletons with no compile. */
export const precompiledSkeletons = (
  records: Map<string, DerivationRecord>,
  root: string,
): Map<string, MarkitDocument> => {
  const map = new Map<string, MarkitDocument>();
  for (const [path, record] of records) {
    map.set(normalizePath(`${root}/data/${path}`), record.skeleton);
  }
  return map;
};
