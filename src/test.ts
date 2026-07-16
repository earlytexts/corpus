/**
 * In-memory corpus authoring for the tests. A corpus is just a map of paths to
 * `.mit` text — no fixture files on disk. `corpus()` is a fluent builder for one;
 * `memoryCorpus` turns a file map into the `CorpusFs` the catalogue build walks;
 * `buildCatalogue` (re-exported) compiles that map into the in-memory catalogue.
 * Both the corpus's own tests and the computer's (which compile these maps into
 * `catalogue/`) import this harness, so the fixture format lives in one place —
 * and it is the computer's one remaining door onto the compiler, now that its
 * production build shells out to the corpus checkout rather than importing it.
 */

import type { CorpusFs } from "./ports.ts";
import { normalizePath } from "./paths.ts";

// The catalogue compiler, for building a fixture corpus map into a catalogue in
// memory. (Writing it to disk — writeCatalogue, nodeCorpusFs — is the corpus's
// own build/deploy concern and stays off the published surface.)
export { buildCatalogue } from "./catalogue/compile.ts";

/** The root every corpus path hangs off (an arbitrary absolute prefix). */
export const CORPUS_ROOT = "/corpus";

/** A `CorpusFs` over a (possibly mutable) map of normalised path → file text. */
export const memoryCorpus = (files: Record<string, string>): CorpusFs => ({
  readFile: (path) => Promise.resolve(files[normalizePath(path)] ?? null),
  readDir: (path) => {
    const normalized = normalizePath(path);
    const prefix = normalized === "/" ? "/" : normalized + "/";
    const children = new Map<string, boolean>(); // name → isFile
    for (const key of Object.keys(files)) {
      if (!key.startsWith(prefix)) continue;
      const rest = key.slice(prefix.length);
      const slash = rest.indexOf("/");
      if (slash === -1) children.set(rest, true);
      else children.set(rest.slice(0, slash), false);
    }
    if (children.size === 0) throw new Error(`no such directory: ${path}`);
    return Promise.resolve(
      [...children].map(([name, isFile]) => ({
        name,
        isFile,
        isDirectory: !isFile,
        isSymlink: false,
      })),
    );
  },
  realPath: (path) => Promise.resolve(normalizePath(path)),
  stat: (path) => {
    const key = normalizePath(path);
    if (files[key] !== undefined) return Promise.resolve({ isFile: true });
    const prefix = key + "/";
    return Promise.resolve(
      Object.keys(files).some((k) => k.startsWith(prefix))
        ? { isFile: false }
        : null,
    );
  },
});

/* ------------------------------- builder ------------------------------ */

type Scalar = string | number | boolean;
/** A `.mit` `[metadata]` block, as a record (arrays become inline TOML arrays). */
export type Meta = Record<string, Scalar | Scalar[]>;

/** A fluent builder for a corpus map: author/work/edition files under the root.
 * A private shape — consumers only ever hold one via `corpus()`. */
type CorpusBuilder = {
  /** `data/authors/<slug>.mit`: the author's metadata (no text). */
  author: (slug: string, meta: Meta) => CorpusBuilder;
  /** `data/works/<author>/<work>/index.mit`: the work's edition-independent identity. */
  work: (author: string, work: string, meta: Meta) => CorpusBuilder;
  /** `data/works/<author>/<work>/<slug>.mit`: a year-named edition with its text. */
  edition: (
    author: string,
    work: string,
    slug: string,
    meta: Meta,
    body?: string,
  ) => CorpusBuilder;
  /** Escape hatch: write a raw file at a root-relative path. */
  file: (relPath: string, content: string) => CorpusBuilder;
  /** The corpus map (a fresh copy). */
  build: () => Record<string, string>;
};

/** Start a fresh, empty corpus builder. Chain `author`/`work`/`edition` (or
 * `file`) calls, then `build()` for the path → text map. */
export const corpus = (): CorpusBuilder => {
  const files: Record<string, string> = {};
  const builder: CorpusBuilder = {
    author: (slug, meta) => {
      files[`${CORPUS_ROOT}/data/authors/${slug}.mit`] = doc(`# ${slug}`, meta);
      return builder;
    },
    work: (author, work, meta) => {
      files[`${CORPUS_ROOT}/data/works/${author}/${work}/index.mit`] = doc(
        `# ${author}.${work}`,
        meta,
      );
      return builder;
    },
    edition: (author, work, slug, meta, body = "") => {
      files[`${CORPUS_ROOT}/data/works/${author}/${work}/${slug}.mit`] = doc(
        `# ${author}.${work}.${slug}`,
        meta,
        body,
      );
      return builder;
    },
    file: (relPath, content) => {
      files[`${CORPUS_ROOT}/${relPath}`] = content;
      return builder;
    },
    build: () => ({ ...files }),
  };
  return builder;
};

const doc = (heading: string, meta: Meta, body = ""): string =>
  `${heading}\n\n[metadata]\n${toml(meta)}\n${body ? `\n${body}\n` : ""}`;

const toml = (meta: Meta): string =>
  Object.entries(meta)
    .map(([k, v]) => `${k} = ${tomlValue(v)}`)
    .join("\n");

const tomlValue = (value: Scalar | Scalar[]): string =>
  Array.isArray(value)
    ? `[${value.map(tomlValue).join(", ")}]`
    : typeof value === "string"
    ? JSON.stringify(value)
    : String(value);
