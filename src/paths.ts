/**
 * Path conventions shared across the corpus: how a year/edition slug looks, how
 * a borrowed-child placeholder names another edition, and how an id or stem is
 * resolved to a file case-insensitively. The catalogue build, the validator, and
 * the test harness all draw on these so the rules live in exactly one place.
 */

import type { CorpusFs } from "./types.ts";

/**
 * A year-named edition slug: four digits with an optional letter (`1742a`),
 * optionally a span to a later year, abbreviated or full (`1739-40`, `1739-1740`).
 */
export const YEAR = /^\d{4}(-\d{2,4})?[a-z]?$/;

/**
 * The bracketed edition id of a borrowed-child placeholder, e.g.
 * `## <Hume.EHU.1750>` → "Hume.EHU.1750"; undefined for an ordinary section.
 * Matches the trailing `<…>`, so it works on a bare heading segment and on a
 * fully-qualified child id alike. A borrowed child names another edition whose
 * text is spliced in at that point.
 */
export const borrowedRef = (id: string): string | undefined =>
  /<([^<>]+)>$/.exec(id)?.[1];

/**
 * The document ID implied by a file's path (relative to `data/`): dot-joined
 * path segments after works/, with a trailing "index" dropped; an author file's
 * ID is its bare slug. Compared case-insensitively against the actual root ID.
 */
export const expectedId = (path: string): string => {
  const segments = path.replace(/\.mit$/, "").split("/");
  if (segments[0] === "authors") return segments[1] ?? "";
  const parts = segments.slice(1);
  if (parts[parts.length - 1] === "index") parts.pop();
  return parts.join(".");
};

/**
 * The corpus file for an edition named by a borrowed-child id
 * `Author.Work.Edition`, looked up under `worksDir`:
 * `<worksDir>/<author>/<work>/<edition>.mit` (or its `/index.mit` form).
 * Returns undefined when the id has too few segments to name an edition, or no
 * such file exists. Resolution is case-insensitive, so the id's own case
 * (title-cased) needn't match the lower-cased directories on disk.
 */
export const resolveEdition = async (
  fs: CorpusFs,
  worksDir: string,
  id: string,
): Promise<string | undefined> => {
  const parts = id.split(".");
  if (parts.length < 3) return undefined;
  const [author, work, ...rest] = parts;
  return await resolveVariant(
    fs,
    `${worksDir}/${author}/${work}/${rest.join(".")}`,
  );
};

/**
 * Resolve a `.mit` text from its stem: the file `<base>.mit`, else its directory
 * form `<base>/index.mit`. This is how every edition and stub resolves to a file.
 */
export const resolveVariant = async (
  fs: CorpusFs,
  base: string,
): Promise<string | undefined> =>
  (await resolveFile(fs, `${base}.mit`)) ??
    (await resolveFile(fs, `${base}/index.mit`));

/**
 * Resolve a path case-insensitively against the file system, so references like
 * `../NHR/1757` work on case-sensitive systems too. Returns the real path if a
 * file is found there, otherwise undefined.
 */
export const resolveFile = async (
  fs: CorpusFs,
  path: string,
): Promise<string | undefined> => {
  try {
    // realPath canonicalises letter case, so that "../NHR/1757" and
    // "../nhr/1757" cache and attribute identically.
    if ((await fs.stat(path))?.isFile) return await fs.realPath(path);
  } catch {
    // fall through to the case-insensitive walk
  }
  const parts = normalizePath(path).split("/").filter((p) => p !== "");
  let current = ""; // paths here are always absolute (see normalizePath)
  for (const part of parts) {
    let matched: string | undefined;
    try {
      for (const entry of await fs.readDir(current === "" ? "/" : current)) {
        if (entry.name.toLowerCase() === part.toLowerCase()) {
          matched = entry.name;
          break;
        }
      }
    } catch {
      return undefined;
    }
    if (matched === undefined) return undefined;
    current = `${current}/${matched}`;
  }
  try {
    if ((await fs.stat(current))?.isFile) return await fs.realPath(current);
  } catch {
    return undefined;
  }
  return undefined;
};

/**
 * Normalise an absolute path textually, collapsing empty and "." segments and
 * resolving "..". Every path here descends from the corpus root, so the result
 * is always absolute.
 */
export const normalizePath = (path: string): string => {
  const out: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return "/" + out.join("/");
};
