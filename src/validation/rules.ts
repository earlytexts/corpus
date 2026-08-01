/**
 * Corpus validation as pure rules: every file must be valid Markit, formatted
 * canonically, and conform to the metadata schema and layout conventions in
 * ../README.md. Each rule returns structured violations rather than throwing,
 * so the same rule set drives both the Deno test wrapper
 * (../scripts/validate.ts) and editor diagnostics (the Compositor extension).
 *
 * Reads top-down: the contract types, then `validateCorpus`, then each rule as
 * a named const (assembled into `rules`), then `loadCorpus` (which builds the
 * rules' input), with the shared helpers at the bottom.
 */

import {
  compileWithPositions,
  type MarkitDocument,
  type MarkitError,
  type MetadataSource,
  type SourceRange,
} from "@earlytexts/markit";
import type { CorpusFs } from "../fs/ports.ts";
import { accountTokens, type Coverage, coverageOf } from "./account.ts";
import {
  deriveFile,
  type FileDerivations,
  type MarkedToken,
} from "./derive.ts";
import type { Dictionary } from "../dictionary/types.ts";
import {
  canonicalSpellingViolations,
  dictionaryViolations,
} from "../dictionary/expand.ts";
import {
  overridesOf,
  overrideViolation,
  wordMarkupViolation,
} from "../dictionary/resolve.ts";
import { shardOf } from "../dictionary/shards.ts";
import {
  type DictionarySnapshot,
  readDictionarySnapshot,
} from "../dictionary/snapshot.ts";
import type { ValidationCache } from "./cache.ts";
import {
  authorViolations,
  borrowedViolations,
  createCrossFileIndex,
  layoutViolations,
  slugOwners,
  stubViolations,
} from "./crossFile.ts";
import {
  authorIdentifiers,
  authorRequired,
  authorSchema,
  authorSexValues,
  blockSchema,
  identifierViolations,
  keyViolations,
  textIdentifiers,
  textSchema,
} from "./schema.ts";
import { borrowedRef, expectedId } from "../fs/paths.ts";

/** A corpus file, compiled standalone (borrowed children left unresolved). */
export type CorpusFile = {
  /** Path relative to `data/`, e.g. "works/hume/thn/1739-40.mit". */
  path: string;
  text: string;
  doc: MarkitDocument;
  errors: MarkitError[];
  /** The register-independent derivations (see derive.ts), computed once per
   * compile so the rules that would otherwise re-tokenize or re-format the
   * whole corpus on every run read them instead. */
  derived: FileDerivations;
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

/** What a rule reports: a `Violation` minus its `rule` name, which the runner
 * (`validateCorpus`) stamps from the rule it ran — so a rule never repeats its
 * own name and a typo can't mislabel a violation. */
export type RuleViolation = Omit<Violation, "rule">;

/** What a rule needs: the compiled files plus filesystem access for the rules
 * that check resolution and layout. `root` is the corpus root (holds `data/`). */
export type RuleContext = {
  files: CorpusFile[];
  fs: CorpusFs;
  root: string;
  /** A dictionary already read for this pass. Supplied by the Compositor so one
   * save reads, parses, and expands the shards once across every tier and the
   * catalogue build; omitted, the rules read it themselves and memoize it on the
   * context (see `dictionaryOf`). */
  dictionary?: DictionarySnapshot;
  /** Memos for the fixed reference files (see cache.ts). Supplied by a long-lived
   * caller; omitted, they are read and parsed afresh each pass. */
  cache?: ValidationCache;
};

export type Rule = {
  name: string;
  check: (ctx: RuleContext) => RuleViolation[] | Promise<RuleViolation[]>;
};

/** Run every rule and collect the violations, in rule order, stamping each with
 * the name of the rule that produced it. The doc-free tiers below
 * (`validateFile`/`validateCrossFile`/`validateWordAndOverride`/
 * `validateDictionary`) recompose to the same set from persisted projections. */
export const validateCorpus = (ctx: RuleContext): Promise<Violation[]> =>
  runRules(rules, ctx);

const everyFileCompiles: Rule = {
  name: "every file compiles without errors",
  check: ({ files }) =>
    files.flatMap(({ path, errors }) =>
      errors.map((e) => ({
        path,
        message: e.message,
        line: e.source.start.line + 1,
        column: e.source.start.column + 1,
        endLine: e.source.end.line + 1,
        endColumn: e.source.end.column + 1,
        severity: e.severity,
      }))
    ),
};

const everyFileFormatted: Rule = {
  name: "every file is formatted canonically",
  check: ({ files }) =>
    files
      .filter(({ derived }) => !derived.formatted)
      .map(({ path }) => ({
        path,
        message: "differs from formatter output (run `npm run fix`)",
      })),
};

const authorFilesMatchSchema: Rule = {
  name: "author files match the author schema",
  check: ({ files }) => {
    const violations: RuleViolation[] = [];
    for (const { path, doc } of cleanlyCompiled(authorFiles(files))) {
      const metadata = meta(doc.metadata);
      const line = metaLine(doc);
      const push = (message: string, at = line) =>
        violations.push({ path, message, line: at });
      for (const message of keyViolations(metadata, authorSchema)) {
        push(message);
      }
      for (const message of identifierViolations(metadata, authorIdentifiers)) {
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
};

const textsMatchSchema: Rule = {
  name: "texts match the text schema",
  check: ({ files }) => {
    const violations: RuleViolation[] = [];
    for (const { path, doc } of cleanlyCompiled(workFiles(files))) {
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
        const line = metaLine(text);
        const push = (message: string) =>
          violations.push({ path, locus, message, line });
        for (const message of keyViolations(metadata, textSchema)) {
          push(message);
        }
        for (const message of identifierViolations(metadata, textIdentifiers)) {
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
        // Each stub-sensitive key belongs on exactly one side of the stub
        // divide: `canonical`/`standalone` are the stub's own identity and
        // belong only there; `dictionary` overrides and the derived `published`
        // year mean nothing on a metadata-only stub and belong only off it. A
        // key on the wrong side is a placement violation.
        for (const { key, onStub, message } of stubKeyPlacement) {
          if (key in metadata && stub !== onStub) push(message);
        }
      }
    }
    return violations;
  },
};

const workStubsNameCanonical: Rule = {
  name: "work stubs name a canonical edition that exists",
  check: async (ctx) =>
    (await Promise.all(
      projectionsOf(ctx).map((p) => stubViolations(p, ctx.fs, ctx.root)),
    )).flat(),
};

const blockMetadataMatchesSchema: Rule = {
  name: "block metadata matches the block schema",
  check: ({ files }) => {
    const violations: RuleViolation[] = [];
    for (const { path, doc } of cleanlyCompiled(workFiles(files))) {
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
              path,
              locus: `(${text.id} {#${block.id}})`,
              message,
              line: metaLine(block),
            });
          }
        }
      }
    }
    return violations;
  },
};

const everyAuthorsSlugKnown: Rule = {
  name: "every authors slug names a known author",
  check: (ctx) => {
    const owners = slugOwners(projectionsOf(ctx));
    return projectionsOf(ctx).flatMap((p) => authorViolations(p, owners));
  },
};

const rootIdsMatchPaths: Rule = {
  name: "root IDs match file paths",
  check: ({ files }) =>
    cleanlyCompiled(files)
      .filter(
        ({ path, doc }) =>
          doc.id.toLowerCase() !== expectedId(path).toLowerCase(),
      )
      .map(({ path, doc }) => ({
        path,
        message: `root ID is "${doc.id}", expected "${expectedId(path)}"`,
        line: lineOf(doc.source),
      })),
};

const sectionHeadingsBare: Rule = {
  name: "section headings are bare segments",
  check: ({ files }) => {
    const violations: RuleViolation[] = [];
    for (const { path, doc } of cleanlyCompiled(workFiles(files))) {
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
            path,
            message: `heading "${segment}" should be a bare segment (no dots)`,
            line: lineOf(text.source),
          });
        }
      }
    }
    return violations;
  },
};

const borrowedChildrenResolve: Rule = {
  name: "borrowed-child references resolve to an edition",
  check: async (ctx) =>
    (await Promise.all(
      projectionsOf(ctx).map((p) => borrowedViolations(p, ctx.fs, ctx.root)),
    )).flat(),
};

const layoutConventions: Rule = {
  name: "layout: lowercase names, index.mit in every directory",
  check: ({ files, fs, root }) =>
    layoutViolations(fs, root, authorSlugs(files)),
};

// The structural tier of the dictionary validation (see ../README.md):
// shards parse, keys are folded words in the right shard in order, values are
// well-formed — and, when all of that holds, each shard is byte-for-byte
// canonical.
const dictionaryShardsWellFormed: Rule = {
  name: "dictionary shards are well-formed",
  check: async (ctx) => {
    const snapshot = await dictionaryOf(ctx);
    const { shards, problems } = snapshot;
    const violations: RuleViolation[] = problems.map((problem) => ({
      path: `dictionary/${problem.shard}`,
      ...(problem.key !== undefined ? { locus: `"${problem.key}"` } : {}),
      message: problem.message,
    }));
    // The formatting comparison only means anything once the shards parse
    // cleanly; skip it to avoid cascading noise.
    if (violations.length > 0) return violations;
    const canonical = snapshot.canonical();
    for (const [shard, text] of shards) {
      const want = canonical.get(shard);
      if (want === undefined) {
        violations.push({
          path: `dictionary/${shard}`,
          message: "empty shard file (run `deno task fmt` to remove it)",
        });
      } else if (want !== text) {
        violations.push({
          path: `dictionary/${shard}`,
          message: "not canonically formatted (run `deno task fmt`)",
        });
      }
    }
    return violations;
  },
};

// The referential tier, within the register: closed under derivation —
// cross-references and lemmas resolve, expanded readings are distinct and
// selectable (see resolve.ts/expand.ts, dictionaryViolations). Skipped while
// the shards themselves have problems — dropped entries would dangle
// spuriously.
const dictionaryReadingsResolve: Rule = {
  name: "dictionary readings resolve within the register",
  check: async (ctx) => {
    const { dictionary, problems } = await dictionaryOf(ctx);
    if (problems.length > 0) return [];
    return dictionaryViolations(dictionary).map(({ key, message }) => ({
      path: `dictionary/${shardOf(key)}`,
      locus: `"${key}"`,
      message,
    }));
  },
};

// The canonical-spelling rule (see ../DICTIONARY.md, Principles of
// Normalisation): within a normalisation class the canonical spelling must be
// the one an external authority endorses — a fixed, version-pinned modern
// reference word list (data/reference/words.txt, from SCOWL) — several matches
// or ties broken alphabetically, gaps pinned in canonical-exceptions.json.
// External and fixed, so the choice never drifts as the corpus grows. Skipped
// while the shards have structural problems or the reference list is absent
// (nothing to check against).
const canonicalSpellingMatches: Rule = {
  name: "canonical spelling matches the reference word list",
  check: async (ctx) => {
    const { dictionary, problems } = await dictionaryOf(ctx);
    if (problems.length > 0) return [];
    const wordlist = await referenceWordsOf(ctx);
    if (wordlist === null) return [];
    const exceptions = await canonicalExceptionsOf(ctx);
    return canonicalSpellingViolations(dictionary, wordlist, exceptions).map(
      ({ key, message }) => ({
        path: `dictionary/${shardOf(key)}`,
        locus: `"${key}"`,
        message,
      }),
    );
  },
};

// Still the referential tier: every `[w:surface=value]` in the texts obeys the
// dictionary (see resolve.ts, wordMarkupViolation) — checked against the
// expanded readings, so inherited ambiguity counts.
const wordMarkupSelectsReading: Rule = {
  name: "word markup selects a dictionary reading",
  check: async (ctx) =>
    wordMarkupViolationsFrom(
      ctx.files.map((f) => ({
        path: f.path,
        clean: f.errors.length === 0,
        marked: f.derived.marked,
      })),
      (await dictionaryOf(ctx)).expanded(),
    ),
};

// Still the referential tier: every `[metadata.dictionary]` override obeys the
// dictionary (see resolve.ts, overrideViolation) — the same selection rule as
// `[w:]` markup, stated once per edition (or section) instead of per occurrence.
const dictionaryOverridesSelect: Rule = {
  name: "dictionary overrides select a reading",
  check: async (ctx) =>
    overrideViolationsFrom(
      projectionsOf(ctx),
      (await dictionaryOf(ctx)).expanded(),
    ),
};

/** Every corpus rule, in the order `validateCorpus` runs them. */
export const rules: Rule[] = [
  everyFileCompiles,
  everyFileFormatted,
  authorFilesMatchSchema,
  textsMatchSchema,
  workStubsNameCanonical,
  blockMetadataMatchesSchema,
  everyAuthorsSlugKnown,
  rootIdsMatchPaths,
  sectionHeadingsBare,
  borrowedChildrenResolve,
  layoutConventions,
  dictionaryShardsWellFormed,
  dictionaryReadingsResolve,
  canonicalSpellingMatches,
  wordMarkupSelectsReading,
  dictionaryOverridesSelect,
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
  const { dictionary } = await dictionaryOf(ctx);
  const totals: Coverage = { total: 0, accounted: 0, unaccounted: 0 };
  const byWork = new Map<string, Coverage>();
  for (const { path, doc } of cleanlyCompiled(workFiles(ctx.files))) {
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
      files.push({ path, text, doc, errors, derived: deriveFile(text, doc) });
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
export const violationText = (v: RuleViolation): string =>
  v.column !== undefined && v.line !== undefined
    ? `${v.path}:${v.line}:${v.column}: ${v.message}`
    : `${v.path}${v.locus === undefined ? "" : ` ${v.locus}`}: ${v.message}`;

/* -------------------- doc-free validation tiers --------------------- */

/*
 * The same rules, partitioned by data dependency so validation never needs the
 * whole corpus resident as positioned documents (see COMPOSITOR_MEMORY_PLAN.md).
 * A file is reduced once to two persistable products — its register-independent
 * `derived` (derive.ts) and its `FileProjection` (below) — and the rules then
 * fall into four tiers:
 *
 *   - per-file      (validateFile): compile, formatting, and the schema/
 *                    structure rules — a single file's own `doc`/`errors`/
 *                    `derived`, so an edit re-runs only over the edited file.
 *   - dict-dependent (validateWordAndOverride): `[w:]` markup and overrides,
 *                    read off `derived.marked` + the projection's `overrides`
 *                    against the current dictionary — no documents.
 *   - cross-file    (validateCrossFile): unknown-author, work-stub canonical,
 *                    borrowed children, and layout — over the projections + fs.
 *   - dictionary    (validateDictionary): the shard/reference rules — fs only.
 *
 * `validateCorpus` still runs the flat `rules` list (the Deno wrapper and the
 * full-corpus test are its guard); the tiers recompose to the same violations
 * (guarded by tests/project.test.ts) but let the Compositor validate a body-
 * free resident corpus and re-validate incrementally.
 */

/**
 * A file's projection: the small, register-independent facts the cross-file and
 * override rules need, extracted in one document walk so those rules can run
 * without the positioned document resident. Persisted beside the derivations
 * (build/derivations.ts). Lines are as the rules emit them (1-based, or the
 * 0-based-block line the marked-token rule offsets itself).
 */
export type FileProjection = {
  /** Path relative to `data/`. */
  path: string;
  /** Whether the file compiled without errors — the rules skip the rest. */
  clean: boolean;
  /** For an author file (`authors/<slug>.mit`): its slug; else undefined. */
  authorSlug?: string;
  /** Author slugs declared by texts and blocks, in document order, each with
   * the fully-formed locus and line its unknown-author violation would carry. */
  declaredAuthors: { slug: string; locus: string; line?: number }[];
  /** Work-stub facts (an `index.mit` carrying a `canonical` pointer), else
   * undefined — the identity a stub is checked against. */
  stub?: {
    /** `metadata.canonical` when a string (else the schema rule reports the
     * type and the stub rule defers). */
    canonical?: string;
    dir: string;
    line?: number;
    hasBody: boolean;
    bodyLine?: number;
  };
  /** Borrowed-child references (`<Author.Work.Edition>`), in document order. */
  borrowedRefs: { ref: string; textId: string; line?: number }[];
  /** `[metadata.dictionary]` overrides per text, in document order. */
  overrides: {
    textId: string;
    line?: number;
    entries: [string, string][];
  }[];
};

/** Project one compiled file (see FileProjection): one document walk, no
 * dictionary or filesystem access, so it is stable across dictionary edits. */
export const projectFile = (file: CorpusFile): FileProjection => {
  const { path, doc, errors } = file;
  const projection: FileProjection = {
    path,
    clean: errors.length === 0,
    declaredAuthors: [],
    borrowedRefs: [],
    overrides: [],
  };
  if (path.startsWith("authors/")) {
    projection.authorSlug = path.slice("authors/".length, -".mit".length);
    return projection;
  }
  if (!path.startsWith("works/")) return projection;
  if (isStub(path, doc)) {
    const canonical = meta(doc.metadata).canonical;
    projection.stub = {
      ...(typeof canonical === "string" ? { canonical } : {}),
      dir: path.slice(0, path.lastIndexOf("/")),
      line: metaLine(doc),
      hasBody: doc.blocks.length > 0 || doc.children.length > 0,
      bodyLine: lineOf(doc.children[0]?.source) ??
        lineOf(doc.blocks[0]?.source),
    };
  }
  for (const { text, ancestors } of allTexts(doc)) {
    const parent = ancestors[ancestors.length - 1];
    const ref = borrowedRef(headingSegment(text.id, parent?.id));
    if (ref !== undefined) {
      projection.borrowedRefs.push({
        ref,
        textId: text.id,
        line: lineOf(text.source),
      });
    }
    for (const slug of authorsOf(meta(text.metadata).authors)) {
      projection.declaredAuthors.push({
        slug,
        locus: `(${text.id})`,
        line: metaLine(text),
      });
    }
    for (const block of text.blocks) {
      if (block.metadata === undefined) continue;
      for (const slug of authorsOf(meta(block.metadata).authors)) {
        projection.declaredAuthors.push({
          slug,
          locus: `(${text.id}) {#${block.id}}`,
          line: metaLine(block),
        });
      }
    }
    const overrides = Object.entries(overridesOf(text.metadata));
    if (overrides.length > 0) {
      projection.overrides.push({
        textId: text.id,
        line: metaLine(text, "dictionary"),
        entries: overrides,
      });
    }
  }
  return projection;
};

/** Project every file, in order. */
export const projectCorpus = (files: CorpusFile[]): FileProjection[] =>
  files.map(projectFile);

/** The projections for a rule context, memoized so the cross-file rules share
 * one walk (as the dictionary rules share one dictionary read). */
const projectionCache = new WeakMap<RuleContext, FileProjection[]>();
const projectionsOf = (ctx: RuleContext): FileProjection[] => {
  let cached = projectionCache.get(ctx);
  if (cached === undefined) {
    projectionCache.set(ctx, cached = projectCorpus(ctx.files));
  }
  return cached;
};

/** The known author slugs of a projection set (every author file's slug, clean
 * or not — the layout/unknown-author rules check against all of them). */

/* -- the cross-file / dict-dependent rule cores, over projections -- */

/** One `[w:]`-marked-token entry the word-markup rule consumes: a file's marked
 * tokens (from `derived`) with whether it compiled cleanly. */
export type MarkedEntry = {
  path: string;
  clean: boolean;
  marked: MarkedToken[];
};

const wordMarkupViolationsFrom = (
  entries: Iterable<MarkedEntry>,
  dictionary: Dictionary,
): RuleViolation[] => {
  const violations: RuleViolation[] = [];
  for (const { path, clean, marked } of entries) {
    if (!clean || !path.startsWith("works/")) continue;
    // A `[w:]` surface is exactly one token (a Markit compile rule), so the
    // marked occurrences are the tokens carrying a word value — read from the
    // per-compile derivations rather than re-tokenized here.
    for (const m of marked) {
      const message = wordMarkupViolation(m.folded, m.word, dictionary);
      if (message !== undefined) {
        violations.push({
          path,
          locus: `(${m.textId})`,
          message,
          line: m.line === undefined ? undefined : m.line + 1,
        });
      }
    }
  }
  return violations;
};

const overrideViolationsFrom = (
  entries: Iterable<Pick<FileProjection, "path" | "clean" | "overrides">>,
  dictionary: Dictionary,
): RuleViolation[] => {
  const violations: RuleViolation[] = [];
  for (const { path, clean, overrides } of entries) {
    if (!clean || !path.startsWith("works/")) continue;
    for (const { textId, line, entries: pairs } of overrides) {
      for (const [surface, value] of pairs) {
        const message = overrideViolation(surface, value, dictionary);
        if (message !== undefined) {
          violations.push({ path, locus: `(${textId})`, message, line });
        }
      }
    }
  }
  return violations;
};

/* ------------------- the tiered public entry points ------------------- */

/** Run a subset of the rules over a context, stamping each violation with its
 * rule name (the shared runner behind `validateCorpus` and the tiers). */
const runRules = async (
  subset: Rule[],
  ctx: RuleContext,
): Promise<Violation[]> => {
  const violations: Violation[] = [];
  for (const rule of subset) {
    const found = await rule.check(ctx);
    violations.push(...found.map((v) => ({ ...v, rule: rule.name })));
  }
  return violations;
};

/** The per-file rules: a single file's own compile/format/schema/structure
 * violations, needing neither the rest of the corpus nor the dictionary. */
const FILE_RULES: Rule[] = [
  everyFileCompiles,
  everyFileFormatted,
  authorFilesMatchSchema,
  textsMatchSchema,
  blockMetadataMatchesSchema,
  rootIdsMatchPaths,
  sectionHeadingsBare,
];

/** The dictionary rules: the shard/reference tier, from disk (no documents). */
const DICTIONARY_RULES: Rule[] = [
  dictionaryShardsWellFormed,
  dictionaryReadingsResolve,
  canonicalSpellingMatches,
];

/** Validate one compiled file against the per-file tier — the rules an edit to
 * that file can change, re-run over just it. */
export const validateFile = (
  file: CorpusFile,
  ctx: { fs: CorpusFs; root: string },
): Promise<Violation[]> =>
  runRules(FILE_RULES, { files: [file], fs: ctx.fs, root: ctx.root });

/** What the doc-free tiers need beyond the corpus root: the filesystem, plus
 * (optionally) a dictionary already read for this pass and the memos for the
 * fixed reference files. A long-lived caller supplies both so one pass over the
 * corpus costs one read of each; a one-shot build supplies neither. */
export type TierContext = {
  fs: CorpusFs;
  root: string;
  dictionary?: DictionarySnapshot;
  cache?: ValidationCache;
};

/** The dictionary tier: the shard/reference rules, over the shards on disk. */
export const validateDictionary = (ctx: TierContext): Promise<Violation[]> =>
  runRules(DICTIONARY_RULES, { ...ctx, files: [] });

/** The cross-file tier: the rules over the whole corpus's projections plus the
 * filesystem (unknown authors, work-stub canonicals, borrowed children,
 * layout) — no documents. */
export const validateCrossFile = (
  projections: FileProjection[],
  ctx: { fs: CorpusFs; root: string },
): Promise<Violation[]> => createCrossFileIndex(ctx).reset(projections);

/** The dict-dependent tier: `[w:]` markup and `[metadata.dictionary]` overrides
 * against the current dictionary snapshot, read off each file's marked tokens and
 * projected overrides — the two rules a dictionary edit re-runs with no
 * document recompile. */
export const validateWordAndOverride = (
  entries: Iterable<MarkedEntry & Pick<FileProjection, "overrides">>,
  dictionary: DictionarySnapshot,
): Violation[] => {
  const expanded = dictionary.expanded();
  const list = [...entries];
  const stamp = (name: string, found: RuleViolation[]): Violation[] =>
    found.map((v) => ({ ...v, rule: name }));
  return [
    ...stamp(
      wordMarkupSelectsReading.name,
      wordMarkupViolationsFrom(list, expanded),
    ),
    ...stamp(
      dictionaryOverridesSelect.name,
      overrideViolationsFrom(list, expanded),
    ),
  ];
};

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

/** The dictionary read from disk and parsed once per context: the raw shard
 * text (for the formatting check), the parsed dictionary, its derived products,
 * and any structural problems. A caller that has already read it (the
 * Compositor, once per save) supplies it on the context; otherwise it is read
 * here and memoized on the context, so the six rules (and the coverage report)
 * that need it share a single read + parse rather than repeating both. */
const dictionaryCache = new WeakMap<
  RuleContext,
  Promise<DictionarySnapshot>
>();

/** The reference word list for this pass, through the context's memo when it has
 * one — the parse rebuilds a ~106k-entry Set, and the Compositor runs a pass per
 * save. */
const referenceWordsOf = (ctx: RuleContext): Promise<Set<string> | null> =>
  ctx.cache !== undefined
    ? ctx.cache.referenceWords(ctx.fs, ctx.root)
    : loadReferenceWords(ctx.fs, ctx.root);

const canonicalExceptionsOf = (ctx: RuleContext): Promise<Set<string>> =>
  ctx.cache !== undefined
    ? ctx.cache.canonicalExceptions(ctx.fs, ctx.root)
    : loadCanonicalExceptions(ctx.fs, ctx.root);

const dictionaryOf = (ctx: RuleContext): Promise<DictionarySnapshot> => {
  if (ctx.dictionary !== undefined) return Promise.resolve(ctx.dictionary);
  let cached = dictionaryCache.get(ctx);
  if (cached === undefined) {
    dictionaryCache.set(ctx, cached = readDictionarySnapshot(ctx.fs, ctx.root));
  }
  return cached;
};

/** Metadata viewed as plain entries (folds the absent case to `{}`). */
const meta = (value: unknown): Record<string, unknown> =>
  (value ?? {}) as Record<string, unknown>;

/** The 1-based line a source range starts on (ranges come from
 * `compileWithPositions` — see `loadCorpus`). */
const lineOf = (source: SourceRange | undefined): number | undefined =>
  source === undefined ? undefined : source.start.line + 1;

/** The line a metadata violation anchors to on a text or content block: the
 * `[metadata.<key>]` sub-block when `key` is given and present, else the whole
 * `[metadata]` block, else the node's own opening line. Prefers the metadata
 * range because that is where the reader fixes the violation. */
const metaLine = (
  node: { metadataSource?: MetadataSource; source?: SourceRange },
  key?: string,
): number | undefined =>
  (key === undefined
    ? undefined
    : lineOf(node.metadataSource?.nested?.[key])) ??
    lineOf(node.metadataSource?.source) ?? lineOf(node.source);

const authorFiles = (files: CorpusFile[]): CorpusFile[] =>
  files.filter((f) => f.path.startsWith("authors/"));

const workFiles = (files: CorpusFile[]): CorpusFile[] =>
  files.filter((f) => f.path.startsWith("works/"));

/** Files that compile cleanly; schema/structure rules skip the rest to avoid
 * cascading noise — the compile rule already reports them. */
const cleanlyCompiled = (list: CorpusFile[]): CorpusFile[] =>
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

/** Which side of the stub divide each stub-sensitive metadata key belongs on
 * (see `textsMatchSchema`): `onStub` true for a key that belongs only on the
 * work stub, false for one that belongs only off it. `message` is the violation
 * raised when the key appears on the wrong side. */
const stubKeyPlacement: { key: string; onStub: boolean; message: string }[] = [
  {
    key: "canonical",
    onStub: true,
    message: `"canonical" belongs only on a work's index.mit stub`,
  },
  {
    key: "standalone",
    onStub: true,
    message: `"standalone" belongs only on a work's index.mit stub`,
  },
  {
    key: "dictionary",
    onStub: false,
    message: `"dictionary" does not belong on a work's index.mit stub`,
  },
  {
    key: "published",
    onStub: false,
    message: `"published" is derived from editions, not set on the stub`,
  },
  // ESTC describes a printed item and TCP a transcription of one; a work is
  // abstracted from any particular printing, so neither belongs on its stub.
  {
    key: "estc",
    onStub: false,
    message: `"estc" belongs on an edition, not on a work's index.mit stub`,
  },
  {
    key: "tcp",
    onStub: false,
    message: `"tcp" belongs on an edition, not on a work's index.mit stub`,
  },
];

/** Slugs named by an `authors` value (text or block level), if any. */
const authorsOf = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((s): s is string => typeof s === "string")
    : [];
