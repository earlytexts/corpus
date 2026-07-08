/**
 * Corpus validation as pure rules: every file must be valid Markit, formatted
 * canonically, and conform to the metadata schema and layout conventions in
 * ../README.md. Each rule returns structured violations rather than throwing,
 * so the same rule set drives both the Deno test wrapper
 * (../scripts/validate.ts) and editor diagnostics (the Compositor extension).
 *
 * Reads top-down: the contract types, then `validateCorpus` and the `rules`
 * it runs, then `loadCorpus` (which builds the rules' input), with the shared
 * helpers at the bottom.
 */

import {
  compile,
  format,
  type MarkitDocument,
  type MarkitError,
  startLine,
} from "@earlytexts/markit";
import type { CorpusFs } from "./types.ts";
import {
  authorRequired,
  authorSchema,
  authorSexValues,
  blockSchema,
  keyViolations,
  textSchema,
} from "./schema.ts";
import {
  borrowedRef,
  expectedId,
  resolveEdition,
  resolveVariant,
  YEAR,
} from "./paths.ts";

/** A corpus file, compiled standalone (borrowed children left unresolved). */
export type CorpusFile = {
  /** Path relative to `data/`, e.g. "works/hume/thn/1739-40.mit". */
  path: string;
  text: string;
  doc: MarkitDocument;
  errors: MarkitError[];
};

export type Violation = {
  /** The name of the rule that was violated (see `rules`). */
  rule: string;
  /** Path relative to `data/`; usually a file, a directory for layout rules. */
  path: string;
  /** Qualifier locating the violation within the file, e.g. "(Hume.EHU.1748.1)". */
  locus?: string;
  message: string;
  /** 1-based position, when known. Compile errors carry a full range;
   * other rules anchor to a line at best. */
  line?: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
  /** Compile errors keep Markit's severity; every other rule is an error. */
  severity?: "error" | "warning";
};

/** What a rule needs: the compiled files plus filesystem access for the rules
 * that check resolution and layout. `root` is the corpus root (holds `data/`). */
export type RuleContext = {
  files: CorpusFile[];
  fs: CorpusFs;
  root: string;
};

export type Rule = {
  name: string;
  check: (ctx: RuleContext) => Violation[] | Promise<Violation[]>;
};

/** Run every rule and collect the violations, in rule order. */
export const validateCorpus = async (
  ctx: RuleContext,
): Promise<Violation[]> => {
  const violations: Violation[] = [];
  for (const rule of rules) violations.push(...(await rule.check(ctx)));
  return violations;
};

export const rules: Rule[] = [
  {
    name: "every file compiles without errors",
    check: ({ files }) =>
      files.flatMap(({ path, errors }) =>
        errors.map((e) => ({
          rule: "every file compiles without errors",
          path,
          message: e.message,
          line: e.line,
          column: e.column,
          endLine: e.endLine,
          endColumn: e.endColumn,
          severity: e.severity,
        }))
      ),
  },
  {
    name: "every file is formatted canonically",
    check: ({ files }) =>
      files
        .filter(({ text }) => format(text) !== text)
        .map(({ path }) => ({
          rule: "every file is formatted canonically",
          path,
          message: "differs from formatter output (run `npm run fix`)",
        })),
  },
  {
    name: "author files match the author schema",
    check: ({ files }) => {
      const violations: Violation[] = [];
      const rule = "author files match the author schema";
      for (const { path, doc } of compiled(authorFiles(files))) {
        const metadata = meta(doc.metadata);
        const line = lineOf(doc.metadata) ?? lineOf(doc);
        const push = (message: string, at = line) =>
          violations.push({ rule, path, message, line: at });
        for (const message of keyViolations(metadata, authorSchema)) {
          push(message);
        }
        for (const key of authorRequired) {
          if (!(key in metadata)) push(`missing "${key}"`);
        }
        if (
          metadata.sex !== undefined &&
          !authorSexValues.includes(metadata.sex as string)
        ) {
          push(`"sex" must be "Male" or "Female"`);
        }
        if (doc.children.length > 0) {
          push("author files cannot have sections", lineOf(doc.children[0]));
        }
        if (doc.blocks.length > 0) {
          push("author files cannot have content", lineOf(doc.blocks[0]));
        }
      }
      return violations;
    },
  },
  {
    name: "texts match the text schema",
    check: ({ files }) => {
      const violations: Violation[] = [];
      const rule = "texts match the text schema";
      for (const { path, doc } of compiled(workFiles(files))) {
        const stub = isStub(path, doc);
        for (const { text, ancestors } of allTexts(doc)) {
          const parent = ancestors[ancestors.length - 1];
          // A borrowed-child placeholder (`## <Hume.EHU.1750>`) carries no
          // metadata of its own; the edition it names is validated as its own
          // file.
          if (borrowedRef(headingSegment(text.id, parent?.id)) !== undefined) {
            continue;
          }
          const locus = `(${text.id})`;
          const metadata = meta(text.metadata);
          const line = lineOf(text.metadata) ?? lineOf(text);
          const push = (message: string) =>
            violations.push({ rule, path, locus, message, line });
          for (const message of keyViolations(metadata, textSchema)) {
            push(message);
          }
          for (const key of ["title", "breadcrumb"]) {
            if (!(key in metadata)) push(`missing "${key}"`);
          }
          // A stub holds only work identity + the canonical pointer; it has no
          // text, so the imported/published presence rules don't apply to it.
          // `authors`, however, is part of a work's identity, so it is required
          // on the stub too (own value, not inherited — a stub has no ancestor).
          if (!stub) {
            for (const key of ["imported", "published", "authors"]) {
              const inherited = [...ancestors, text].some(
                (t) => key in meta(t.metadata),
              );
              if (!inherited) push(`missing "${key}" (not inherited either)`);
            }
          } else if (!("authors" in metadata)) {
            push(`missing "authors"`);
          }
          if ("canonical" in metadata && !stub) {
            push(`"canonical" belongs only on a work's index.mit stub`);
          }
          if ("standalone" in metadata && !stub) {
            push(`"standalone" belongs only on a work's index.mit stub`);
          }
          // A work's first-publication year is derived from its editions,
          // never set on the stub.
          if ("published" in metadata && stub) {
            push(`"published" is derived from editions, not set on the stub`);
          }
        }
      }
      return violations;
    },
  },
  {
    name: "work stubs name a canonical edition that exists",
    check: async ({ files, fs, root }) => {
      const violations: Violation[] = [];
      const rule = "work stubs name a canonical edition that exists";
      for (const { path, doc } of compiled(workFiles(files))) {
        if (!isStub(path, doc)) continue;
        const metadata = meta(doc.metadata);
        const line = lineOf(doc.metadata) ?? lineOf(doc);
        if (doc.blocks.length > 0 || doc.children.length > 0) {
          violations.push({
            rule,
            path,
            message: "a stub holds metadata only (no text/sections)",
            line: lineOf(doc.children[0]) ?? lineOf(doc.blocks[0]),
          });
        }
        const canonical = metadata.canonical;
        if (typeof canonical !== "string") continue; // schema rule reports the type
        const dir = path.slice(0, path.lastIndexOf("/"));
        const resolves = await resolveVariant(
          fs,
          `${root}/data/${dir}/${canonical}`,
        );
        if (resolves === undefined) {
          violations.push({
            rule,
            path,
            message: `canonical "${canonical}" has no edition in ${dir}`,
            line,
          });
        }
      }
      return violations;
    },
  },
  {
    name: "block metadata matches the block schema",
    check: ({ files }) => {
      const violations: Violation[] = [];
      const rule = "block metadata matches the block schema";
      for (const { path, doc } of compiled(workFiles(files))) {
        for (const { text } of allTexts(doc)) {
          for (const block of text.blocks) {
            if (block.metadata === undefined) continue;
            for (
              const message of keyViolations(
                meta(block.metadata),
                blockSchema,
              )
            ) {
              violations.push({
                rule,
                path,
                locus: `(${text.id} {#${block.id}})`,
                message,
                line: lineOf(block.metadata) ?? lineOf(block),
              });
            }
          }
        }
      }
      return violations;
    },
  },
  {
    name: "every authors slug names a known author",
    check: ({ files }) => {
      const violations: Violation[] = [];
      const rule = "every authors slug names a known author";
      const known = authorSlugs(files);
      for (const { path, doc } of compiled(workFiles(files))) {
        for (const { text } of allTexts(doc)) {
          for (const slug of authorsOf(meta(text.metadata).authors)) {
            if (!known.has(slug)) {
              violations.push({
                rule,
                path,
                locus: `(${text.id})`,
                message: `unknown author "${slug}"`,
                line: lineOf(text.metadata) ?? lineOf(text),
              });
            }
          }
          for (const block of text.blocks) {
            if (block.metadata === undefined) continue;
            for (const slug of authorsOf(meta(block.metadata).authors)) {
              if (!known.has(slug)) {
                violations.push({
                  rule,
                  path,
                  locus: `(${text.id}) {#${block.id}}`,
                  message: `unknown author "${slug}"`,
                  line: lineOf(block.metadata) ?? lineOf(block),
                });
              }
            }
          }
        }
      }
      return violations;
    },
  },
  {
    name: "root IDs match file paths",
    check: ({ files }) =>
      compiled(files)
        .filter(
          ({ path, doc }) =>
            doc.id.toLowerCase() !== expectedId(path).toLowerCase(),
        )
        .map(({ path, doc }) => ({
          rule: "root IDs match file paths",
          path,
          message: `root ID is "${doc.id}", expected "${expectedId(path)}"`,
          line: lineOf(doc),
        })),
  },
  {
    name: "section headings are bare segments",
    check: ({ files }) => {
      const violations: Violation[] = [];
      const rule = "section headings are bare segments";
      for (const { path, doc } of compiled(workFiles(files))) {
        for (const { text, ancestors } of allTexts(doc)) {
          const parent = ancestors[ancestors.length - 1];
          if (parent === undefined) continue;
          const segment = headingSegment(text.id, parent.id);
          // A borrowed-child placeholder's segment is a bracketed dotted
          // edition ID (`<Hume.EHU.1750>`) — the dots are expected; resolution
          // is checked by the borrowed-child rule.
          if (borrowedRef(segment) !== undefined) continue;
          if (segment.includes(".")) {
            violations.push({
              rule,
              path,
              message:
                `heading "${segment}" should be a bare segment (no dots)`,
              line: lineOf(text),
            });
          }
        }
      }
      return violations;
    },
  },
  {
    name: "borrowed-child references resolve to an edition",
    check: async ({ files, fs, root }) => {
      const violations: Violation[] = [];
      const rule = "borrowed-child references resolve to an edition";
      for (const { path, doc } of compiled(workFiles(files))) {
        for (const { text, ancestors } of allTexts(doc)) {
          const parent = ancestors[ancestors.length - 1];
          const ref = borrowedRef(headingSegment(text.id, parent?.id));
          if (ref === undefined) continue;
          // <Author.Work.Edition> →
          // data/works/<author>/<work>/<edition>{.mit,/index.mit}.
          if (
            (await resolveEdition(fs, `${root}/data/works`, ref)) === undefined
          ) {
            violations.push({
              rule,
              path,
              locus: `(${text.id})`,
              message: `unresolvable borrowed child "${ref}"`,
              line: lineOf(text),
            });
          }
        }
      }
      return violations;
    },
  },
  {
    name: "layout: lowercase names, index.mit in every directory",
    check: async ({ files, fs, root }) => {
      const violations: Violation[] = [];
      const rule = "layout: lowercase names, index.mit in every directory";
      const known = authorSlugs(files);
      const walkDirs = async (dir: string, depth: number): Promise<void> => {
        const names = new Set<string>();
        for (const entry of await fs.readDir(`${root}/data/${dir}`)) {
          names.add(entry.name);
          const stem = entry.name.replace(/\.mit$/, "");
          // A host directory (depth 0, directly under works/) may be a joint
          // slug — author slugs joined with `-`, each of which must name a
          // known author. Everything deeper is a single lowercase slug.
          if (depth === 0 && entry.isDirectory && stem.includes("-")) {
            for (const part of stem.split("-")) {
              if (!/^[a-z0-9]+$/.test(part)) {
                violations.push({
                  rule,
                  path: `${dir}/${entry.name}`,
                  message: "name should be a lowercase slug",
                });
              } else if (!known.has(part)) {
                violations.push({
                  rule,
                  path: `${dir}/${entry.name}`,
                  message: `joint host names unknown author "${part}"`,
                });
              }
            }
          } else if (!YEAR.test(stem) && !/^[a-z0-9]+$/.test(stem)) {
            violations.push({
              rule,
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
        if (depth >= 2 && !names.has("index.mit")) {
          violations.push({ rule, path: dir, message: "missing index.mit" });
        }
        if (depth === 2 && YEAR.test(dir.split("/").pop() ?? "")) {
          violations.push({
            rule,
            path: dir,
            message: "year-named directory directly under an author",
          });
        }
      };
      await walkDirs("works", 0);
      for (const entry of await fs.readDir(`${root}/data/authors`)) {
        if (!/^[a-z0-9]+\.mit$/.test(entry.name)) {
          violations.push({
            rule,
            path: `authors/${entry.name}`,
            message: "name should be a lowercase slug",
          });
        }
      }
      return violations;
    },
  },
];

/** Load and compile every .mit file under data/authors and data/works. Files
 * that vanish mid-walk are skipped (their absence is not a corpus violation). */
export const loadCorpus = async (
  fs: CorpusFs,
  root: string,
): Promise<CorpusFile[]> => {
  const files: CorpusFile[] = [];
  for (const top of ["authors", "works"]) {
    for await (const path of walk(fs, `${root}/data`, top)) {
      const text = await fs.readFile(`${root}/data/${path}`);
      if (text === null) continue;
      const [doc, errors] = compile(text);
      files.push({ path, text, doc, errors });
    }
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
};

/** Render a violation in the corpus's conventional one-line form:
 * `path:line:col: message` for positioned compile errors, else
 * `path (locus): message`. */
export const violationText = (v: Violation): string =>
  v.column !== undefined && v.line !== undefined
    ? `${v.path}:${v.line}:${v.column}: ${v.message}`
    : `${v.path}${v.locus === undefined ? "" : ` ${v.locus}`}: ${v.message}`;

/* ------------------------------- helpers ------------------------------- */

/** A section's own heading segment: its ID with the parent's ID prefix removed. */
export const headingSegment = (
  id: string,
  parentId: string | undefined,
): string =>
  parentId !== undefined && id.startsWith(`${parentId}.`)
    ? id.slice(parentId.length + 1)
    : id;

/** Every text in a document, paired with its ancestors (root first). */
export const allTexts = (
  doc: MarkitDocument,
  ancestors: MarkitDocument[] = [],
): { text: MarkitDocument; ancestors: MarkitDocument[] }[] => [
  { text: doc, ancestors },
  ...doc.children.flatMap((child) => allTexts(child, [...ancestors, doc])),
];

const walk = async function* (
  fs: CorpusFs,
  dataDir: string,
  dir: string,
): AsyncGenerator<string> {
  for (const entry of await fs.readDir(`${dataDir}/${dir}`)) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory) yield* walk(fs, dataDir, path);
    else if (entry.name.endsWith(".mit")) yield path;
  }
};

/** Metadata viewed as plain entries (drops Markit's symbol-keyed ranges). */
const meta = (value: unknown): Record<string, unknown> =>
  (value ?? {}) as Record<string, unknown>;

/** The 1-based line a node starts on, via Markit's symbol-keyed ranges. */
const lineOf = (
  node: { [startLine]: number } | undefined,
): number | undefined => (node === undefined ? undefined : node[startLine] + 1);

const authorFiles = (files: CorpusFile[]): CorpusFile[] =>
  files.filter((f) => f.path.startsWith("authors/"));

const workFiles = (files: CorpusFile[]): CorpusFile[] =>
  files.filter((f) => f.path.startsWith("works/"));

/** Files that compile cleanly; schema/structure rules skip the rest to avoid
 * cascading noise — the compile rule already reports them. */
const compiled = (list: CorpusFile[]): CorpusFile[] =>
  list.filter((f) => f.errors.length === 0);

const authorSlugs = (files: CorpusFile[]): Set<string> =>
  new Set(
    authorFiles(files).map((f) =>
      f.path.slice("authors/".length, -".mit".length)
    ),
  );

/** A work stub: `index.mit` carrying a `canonical` pointer, metadata only. */
const isStub = (path: string, doc: { metadata?: unknown }): boolean =>
  path.endsWith("/index.mit") && "canonical" in meta(doc.metadata);

/** Slugs named by an `authors` value (text or block level), if any. */
const authorsOf = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((s): s is string => typeof s === "string")
    : [];
