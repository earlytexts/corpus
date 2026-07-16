/**
 * Markup hints: the Compositor's suggestion engine — lexicons mined from the
 * markup the corpus already carries, and a scanner that proposes likely new
 * markup in raw `.mit` source. The corpus is its own training data — every
 * `[p:…]` person, `[…]` citation, and `$xx:…$` language span already marked up
 * teaches the scanner what to look for — so suggestions improve as markup
 * accumulates. Pure logic, editor-free (commands/suggestMarkup.ts wires it to
 * VSCode); it reads the compiled catalogue and the wire types the corpus owns,
 * but the read-side text processing lives here, not in the corpus.
 *
 * The English-homograph problem (Latin/French words that are also English
 * words: "in", "me", "point") is solved by the corpus too. Its unmarked text
 * is overwhelmingly English, so a marked word's frequency in unmarked text
 * measures its English-ness: words rare outside language spans are STRONG
 * evidence on their own; common ones are WEAK and only ever match as part of
 * a cluster anchored by a strong word. A small per-language override table
 * patches the residue; it is a fallback, not the mechanism.
 *
 * Two halves, both pure:
 *  - buildHints: one walk over the compiled catalogue, producing phrase
 *    lexicons for people (seeded from author metadata) and citations (seeded
 *    from work titles), and a strong/weak word lexicon per language code.
 *    Generic `$…$` spans carry no language code and are ignored — in practice
 *    they mark symbols and other non-language material.
 *  - scanSource: run Markit's own tokenizer over a positioned compile of the
 *    file (so word identity is Markit's — the same `~` joins, page-break and
 *    editorial transparency the whole pipeline shares), drop the tokens
 *    already inside markup, place the rest by their source spans, and report
 *    matches as ranges in that source, ready to become editor diagnostics.
 *    Greek needs no lexicon: Greek-script tokens match outright.
 *
 * Positions are 0-based (lines and columns), end-exclusive — the shape a
 * VSCode Range wants; the corpus's own display convention is 1-based.
 *
 * Reads top-down: tuning constants and public types, then each half's entry
 * point followed by its helpers (mining, then matching, then the source
 * tokens), with the word-folding foundation both halves share at the bottom.
 */

import {
  type Block,
  type BlockElement,
  type Extraction,
  extractText,
  type Frame,
  type InlineElement,
  type List,
  type MarkitDocument,
  tokenize,
  wordPattern,
} from "@jsr/earlytexts__markit";
import type { Catalogue, Work } from "@earlytexts/corpus";

/* ------------------------- tuning constants --------------------------- */

/** Words shorter than this (after folding) carry no signal and are dropped —
 * from lexicons and token streams alike, so phrase matching stays aligned. */
const MIN_WORD_LENGTH = 2;

/** A marked word stays strong while its unmarked occurrences are at most this
 * many — an absolute floor, so thin corpora still classify sensibly. */
const STRONG_UNMARKED_FLOOR = 4;

/** …or while unmarked occurrences are at most this multiple of marked ones
 * (unmarked text includes not-yet-marked foreign passages, so a foreign word
 * may appear "unmarked" without being English). */
const STRONG_MARKED_RATIO = 2;

/** A cluster of at least this many lexicon words can match. */
const CLUSTER_MIN_WORDS = 2;

/** A lone strong word must be at least this long to match by itself. */
const SINGLETON_MIN_LENGTH = 4;

const LETTER = /\p{L}/u;
const GREEK_CHAR = /[\u0370-\u03ff\u1f00-\u1fff]/u;

/** The markup kinds whose content is already marked up (or, for `word`,
 * already disambiguated by `[w:]`): their tokens are never suggestion or
 * squiggle material. */
const EXEMPT_FRAMES: ReadonlySet<string> = new Set([
  "person",
  "place",
  "org",
  "citation",
  "language",
  "word",
]);

/** Likely citation locators, matched against markup-masked source lines.
 * Mined from the corpus's existing citation spans ("Sect. II.", "Fig. 3.",
 * "Lib. ii. Cap. 4."). Case-sensitive where the lowercase word is English. */
const CITATION_PATTERNS: RegExp[] = [
  /\b(?:Sect|Sec|Chap|Lib|Cap|Vol|Fig|Art|Ess|Epist|Serm|No)\.\s*[IVXLCDMivxlcdm\d]+\b\.?/gu,
  /\b(?:Part|Book|Chapter|Section|Volume)\s+[IVXLCDM\d]+\b\.?/gu,
  /\b[Ii]bid\.(?:\s*p\.?\s*\d+)?/gu,
];

/** A citation cue: the capitalised run after it (the group) is the candidate. */
const CITATION_CUE =
  /\b(?:See|Vid\.?|Vide)\s+([A-Z][\p{L}'’]*(?:\s+[A-Z][\p{L}'’]*){0,5})/gu;

/** Inline formatting wrappers a name/citation/foreign phrase is often set in
 * (italics, small-caps); the match is widened back over them so the markup
 * encloses the wrapper (`[p:_Machiavel_]`, not `_[p:Machiavel]_`). */
const FORMAT_DELIMS = new Set(["_", "*"]);

/* -------------------------------- types -------------------------------- */

/** One language's mined vocabulary, split by evidential weight. */
export type LanguageLexicon = {
  /** Words that are strong evidence of the language on their own. */
  strong: Set<string>;
  /** English homographs: they match only inside a strong-anchored cluster. */
  weak: Set<string>;
};

/** Folded phrases for exact matching: first word → full word sequences
 * starting with it, longest first (so the longest match wins). */
export type PhraseLexicon = Map<string, string[][]>;

/** Everything the scanner needs, mined from the compiled catalogue. */
export type Hints = {
  people: PhraseLexicon;
  places: PhraseLexicon;
  orgs: PhraseLexicon;
  citations: PhraseLexicon;
  /** Keyed by lowercase ISO 639 code ("la", "fr", "grc", …). */
  languages: Map<string, LanguageLexicon>;
};

/** Manual patches to one language's classification (folded words). */
export type LanguageOverrides = {
  strong?: string[];
  weak?: string[];
  ignore?: string[];
};

export type HintOverrides = Record<string, LanguageOverrides>;

/** A proposed piece of markup, as a range in the scanned source. Lines and
 * columns are 0-based; the end is exclusive. */
export type MarkupSuggestion = {
  type: "person" | "place" | "org" | "citation" | "language";
  /** The language code, for language suggestions. */
  lang?: string;
  /** The matched source text, verbatim (it may contain markup the match is
   * transparent to, e.g. page breaks and editorial insertions). */
  text: string;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
};

/* ------------------------------ buildHints ----------------------------- */

/**
 * Mine the compiled catalogue for markup hints. One walk collects the marked
 * phrases and per-language word counts alongside the unmarked (English) word
 * frequencies; the language lexicons are then classified strong/weak against
 * those frequencies (see the header). People are seeded from author metadata
 * and citations from work titles, so both are useful before any spans exist.
 */
export const buildHints = (
  catalogue: Catalogue,
  overrides: HintOverrides = {},
): Hints => {
  const people: PhraseLexicon = new Map();
  const places: PhraseLexicon = new Map();
  const orgs: PhraseLexicon = new Map();
  const citations: PhraseLexicon = new Map();
  const langCounts = new Map<string, Map<string, number>>();
  const unmarked = new Map<string, number>();
  const unmarkedLower = new Map<string, number>();

  const sink: HintSink = {
    language: (lang, text) => {
      const code = lang.toLowerCase();
      const counts = langCounts.get(code) ?? new Map<string, number>();
      langCounts.set(code, counts);
      for (const word of words(text)) {
        counts.set(word, (counts.get(word) ?? 0) + 1);
      }
    },
    person: (text) => addPhrase(people, text),
    place: (text) => addPhrase(places, text),
    org: (text) => addPhrase(orgs, text),
    citation: (text) => addPhrase(citations, text),
    unmarked: (text) => {
      for (const match of text.matchAll(wordPattern)) {
        const folded = foldWord(match[0]);
        if (!keepWord(folded)) continue;
        unmarked.set(folded, (unmarked.get(folded) ?? 0) + 1);
        if (!/^\p{Lu}/u.test(match[0])) {
          unmarkedLower.set(folded, (unmarkedLower.get(folded) ?? 0) + 1);
        }
      }
    },
  };
  for (const doc of allDocs(catalogue)) {
    for (const block of doc.blocks) {
      for (const run of block.content.flatMap(inlineRuns)) {
        walkInline(run, sink);
      }
    }
  }

  const seenWorks = new Set<Work>();
  for (const author of catalogue.authors) {
    addPhrase(people, `${author.forename} ${author.surname}`.trim());
    addPhrase(people, author.surname);
    if (author.title !== undefined) addPhrase(people, author.title);
    for (const work of author.works) {
      if (seenWorks.has(work)) continue; // co-authored works list repeatedly
      seenWorks.add(work);
      addPhrase(citations, work.title);
    }
  }

  // A single-word phrase that is also an everyday lowercase word ("of",
  // "his" — citation wrappers sometimes mark bare anchor words, and names
  // can coincide with common nouns) would fire at every capitalised
  // occurrence, sentence starts included; drop it. A multi-word phrase keeps
  // its everyday words — the phrase as a whole is still distinctive.
  const pruneSingletons = (lexicon: PhraseLexicon): void => {
    for (const [head, seqs] of lexicon) {
      const kept = seqs.filter(
        (seq) =>
          seq.length > 1 ||
          (unmarkedLower.get(seq[0]!) ?? 0) <= STRONG_UNMARKED_FLOOR,
      );
      if (kept.length === 0) lexicon.delete(head);
      else lexicon.set(head, kept);
    }
  };
  pruneSingletons(people);
  pruneSingletons(places);
  pruneSingletons(orgs);
  pruneSingletons(citations);

  const languages = new Map<string, LanguageLexicon>();
  const lexiconFor = (code: string): LanguageLexicon => {
    const existing = languages.get(code);
    if (existing !== undefined) return existing;
    const fresh = { strong: new Set<string>(), weak: new Set<string>() };
    languages.set(code, fresh);
    return fresh;
  };
  for (const [code, counts] of langCounts) {
    const lexicon = lexiconFor(code);
    for (const [word, marked] of counts) {
      const u = unmarked.get(word) ?? 0;
      const strong =
        u <= STRONG_UNMARKED_FLOOR || u <= marked * STRONG_MARKED_RATIO;
      (strong ? lexicon.strong : lexicon.weak).add(word);
    }
  }
  // The patches run last so they win over the frequency rule; they may also
  // introduce words (or whole languages) never yet marked.
  for (const [code, patch] of Object.entries(overrides)) {
    const lexicon = lexiconFor(code.toLowerCase());
    for (const word of patch.strong ?? []) {
      lexicon.weak.delete(word);
      lexicon.strong.add(word);
    }
    for (const word of patch.weak ?? []) {
      lexicon.strong.delete(word);
      lexicon.weak.add(word);
    }
    for (const word of patch.ignore ?? []) {
      lexicon.strong.delete(word);
      lexicon.weak.delete(word);
    }
  }

  return { people, places, orgs, citations, languages };
};

/* --------------------------- the corpus walk --------------------------- */

type HintSink = {
  language: (lang: string, text: string) => void;
  person: (text: string) => void;
  place: (text: string) => void;
  org: (text: string) => void;
  citation: (text: string) => void;
  unmarked: (text: string) => void;
};

/** Every document in the catalogue, each once (borrowed children and
 * co-authored works share document objects across listings). */
const allDocs = (catalogue: Catalogue): MarkitDocument[] => {
  const seen = new Set<MarkitDocument>();
  const out: MarkitDocument[] = [];
  const add = (doc: MarkitDocument): void => {
    if (seen.has(doc)) return;
    seen.add(doc);
    out.push(doc);
    doc.children.forEach(add);
  };
  for (const author of catalogue.authors) {
    for (const work of author.works) {
      for (const edition of work.editions) add(edition.document);
    }
  }
  return out;
};

/**
 * Route each stretch of inline content to its bucket. Text inside a semantic
 * wrapper feeds that wrapper's lexicon only — person/place/org/citation content
 * is proper names, not evidence of English — and a language span without a code
 * feeds nothing (its content is unreliable either way). Places and orgs have no
 * metadata seed, so these spans are their only training signal.
 */
const walkInline = (elements: InlineElement[], sink: HintSink): void => {
  for (const el of elements) {
    if (el.type === "plainText") sink.unmarked(el.content);
    else if (el.type === "language") {
      if (el.lang !== undefined) sink.language(el.lang, inlineText(el.content));
    } else if (el.type === "person") sink.person(inlineText(el.content));
    else if (el.type === "place") sink.place(inlineText(el.content));
    else if (el.type === "org") sink.org(inlineText(el.content));
    else if (el.type === "citation") sink.citation(inlineText(el.content));
    else if ("content" in el && Array.isArray(el.content)) {
      walkInline(el.content, sink);
    }
  }
};

/** Every inline run of a block-level element. */
const inlineRuns = (element: BlockElement): InlineElement[][] => {
  if (element.type === "heading") {
    return element.content.map((line) => line.content);
  }
  if (element.type === "paragraph") return [element.content];
  if (element.type === "blockquote") {
    return element.content.flatMap((child) =>
      child.type === "paragraph" ? [child.content] : [],
    );
  }
  if (element.type === "list") return listRuns(element);
  if (element.type === "table") {
    return element.rows.flatMap((row) => row.cells.map((cell) => cell.content));
  }
  // Anything newer than the pinned markit (e.g. block-level stage directions)
  // holds a list of paragraphs; walk it like a blockquote.
  const { content } = element as { content?: { content?: InlineElement[] }[] };
  return (content ?? []).map((paragraph) => paragraph.content ?? []);
};

const listRuns = (list: List): InlineElement[][] =>
  list.items.flatMap((item) => [
    item.content,
    ...(item.nestedList === undefined ? [] : listRuns(item.nestedList)),
  ]);

/** The plain text of an inline run (spaces for breaks, markup unwrapped). */
const inlineText = (elements: InlineElement[]): string =>
  elements
    .map((el) => {
      if (el.type === "plainText") return el.content;
      if (el.type === "lineBreak" || el.type === "nbSpace") return " ";
      return "content" in el && Array.isArray(el.content)
        ? inlineText(el.content)
        : "";
    })
    .join("");

/* ------------------------------ scanSource ----------------------------- */

/**
 * Scan a `.mit` file's raw source for likely markup, returning suggestions as
 * source ranges (ready to become diagnostics). `document` must be the compile
 * (with positions) of THIS source (e.g. the compositor's per-file compile,
 * not the composed catalogue document, whose borrowed children live in other
 * files): tokens and text spans place themselves by their source spans, so
 * everything outside block content (text IDs, metadata, block tags) is never
 * scanned. Suggestions of every type are returned; callers filter.
 */
export const scanSource = (
  source: string,
  document: MarkitDocument,
  hints: Hints,
): MarkupSuggestion[] => {
  const lines = source.split("\n");
  const out: MarkupSuggestion[] = [];
  for (const block of collectBlocks(document)) {
    const extraction = extractText(block);
    // Words too short to carry signal are dropped from lexicons and token
    // streams alike (keepWord), so phrase matching stays aligned.
    const tokens = blockTokens(block, extraction, lines).filter((token) =>
      keepWord(token.folded),
    );
    const masked = maskedLines(block, extraction, lines);
    matchGreek(tokens, lines, out);
    matchLanguages(tokens, hints.languages, lines, out);
    matchPhrases(tokens, hints.people, "person", lines, out);
    matchPhrases(tokens, hints.places, "place", lines, out);
    matchPhrases(tokens, hints.orgs, "org", lines, out);
    // A title page never cites anything — least of all its own work's title,
    // which the citation lexicon is seeded with.
    if (block.type !== "title" && block.type !== "subtitle") {
      matchPhrases(tokens, hints.citations, "citation", lines, out);
      matchCitationPatterns(masked, lines, out);
    }
  }
  // Widen each match over the inline markup it sits in, then drop the
  // containment duplicates the widening may create, and order by position.
  return prune(out.map((s) => expandOverMarkup(lines, s))).sort(byPosition);
};

/**
 * Every non-exempt token of a compiled block as a source token — Markit's
 * word identity (`~` joins, page-break and editorial transparency included),
 * placed by its source span. Unfiltered: single-letter tokens included, so
 * the dictionary scan (dictionaryScan.ts) sees the whole stream (it re-folds
 * each token's `display` with the corpus's own folding to match the
 * register); `scanSource` drops the short ones itself. The block must come
 * from a compile (with positions) of THIS source.
 */
export const blockSourceTokens = (
  block: Block,
  lines: string[],
): SourceToken[] => blockTokens(block, extractText(block), lines);

/** Every block of the document and its (in-file) children, in source order. */
export const collectBlocks = (document: MarkitDocument): Block[] => {
  const out: Block[] = [];
  const walk = (doc: MarkitDocument): void => {
    out.push(...doc.blocks);
    doc.children.forEach(walk);
  };
  walk(document);
  return out.sort((a, b) => a.source!.start.line - b.source!.start.line);
};

/* ------------------------------- matching ------------------------------ */

/** Maximal runs of one language's lexicon words; a run matches when a strong
 * word anchors it (a lone strong word must also be long enough). */
const matchLanguages = (
  tokens: SourceToken[],
  languages: Map<string, LanguageLexicon>,
  lines: string[],
  out: MarkupSuggestion[],
): void => {
  for (const [lang, lexicon] of languages) {
    const member = (t: SourceToken): boolean =>
      lexicon.strong.has(t.folded) || lexicon.weak.has(t.folded);
    let i = 0;
    while (i < tokens.length) {
      if (!member(tokens[i]!)) {
        i++;
        continue;
      }
      let j = i;
      let anchored = false;
      while (j < tokens.length && member(tokens[j]!)) {
        anchored ||= lexicon.strong.has(tokens[j]!.folded);
        j++;
      }
      if (
        anchored &&
        (j - i >= CLUSTER_MIN_WORDS ||
          tokens[i]!.folded.length >= SINGLETON_MIN_LENGTH)
      ) {
        out.push(
          suggestion("language", lang, tokens[i]!, tokens[j - 1]!, lines),
        );
      }
      i = j;
    }
  }
};

/** Runs of Greek-script (or Greek-mode) tokens match with no lexicon. */
const matchGreek = (
  tokens: SourceToken[],
  lines: string[],
  out: MarkupSuggestion[],
): void => {
  let i = 0;
  while (i < tokens.length) {
    if (!tokens[i]!.greek) {
      i++;
      continue;
    }
    let j = i;
    while (j < tokens.length && tokens[j]!.greek) j++;
    out.push(suggestion("language", "grc", tokens[i]!, tokens[j - 1]!, lines));
    i = j;
  }
};

/** Longest capital-initial phrase match at each position. */
const matchPhrases = (
  tokens: SourceToken[],
  lexicon: PhraseLexicon,
  type: MarkupSuggestion["type"],
  lines: string[],
  out: MarkupSuggestion[],
): void => {
  let i = 0;
  while (i < tokens.length) {
    const first = tokens[i]!;
    const candidates = first.capital ? lexicon.get(first.folded) : undefined;
    let matched = 0;
    for (const seq of candidates ?? []) {
      if (seq.every((word, k) => tokens[i + k]?.folded === word)) {
        matched = seq.length;
        break;
      }
    }
    if (matched > 0) {
      out.push(
        suggestion(type, undefined, first, tokens[i + matched - 1]!, lines),
      );
      i += matched;
    } else i++;
  }
};

/** Citation locators and cue phrases, over the markup-masked lines (masked
 * characters are \0, so a pattern can never straddle existing markup). */
const matchCitationPatterns = (
  masked: Map<number, string>,
  lines: string[],
  out: MarkupSuggestion[],
): void => {
  const push = (num: number, at: number, length: number): void => {
    out.push({
      type: "citation",
      text: (lines[num] ?? "").slice(at, at + length),
      startLine: num,
      startColumn: at,
      endLine: num,
      endColumn: at + length,
    });
  };
  for (const [num, text] of masked) {
    for (const pattern of CITATION_PATTERNS) {
      for (const m of text.matchAll(pattern)) push(num, m.index, m[0].length);
    }
    for (const m of text.matchAll(CITATION_CUE)) {
      // The run is the tail of the whole match, so its offset is arithmetic.
      const run = m[1]!;
      push(num, m.index + m[0].length - run.length, run.length);
    }
  }
};

const suggestion = (
  type: MarkupSuggestion["type"],
  lang: string | undefined,
  first: SourceToken,
  last: SourceToken,
  lines: string[],
): MarkupSuggestion => ({
  type,
  ...(lang === undefined ? {} : { lang }),
  text: sliceRange(lines, first.line, first.start, last.line, last.end),
  startLine: first.line,
  startColumn: first.start,
  endLine: last.line,
  endColumn: last.end,
});

const sliceRange = (
  lines: string[],
  fromLine: number,
  fromCol: number,
  toLine: number,
  toCol: number,
): string =>
  fromLine === toLine
    ? (lines[fromLine] ?? "").slice(fromCol, toCol)
    : [
        (lines[fromLine] ?? "").slice(fromCol),
        ...lines.slice(fromLine + 1, toLine),
        (lines[toLine] ?? "").slice(0, toCol),
      ].join("\n");

/**
 * Widen a single-line suggestion to take in the inline formatting markup that
 * hugs or interleaves it, so italic/small-caps names and citations mark up
 * whole. Interior delimiters already ride along in the sliced text; this fixes
 * the edges. An edge delimiter is absorbed when it closes (or opens) a wrapper
 * left unbalanced inside the match — "Mr. *Pope" gains its trailing `*` — and a
 * balanced pair tightly hugging the match is absorbed together — "Machiavel"
 * gains the `_…_` around it. Multi-line matches (rare, and not name-shaped) are
 * left as they are.
 */
const expandOverMarkup = (
  lines: string[],
  s: MarkupSuggestion,
): MarkupSuggestion => {
  if (s.startLine !== s.endLine) return s;
  const line = lines[s.startLine] ?? "";
  let a = s.startColumn;
  let b = s.endColumn;
  const oddInside = (ch: string): boolean =>
    countChar(line.slice(a, b), ch) % 2 === 1;
  for (let changed = true; changed;) {
    changed = false;
    // A trailing delimiter that closes a wrapper opened inside the match.
    if (b < line.length && FORMAT_DELIMS.has(line[b]!) && oddInside(line[b]!)) {
      b++;
      changed = true;
    }
    // A leading delimiter that opens a wrapper closed inside the match.
    if (a > 0 && FORMAT_DELIMS.has(line[a - 1]!) && oddInside(line[a - 1]!)) {
      a--;
      changed = true;
    }
    // A balanced pair tightly wrapping the whole match ("_Machiavel_").
    if (
      a > 0 &&
      b < line.length &&
      line[a - 1] === line[b] &&
      FORMAT_DELIMS.has(line[a - 1]!) &&
      !oddInside(line[a - 1]!)
    ) {
      a--;
      b++;
      changed = true;
    }
  }
  return a === s.startColumn && b === s.endColumn
    ? s
    : { ...s, startColumn: a, endColumn: b, text: line.slice(a, b) };
};

const countChar = (text: string, ch: string): number => {
  let n = 0;
  for (const c of text) if (c === ch) n++;
  return n;
};

const byPosition = (a: MarkupSuggestion, b: MarkupSuggestion): number =>
  a.startLine - b.startLine ||
  a.startColumn - b.startColumn ||
  a.endLine - b.endLine ||
  a.endColumn - b.endColumn ||
  a.type.localeCompare(b.type) ||
  (a.lang ?? "").localeCompare(b.lang ?? "");

/** Drop a suggestion contained in another of the same type and language —
 * exact repeats (Greek matched by script and by lexicon at once) and partial
 * ones (a cue-phrase run inside a locator match) both collapse to one. */
const prune = (list: MarkupSuggestion[]): MarkupSuggestion[] =>
  list.filter(
    (s, i) =>
      !list.some((t, j) => {
        if (i === j || t.type !== s.type || (t.lang ?? "") !== (s.lang ?? "")) {
          return false;
        }
        const startsBefore =
          t.startLine < s.startLine ||
          (t.startLine === s.startLine && t.startColumn <= s.startColumn);
        const endsAfter =
          t.endLine > s.endLine ||
          (t.endLine === s.endLine && t.endColumn >= s.endColumn);
        if (!startsBefore || !endsAfter) return false;
        const equal =
          t.startLine === s.startLine &&
          t.startColumn === s.startColumn &&
          t.endLine === s.endLine &&
          t.endColumn === s.endColumn;
        return !equal || j < i; // equal ranges: keep the first
      }),
  );

/* ----------------------------- source tokens --------------------------- */

export type SourceToken = {
  folded: string;
  /** The token as extracted (non-breaking spaces read as plain spaces, so a
   * `~`-fused unit reads "a priori"). */
  display: string;
  /** Whether only inter-word space separates this token from the previous one
   * within the same plain-text run — the adjacency a multi-word join may
   * bridge. Markup of any kind between the two breaks it. */
  joinsLeft: boolean;
  /** The source occurrence began with a capital letter. */
  capital: boolean;
  /** Greek script (typed directly or via a `{{…}}` Greek-mode span). */
  greek: boolean;
  line: number;
  start: number;
  end: number;
};

/**
 * Place a block's Markit tokens in the source: drop the exempt ones (already
 * inside markup), read each one's line and columns off its source span, and
 * widen the edges over any `{…}`/`{{…}}` character- or Greek-mode span they
 * fall inside — compiled positions point at the braces' content, but a
 * replacement over the token must cover the whole span.
 */
const blockTokens = (
  block: Block,
  extraction: Extraction,
  lines: string[],
): SourceToken[] => {
  const out: SourceToken[] = [];
  const { text, spans } = extraction;
  let startIndex = 0; // span holding the current token's first character
  let endIndex = 0; // span holding the current token's last character
  let previous: { span: number; end: number } | undefined;
  for (const token of tokenize(block)) {
    while (spans[startIndex]!.end <= token.start) startIndex++;
    while (spans[endIndex]!.end <= token.end - 1) endIndex++;
    const joinsLeft =
      previous !== undefined &&
      previous.span === startIndex &&
      /^ *$/.test(text.slice(previous.end, token.start));
    previous = { span: endIndex, end: token.end };
    if (token.source === undefined || isExempt(token.context)) continue;
    const line = token.source.start.line;
    const [start, end] = widenOverBraces(
      lines[line] ?? "",
      token.source.start.column,
      token.source.end.column,
    );
    out.push({
      folded: foldWord(token.text),
      display: token.text,
      joinsLeft,
      capital: /^\p{Lu}/u.test(token.text),
      greek: GREEK_CHAR.test(token.text),
      line,
      start,
      end,
    });
  }
  return out;
};

/** Whether a wrapper stack contains exempting markup. */
const isExempt = (context: Frame[]): boolean =>
  context.some((frame) => EXEMPT_FRAMES.has(frame.type));

/** Widen a token's column range over any character/Greek-mode span it
 * overlaps on its line (a token strictly inside a multi-word Greek span
 * widens to the whole span — replacing less would break the braces). */
const widenOverBraces = (
  line: string,
  start: number,
  end: number,
): [number, number] => {
  for (const span of braceSpans(line)) {
    if (span.end <= start) continue;
    if (span.start >= end) break;
    if (span.start < start) start = span.start;
    if (span.end > end) end = span.end;
  }
  return [start, end];
};

/** The `{…}` and `{{…}}` spans of a source line, as [start, end) column
 * ranges, escaped braces skipped. Block-tag braces only occur on lines that
 * carry no tokens, so they never matter here. */
const braceSpans = (line: string): { start: number; end: number }[] => {
  const spans: { start: number; end: number }[] = [];
  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch !== "{") {
      i++;
      continue;
    }
    const close = line[i + 1] === "{" ? "}}" : "}";
    let j = i + close.length;
    while (j < line.length && !line.startsWith(close, j)) {
      j += line[j] === "\\" ? 2 : 1;
    }
    spans.push({ start: i, end: Math.min(j + close.length, line.length) });
    i = spans[spans.length - 1]!.end;
  }
  return spans;
};

/**
 * The block's source lines with everything except unmarked text content
 * blanked to \x00, for the citation regexes: a pattern can never match inside
 * existing markup or across it. Inline formatting delimiters soften to a
 * space instead — a word boundary the regexes may bridge, with the match
 * widened back over the delimiter afterwards (expandOverMarkup).
 */
const maskedLines = (
  block: Block,
  extraction: Extraction,
  lines: string[],
): Map<number, string> => {
  const from = block.source!.start.line;
  const to = Math.min(block.source!.end.line - 1, lines.length - 1);
  const blanks = new Map<number, string[]>();
  for (let num = from; num <= to; num++) {
    blanks.set(
      num,
      Array.from(lines[num] ?? "", () => "\0"),
    );
  }
  for (const span of extraction.spans) {
    if (span.source === undefined || isExempt(span.context)) continue;
    const { start, end } = span.source;
    for (let num = start.line; num <= end.line; num++) {
      const blank = blanks.get(num);
      if (blank === undefined) continue;
      const line = lines[num] ?? "";
      const a = num === start.line ? start.column : 0;
      const b =
        num === end.line ? Math.min(end.column, line.length) : line.length;
      for (let k = a; k < b; k++) blank[k] = line[k]!;
    }
  }
  const masked = new Map<number, string>();
  for (const [num, blank] of blanks) {
    const line = lines[num] ?? "";
    for (let k = 0; k < blank.length; k++) {
      if (blank[k] === "\0" && FORMAT_DELIMS.has(line[k]!)) blank[k] = " ";
    }
    masked.set(num, blank.join(""));
  }
  return masked;
};

/* ------------------------------- folding ------------------------------- */

/**
 * Fold a word for lexicon matching: lowercase, strip combining marks (which
 * also reduces `ç` and Greek breathings/accents), expand the ligatures the
 * corpus's character mode produces, normalise apostrophes, and trim edge
 * hyphens/apostrophes. Applied to both sides — words mined from compiled
 * documents and tokens read from raw source — so the two always agree.
 */
export const foldWord = (raw: string): string =>
  raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/æ/gu, "ae")
    .replace(/œ/gu, "oe")
    .replace(/’/gu, "'")
    .replace(/^['-]+|['-]+$/gu, "");

/** Whether a folded word is worth keeping (see MIN_WORD_LENGTH). */
const keepWord = (folded: string): boolean =>
  folded.length >= MIN_WORD_LENGTH && LETTER.test(folded);

/** The kept, folded words of a text, in order (Markit's word alphabet, so the
 * lexicons segment exactly as the source tokens do). */
const words = (text: string): string[] => {
  const out: string[] = [];
  for (const match of text.matchAll(wordPattern)) {
    const folded = foldWord(match[0]);
    if (keepWord(folded)) out.push(folded);
  }
  return out;
};

/** Build a phrase lexicon from display texts (folded internally). */
export const phraseLexicon = (texts: string[]): PhraseLexicon => {
  const lexicon: PhraseLexicon = new Map();
  for (const text of texts) addPhrase(lexicon, text);
  return lexicon;
};

const addPhrase = (lexicon: PhraseLexicon, text: string): void => {
  const seq = words(text);
  const head = seq[0];
  if (head === undefined) return;
  const list = lexicon.get(head) ?? [];
  if (
    list.some((s) => s.length === seq.length && s.every((w, i) => w === seq[i]))
  ) {
    return;
  }
  list.push(seq);
  list.sort((a, b) => b.length - a.length);
  lexicon.set(head, list);
};
