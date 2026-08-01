/**
 * The cross-file validation tier held as an **index** rather than re-run as a
 * sweep. It is the only tier that touches the filesystem, and it does so
 * heavily: a recursive walk of every directory under `data/works` and
 * `data/authors`, plus a resolution probe (a stat, sometimes two, per name
 * variant) for every work stub's canonical and every borrowed-child reference.
 * Over the real corpus that is thousands of syscalls, and re-running it whole
 * for a one-file change is what made a structural save feel slow.
 *
 * The corpus has exactly two cross-file dependency edges, and the index keeps a
 * reverse map for each:
 *
 *  - **borrowed children** — `## <Author.Work.Edition>` in a host file names an
 *    edition elsewhere. Only the *existence* of that edition matters, so a host
 *    is rechecked when a file appears or disappears under the name it borrows,
 *    never when the borrowed file's contents change.
 *  - **author slugs** — every work's declared authors must name an
 *    `authors/<slug>.mit`. A work is rechecked when the slug set moves, or when
 *    the work itself does.
 *
 * Two further edges run through the filesystem rather than through another
 * file's projection: a stub's canonical resolves against its own directory (so
 * a create or delete in that directory rechecks that stub), and the layout walk
 * reads the directory tree and the known slugs (so it re-walks only when one of
 * those moves — never for a metadata edit).
 *
 * Everything else is per-path and cached, so `update` returns the whole tier's
 * violations while re-deriving only the files the change could have reached.
 * `reset` is the from-scratch path, and the equivalence between "any sequence of
 * updates" and "a reset over the same projections" is the property the tests
 * pin down — the index is worth nothing if it can drift from the sweep.
 */

import type { CorpusFs } from "../fs/ports.ts";
import {
  expectedId,
  resolveEdition,
  resolveVariant,
  YEAR,
} from "../fs/paths.ts";
import type { FileProjection, RuleViolation, Violation } from "./rules.ts";

export type CrossFileIndex = {
  /** Replace these files' projections (`undefined` drops a deleted file) and
   * return the tier's violations over the whole corpus. */
  update: (
    changes: ReadonlyMap<string, FileProjection | undefined>,
  ) => Promise<Violation[]>;
  /** Rebuild from scratch over the given projections. */
  reset: (projections: readonly FileProjection[]) => Promise<Violation[]>;
};

/** The rule names the tier's violations are stamped with — the same names the
 * flat rule list uses, so the two recompose to the same set. */
const STUB_RULE = "work stubs name a canonical edition that exists";
const AUTHOR_RULE = "every authors slug names a known author";
const BORROWED_RULE = "borrowed-child references resolve to an edition";
const LAYOUT_RULE = "layout: lowercase names, index.mit in every directory";

export const createCrossFileIndex = (
  ctx: { fs: CorpusFs; root: string },
): CrossFileIndex => {
  const { fs, root } = ctx;
  const projections = new Map<string, FileProjection>();
  /** Per-path results, so an untouched file costs nothing to report again. */
  const stubs = new Map<string, RuleViolation[]>();
  const authors = new Map<string, RuleViolation[]>();
  const borrowed = new Map<string, RuleViolation[]>();
  /** lower-cased `Author.Work.Edition` → the hosts that borrow it. */
  const hostsByRef = new Map<string, Set<string>>();
  /** author slug → the work files declaring it. */
  const filesBySlug = new Map<string, Set<string>>();
  /** author slug → the `authors/*.mit` files defining it. */
  const owners = new Map<string, Set<string>>();
  /** stub directory → the stub files checked against it. */
  const stubsByDir = new Map<string, Set<string>>();
  let layout: RuleViolation[] = [];

  const indexed = (path: string, projection: FileProjection): void => {
    for (const { ref } of projection.borrowedRefs) {
      add(hostsByRef, ref.toLowerCase(), path);
    }
    for (const { slug } of projection.declaredAuthors) {
      add(filesBySlug, slug, path);
    }
    if (projection.authorSlug !== undefined) {
      add(owners, projection.authorSlug, path);
    }
    if (projection.stub !== undefined) {
      add(stubsByDir, projection.stub.dir, path);
    }
  };

  const unindexed = (path: string, projection: FileProjection): void => {
    for (const { ref } of projection.borrowedRefs) {
      drop(hostsByRef, ref.toLowerCase(), path);
    }
    for (const { slug } of projection.declaredAuthors) {
      drop(filesBySlug, slug, path);
    }
    if (projection.authorSlug !== undefined) {
      drop(owners, projection.authorSlug, path);
    }
    if (projection.stub !== undefined) {
      drop(stubsByDir, projection.stub.dir, path);
    }
  };

  /** Re-derive one file's stub, author, and borrowed violations. */
  const recheck = async (path: string): Promise<void> => {
    const projection = projections.get(path);
    if (projection === undefined) {
      stubs.delete(path);
      authors.delete(path);
      borrowed.delete(path);
      return;
    }
    stubs.set(path, await stubViolations(projection, fs, root));
    authors.set(path, authorViolations(projection, owners));
    borrowed.set(path, await borrowedViolations(projection, fs, root));
  };

  const collect = (): Violation[] => [
    ...stamp(STUB_RULE, ordered(projections, stubs)),
    ...stamp(AUTHOR_RULE, ordered(projections, authors)),
    ...stamp(BORROWED_RULE, ordered(projections, borrowed)),
    ...stamp(LAYOUT_RULE, layout),
  ];

  return {
    reset: async (list) => {
      projections.clear();
      stubs.clear();
      authors.clear();
      borrowed.clear();
      hostsByRef.clear();
      filesBySlug.clear();
      owners.clear();
      stubsByDir.clear();
      for (const projection of list) {
        projections.set(projection.path, projection);
        indexed(projection.path, projection);
      }
      for (const path of projections.keys()) await recheck(path);
      layout = await layoutViolations(fs, root, new Set(owners.keys()));
      return collect();
    },

    update: async (changes) => {
      const slugsBefore = new Set(owners.keys());
      // A file appearing or disappearing is what the filesystem-resolving rules
      // (stub canonicals, borrowed refs, the layout walk) are sensitive to; a
      // metadata edit is not.
      let fileSetChanged = false;
      const touched = new Set<string>();

      for (const [path, next] of changes) {
        const before = projections.get(path);
        if (before !== undefined) unindexed(path, before);
        if (next === undefined) {
          projections.delete(path);
          fileSetChanged ||= before !== undefined;
        } else {
          projections.set(path, next);
          indexed(path, next);
          fileSetChanged ||= before === undefined;
        }
        touched.add(path);

        // A created or deleted edition changes what a borrowing host resolves
        // to, and what its own directory's stub resolves to.
        if (before === undefined || next === undefined) {
          for (
            const host of hostsByRef.get(expectedId(path).toLowerCase()) ?? []
          ) {
            touched.add(host);
          }
          for (const dir of stubDirsAbove(path)) {
            for (const stub of stubsByDir.get(dir) ?? []) touched.add(stub);
          }
        }
        // A stub whose canonical moved must resolve the new one.
        if (before?.stub !== undefined && next?.stub === undefined) {
          for (const stub of stubsByDir.get(before.stub.dir) ?? []) {
            touched.add(stub);
          }
        }
      }

      // The known author slugs are global: if the set moved, every file that
      // declares one of the affected slugs is rechecked, and so is the layout
      // walk (its joint-host rule reads the same set).
      const slugsAfter = new Set(owners.keys());
      const slugsChanged = !sameSet(slugsBefore, slugsAfter);
      if (slugsChanged) {
        for (const slug of symmetricDifference(slugsBefore, slugsAfter)) {
          for (const file of filesBySlug.get(slug) ?? []) touched.add(file);
        }
      }

      for (const path of touched) await recheck(path);
      if (fileSetChanged || slugsChanged) {
        layout = await layoutViolations(fs, root, slugsAfter);
      }
      return collect();
    },
  };
};

/* ------------------------------ the rules ------------------------------ */

/** A stub holds metadata only, and its `canonical` must name an edition that
 * exists in its directory. */
export const stubViolations = async (
  p: FileProjection,
  fs: CorpusFs,
  root: string,
): Promise<RuleViolation[]> => {
  if (!p.clean || p.stub === undefined) return [];
  const violations: RuleViolation[] = [];
  const { canonical, dir, line, hasBody, bodyLine } = p.stub;
  if (hasBody) {
    violations.push({
      path: p.path,
      message: "a stub holds metadata only (no text/sections)",
      line: bodyLine,
    });
  }
  if (canonical === undefined) return violations; // schema rule reports the type
  const resolves = await resolveVariant(fs, `${root}/data/${dir}/${canonical}`);
  if (resolves === undefined) {
    violations.push({
      path: p.path,
      message: `canonical "${canonical}" has no edition in ${dir}`,
      line,
    });
  }
  return violations;
};

/** Author slug → the `authors/*.mit` files defining it — the "known authors"
 * every declared slug is checked against. */
export const slugOwners = (
  projections: readonly FileProjection[],
): Map<string, Set<string>> => {
  const owners = new Map<string, Set<string>>();
  for (const p of projections) {
    if (p.authorSlug !== undefined) add(owners, p.authorSlug, p.path);
  }
  return owners;
};

/** Every declared author slug must have an `authors/<slug>.mit`. */
export const authorViolations = (
  p: FileProjection,
  slugOwners: ReadonlyMap<string, Set<string>>,
): RuleViolation[] => {
  if (!p.clean || !p.path.startsWith("works/")) return [];
  return p.declaredAuthors
    .filter(({ slug }) => !slugOwners.has(slug))
    .map(({ slug, locus, line }) => ({
      path: p.path,
      locus,
      message: `unknown author "${slug}"`,
      line,
    }));
};

/** Every `<Author.Work.Edition>` must name a file under `works/`. */
export const borrowedViolations = async (
  p: FileProjection,
  fs: CorpusFs,
  root: string,
): Promise<RuleViolation[]> => {
  if (!p.clean || !p.path.startsWith("works/")) return [];
  const violations: RuleViolation[] = [];
  for (const { ref, textId, line } of p.borrowedRefs) {
    if ((await resolveEdition(fs, `${root}/data/works`, ref)) === undefined) {
      violations.push({
        path: p.path,
        locus: `(${textId})`,
        message: `unresolvable borrowed child "${ref}"`,
        line,
      });
    }
  }
  return violations;
};

/** The directory-tree conventions (see ../README.md). Reads the tree and the
 * known author slugs, and nothing else — so a metadata edit never re-walks. */
export const layoutViolations = async (
  fs: CorpusFs,
  root: string,
  known: Set<string>,
): Promise<RuleViolation[]> => {
  const violations: RuleViolation[] = [];
  // `depth` counts directory levels below works/: the works root itself is
  // WORKS_ROOT, a host (author, possibly joint) sits one deeper, a WORK one
  // deeper still, and a dated edition one deeper again.
  const WORKS_ROOT = 0, WORK = 2;
  const walkDirs = async (dir: string, depth: number): Promise<void> => {
    const names = new Set<string>();
    for (const entry of await fs.readDir(`${root}/data/${dir}`)) {
      names.add(entry.name);
      const stem = entry.name.replace(/\.mit$/, "");
      // A host directory (directly under works/) may be a joint slug —
      // author slugs joined with `-`, each of which must name a known
      // author. Everything deeper is a single lowercase slug.
      if (depth === WORKS_ROOT && entry.isDirectory && stem.includes("-")) {
        for (const part of stem.split("-")) {
          if (!/^[a-z0-9]+$/.test(part)) {
            violations.push({
              path: `${dir}/${entry.name}`,
              message: "name should be a lowercase slug",
            });
          } else if (!known.has(part)) {
            violations.push({
              path: `${dir}/${entry.name}`,
              message: `joint host names unknown author "${part}"`,
            });
          }
        }
      } else if (!YEAR.test(stem) && !/^[a-z0-9]+$/.test(stem)) {
        violations.push({
          path: `${dir}/${entry.name}`,
          message: "name should be a lowercase slug",
        });
      }
      if (entry.isDirectory) {
        await walkDirs(`${dir}/${entry.name}`, depth + 1);
      }
    }
    // works/<author>/ holds works; every deeper directory is a work or a
    // dated edition and must have a reading text / index.
    if (depth >= WORK && !names.has("index.mit")) {
      violations.push({ path: dir, message: "missing index.mit" });
    }
    if (depth === WORK && YEAR.test(dir.split("/").pop() ?? "")) {
      violations.push({
        path: dir,
        message: "year-named directory directly under an author",
      });
    }
  };
  await walkDirs("works", WORKS_ROOT);
  for (const entry of await fs.readDir(`${root}/data/authors`)) {
    if (!/^[a-z0-9]+\.mit$/.test(entry.name)) {
      violations.push({
        path: `authors/${entry.name}`,
        message: "name should be a lowercase slug",
      });
    }
  }
  return violations;
};

/* ------------------------------- helpers ------------------------------- */

/** The stub directories a created or deleted file can change the resolution of:
 * `<dir>/<canonical>.mit` and `<dir>/<canonical>/index.mit`. */
const stubDirsAbove = (path: string): string[] => {
  const segments = path.split("/");
  return [segments.slice(0, -1).join("/"), segments.slice(0, -2).join("/")]
    .filter(Boolean);
};

/** Per-path results in projection order, so the tier's output is stable. */
const ordered = (
  projections: ReadonlyMap<string, FileProjection>,
  cache: ReadonlyMap<string, RuleViolation[]>,
): RuleViolation[] => {
  const out: RuleViolation[] = [];
  for (const path of projections.keys()) out.push(...(cache.get(path) ?? []));
  return out;
};

const stamp = (rule: string, found: RuleViolation[]): Violation[] =>
  found.map((v) => ({ ...v, rule }));

const add = (
  index: Map<string, Set<string>>,
  key: string,
  path: string,
): void => {
  const set = index.get(key);
  if (set === undefined) index.set(key, new Set([path]));
  else set.add(path);
};

const drop = (
  index: Map<string, Set<string>>,
  key: string,
  path: string,
): void => {
  const set = index.get(key);
  if (set === undefined) return;
  set.delete(path);
  if (set.size === 0) index.delete(key);
};

const sameSet = (a: Set<string>, b: Set<string>): boolean =>
  a.size === b.size && [...a].every((value) => b.has(value));

const symmetricDifference = (a: Set<string>, b: Set<string>): string[] => [
  ...[...a].filter((value) => !b.has(value)),
  ...[...b].filter((value) => !a.has(value)),
];
