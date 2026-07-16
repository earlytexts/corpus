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
  compileWithPositions,
  format,
  type MarkitDocument,
  type MarkitError,
  type SourceRange,
} from "@earlytexts/markit";
import type { CorpusFs } from "../ports.ts";
import {
  accountTokens,
  type Coverage,
  coverageOf,
} from "../dictionary/account.ts";
import {
  canonicalSpellingViolations,
  dictionaryViolations,
  expandDictionary,
} from "../dictionary/expand.ts";
import {
  overridesOf,
  overrideViolation,
  wordMarkupViolation,
} from "../dictionary/resolve.ts";
import {
  parseDictionary,
  readDictionaryShards,
  shardDictionary,
  shardOf,
} from "../dictionary/shards.ts";
import { scanBlock } from "../words.ts";
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
} from "../paths.ts";

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
          line: e.source.start.line + 1,
          column: e.source.start.column + 1,
          endLine: e.source.end.line + 1,
          endColumn: e.source.end.column + 1,
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
        const line = lineOf(doc.metadataSource?.source) ?? lineOf(doc.source);
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
          push(
            "author files cannot have sections",
            lineOf(doc.children[0]?.source),
          );
        }
        if (doc.blocks.length > 0) {
          push(
            "author files cannot have content",
            lineOf(doc.blocks[0]?.source),
          );
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
          const line = lineOf(text.metadataSource?.source) ??
            lineOf(text.source);
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
          // A stub is metadata-only: it prints no tokens, so overrides would
          // mean nothing there.
          if ("dictionary" in metadata && stub) {
            push(`"dictionary" does not belong on a work's index.mit stub`);
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
        const line = lineOf(doc.metadataSource?.source) ?? lineOf(doc.source);
        if (doc.blocks.length > 0 || doc.children.length > 0) {
          violations.push({
            rule,
            path,
            message: "a stub holds metadata only (no text/sections)",
            line: lineOf(doc.children[0]?.source) ??
              lineOf(doc.blocks[0]?.source),
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
                line: lineOf(block.metadataSource?.source) ??
                  lineOf(block.source),
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
                line: lineOf(text.metadataSource?.source) ??
                  lineOf(text.source),
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
                  line: lineOf(block.metadataSource?.source) ??
                    lineOf(block.source),
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
          line: lineOf(doc.source),
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
              line: lineOf(text.source),
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
              line: lineOf(text.source),
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
  {
    // The structural tier of the dictionary validation (see ../README.md):
    // shards parse, keys are folded words in the right shard in order,
    // values are well-formed — and, when all of that holds, each shard is
    // byte-for-byte canonical.
    name: "dictionary shards are well-formed",
    check: async ({ fs, root }) => {
      const rule = "dictionary shards are well-formed";
      const shards = await readDictionaryShards(fs, root);
      const { dictionary, problems } = parseDictionary(shards);
      const violations: Violation[] = problems.map((problem) => ({
        rule,
        path: `dictionary/${problem.shard}`,
        ...(problem.key !== undefined ? { locus: `"${problem.key}"` } : {}),
        message: problem.message,
      }));
      // The formatting comparison only means anything once the shards parse
      // cleanly; skip it to avoid cascading noise.
      if (violations.length > 0) return violations;
      const canonical = shardDictionary(dictionary);
      for (const [shard, text] of shards) {
        const want = canonical.get(shard);
        if (want === undefined) {
          violations.push({
            rule,
            path: `dictionary/${shard}`,
            message: "empty shard file (run `deno task fmt` to remove it)",
          });
        } else if (want !== text) {
          violations.push({
            rule,
            path: `dictionary/${shard}`,
            message: "not canonically formatted (run `deno task fmt`)",
          });
        }
      }
      return violations;
    },
  },
  {
    // The referential tier, within the register: closed under derivation —
    // cross-references and lemmas resolve, expanded readings are distinct and
    // selectable (see dictionary.ts, dictionaryViolations). Skipped while the
    // shards themselves have problems — dropped entries would dangle
    // spuriously.
    name: "dictionary readings resolve within the register",
    check: async ({ fs, root }) => {
      const rule = "dictionary readings resolve within the register";
      const { dictionary, problems } = parseDictionary(
        await readDictionaryShards(fs, root),
      );
      if (problems.length > 0) return [];
      return dictionaryViolations(dictionary).map(({ key, message }) => ({
        rule,
        path: `dictionary/${shardOf(key)}`,
        locus: `"${key}"`,
        message,
      }));
    },
  },
  {
    // The canonical-spelling rule (see ../DICTIONARY.md, Principles of
    // Normalisation): within a normalisation class the canonical spelling must
    // be the one an external authority endorses — a fixed, version-pinned modern
    // reference word list (data/reference/words.txt, from SCOWL) — several
    // matches or ties broken alphabetically, gaps pinned in
    // canonical-exceptions.json. External and fixed, so the choice never drifts
    // as the corpus grows. Skipped while the shards have structural problems or
    // the reference list is absent (nothing to check against).
    name: "canonical spelling matches the reference word list",
    check: async ({ fs, root }) => {
      const rule = "canonical spelling matches the reference word list";
      const { dictionary, problems } = parseDictionary(
        await readDictionaryShards(fs, root),
      );
      if (problems.length > 0) return [];
      const wordlist = await loadReferenceWords(fs, root);
      if (wordlist === null) return [];
      const exceptions = await loadCanonicalExceptions(fs, root);
      return canonicalSpellingViolations(dictionary, wordlist, exceptions).map(
        ({ key, message }) => ({
          rule,
          path: `dictionary/${shardOf(key)}`,
          locus: `"${key}"`,
          message,
        }),
      );
    },
  },
  {
    // Still the referential tier: every `[w:surface=value]` in the texts
    // obeys the dictionary (see dictionary.ts, wordMarkupViolation) — checked
    // against the expanded readings, so inherited ambiguity counts.
    name: "word markup selects a dictionary reading",
    check: async ({ files, fs, root }) => {
      const rule = "word markup selects a dictionary reading";
      const dictionary = expandDictionary(
        parseDictionary(await readDictionaryShards(fs, root)).dictionary,
      );
      const violations: Violation[] = [];
      for (const { path, doc } of compiled(workFiles(files))) {
        for (const { text } of allTexts(doc)) {
          for (const block of text.blocks) {
            for (const { element, tokens } of scanBlock(block).words) {
              const message = wordMarkupViolation(element, tokens, dictionary);
              if (message !== undefined) {
                violations.push({
                  rule,
                  path,
                  locus: `(${text.id})`,
                  message,
                  line: lineOf(block.source),
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
    // Still the referential tier: every `[metadata.dictionary]` override obeys
    // the dictionary (see dictionary.ts, overrideViolation) — the same
    // selection rule as `[w:]` markup, stated once per edition (or section)
    // instead of per occurrence.
    name: "dictionary overrides select a reading",
    check: async ({ files, fs, root }) => {
      const rule = "dictionary overrides select a reading";
      const dictionary = expandDictionary(
        parseDictionary(await readDictionaryShards(fs, root)).dictionary,
      );
      const violations: Violation[] = [];
      for (const { path, doc } of compiled(workFiles(files))) {
        for (const { text } of allTexts(doc)) {
          const overrides = Object.entries(overridesOf(text.metadata));
          if (overrides.length === 0) continue;
          const line = lineOf(text.metadataSource?.nested?.dictionary) ??
            lineOf(text.metadataSource?.source) ?? lineOf(text.source);
          for (const [surface, value] of overrides) {
            const message = overrideViolation(surface, value, dictionary);
            if (message !== undefined) {
              violations.push({
                rule,
                path,
                locus: `(${text.id})`,
                message,
                line,
              });
            }
          }
        }
      }
      return violations;
    },
  },
];

/**
 * The coverage tier of the dictionary validation: how much of each work (and
 * of the whole corpus) the accounting rule accounts for. A report, not a rule
 * — it never fails while the register is being backfilled; flipping it to a
 * hard error is the last step of the backfill.
 */
export const dictionaryCoverage = async (
  ctx: RuleContext,
): Promise<string[]> => {
  const { dictionary } = parseDictionary(
    await readDictionaryShards(ctx.fs, ctx.root),
  );
  const totals: Coverage = { total: 0, accounted: 0, unaccounted: 0 };
  const byWork = new Map<string, Coverage>();
  for (const { path, doc } of compiled(workFiles(ctx.files))) {
    const coverage = coverageOf(accountTokens(doc, dictionary));
    addCoverage(totals, coverage);
    const work = path.split("/").slice(1, 3).join("/");
    const existing = byWork.get(work);
    if (existing === undefined) byWork.set(work, coverage);
    else addCoverage(existing, coverage);
  }
  return [
    `corpus: ${coverageLine(totals)}`,
    ...[...byWork.entries()]
      .filter(([, coverage]) => coverage.total > 0) // skip unimported stubs
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([work, coverage]) => `  ${work}: ${coverageLine(coverage)}`),
  ];
};

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
      const { document: doc, errors } = compileWithPositions(text);
      files.push({ path, text, doc, errors });
    }
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
};

/** The external reference word list (data/reference/words.txt): one lower-cased
 * spelling per line. `null` when absent — the canonical-spelling rule then
 * defers, since it has no authority to check against. */
export const loadReferenceWords = async (
  fs: CorpusFs,
  root: string,
): Promise<Set<string> | null> => {
  const text = await fs.readFile(`${root}/data/reference/words.txt`);
  if (text === null) return null;
  return new Set(
    text.split("\n").map((line) => line.trim().toLowerCase()).filter(Boolean),
  );
};

/** The canonical-spelling exceptions (data/reference/canonical-exceptions.json):
 * a JSON array of spellings pinned as their class's canonical, overriding the
 * word list. Empty when the file is absent. */
export const loadCanonicalExceptions = async (
  fs: CorpusFs,
  root: string,
): Promise<Set<string>> => {
  const text = await fs.readFile(
    `${root}/data/reference/canonical-exceptions.json`,
  );
  return text === null ? new Set() : new Set(JSON.parse(text) as string[]);
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

/** Metadata viewed as plain entries (folds the absent case to `{}`). */
const meta = (value: unknown): Record<string, unknown> =>
  (value ?? {}) as Record<string, unknown>;

/** The 1-based line a source range starts on (ranges come from
 * `compileWithPositions` — see `loadCorpus`). */
const lineOf = (source: SourceRange | undefined): number | undefined =>
  source === undefined ? undefined : source.start.line + 1;

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

const addCoverage = (into: Coverage, from: Coverage): void => {
  into.total += from.total;
  into.accounted += from.accounted;
  into.unaccounted += from.unaccounted;
};

const coverageLine = (coverage: Coverage): string => {
  if (coverage.total === 0) return "no tokens";
  const pct = ((coverage.accounted / coverage.total) * 100).toFixed(1);
  return `${pct}% of ${coverage.total} tokens accounted`;
};

/** A work stub: `index.mit` carrying a `canonical` pointer, metadata only. */
const isStub = (path: string, doc: { metadata?: unknown }): boolean =>
  path.endsWith("/index.mit") && "canonical" in meta(doc.metadata);

/** Slugs named by an `authors` value (text or block level), if any. */
const authorsOf = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((s): s is string => typeof s === "string")
    : [];
