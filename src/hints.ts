/**
 * Markup hints: lexicons mined from the markup the corpus already carries,
 * and a scanner that proposes likely new markup in raw `.mit` source. The
 * corpus is its own training data — every `[p:…]` person, `[…]` citation, and
 * `$xx:…$` language span already marked up teaches the scanner what to look
 * for — so suggestions improve as markup accumulates.
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
 *  - scanSource: tokenize a file's raw source (skipping metadata, block tags,
 *    and text already inside markup; folding `{…}` character escapes; staying
 *    word-transparent across page breaks and editorial marks) and report
 *    matches as ranges in that source, ready to become editor diagnostics.
 *    Greek needs no lexicon: Greek script and `{{…}}` spans match outright.
 *
 * Positions are 0-based (lines and columns), end-exclusive — the shape a
 * VSCode Range wants; the corpus's own display convention is 1-based.
 *
 * Reads top-down: tuning constants and public types, then each half's entry
 * point followed by its helpers (mining, then matching, then the tokenizer),
 * with the word-folding foundation both halves share at the bottom.
 */

import type {
  Block,
  BlockElement,
  InlineElement,
  List,
  MarkitDocument,
} from "@earlytexts/markit";
import { endLine, startLine } from "@earlytexts/markit";
import type { Catalogue, Work } from "./types.ts";

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
const WORD_CHAR = /[\p{L}\p{N}'’æœ-]/u;
const WORD_RUN = /^[\p{L}\p{N}'’æœ-]+$/u;
const WORDS_RE = /[\p{L}\p{N}'’æœ-]+/gu;
const GREEK_CHAR = /[\u0370-\u03ff\u1f00-\u1fff]/u;
/** A footnote reference, `<nID>` (footnoteReferenceSpec, with delimiters). */
const FOOTNOTE_REF = /^<n[^\s#{}]+>/;

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
  type: "person" | "citation" | "language";
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
    citation: (text) => addPhrase(citations, text),
    unmarked: (text) => {
      for (const match of text.matchAll(WORDS_RE)) {
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

  return { people, citations, languages };
};

/* --------------------------- the corpus walk --------------------------- */

type HintSink = {
  language: (lang: string, text: string) => void;
  person: (text: string) => void;
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
 * wrapper feeds that wrapper's lexicon only — person/citation/place/org
 * content is proper names, not evidence of English — and a language span
 * without a code feeds nothing (its content is unreliable either way).
 */
const walkInline = (elements: InlineElement[], sink: HintSink): void => {
  for (const el of elements) {
    if (el.type === "plainText") sink.unmarked(el.content);
    else if (el.type === "language") {
      if (el.lang !== undefined) sink.language(el.lang, inlineText(el.content));
    } else if (el.type === "person") sink.person(inlineText(el.content));
    else if (el.type === "citation") sink.citation(inlineText(el.content));
    else if (el.type === "place" || el.type === "org") {
      /* proper names */
    } else if ("content" in el && Array.isArray(el.content)) {
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
      if (el.type === "emSpace") return " ";
      return "content" in el && Array.isArray(el.content)
        ? inlineText(el.content)
        : "";
    })
    .join("");

/* ------------------------------ scanSource ----------------------------- */

/**
 * Scan a `.mit` file's raw source for likely markup, returning suggestions as
 * source ranges (ready to become diagnostics). `document` must be the compile
 * of THIS source (e.g. the compositor's per-file compile, not the composed
 * catalogue document, whose borrowed children live in other files): its block
 * ranges say which lines are content — everything else (text IDs, metadata)
 * is never scanned. Suggestions of every type are returned; callers filter.
 */
export const scanSource = (
  source: string,
  document: MarkitDocument,
  hints: Hints,
): MarkupSuggestion[] => {
  const lines = source.split("\n");
  const out: MarkupSuggestion[] = [];
  for (const block of collectBlocks(document)) {
    const from = block[startLine];
    const to = Math.min(block[endLine], lines.length - 1);
    const blockLines: { num: number; text: string }[] = [];
    for (let num = from; num <= to; num++) {
      blockLines.push({ num, text: lines[num] ?? "" });
    }
    const { tokens, masked } = tokenizeBlock(blockLines);
    matchGreek(tokens, lines, out);
    matchLanguages(tokens, hints.languages, lines, out);
    matchPhrases(tokens, hints.people, "person", lines, out);
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

/** Every block of the document and its (in-file) children, in source order. */
const collectBlocks = (document: MarkitDocument): Block[] => {
  const out: Block[] = [];
  const walk = (doc: MarkitDocument): void => {
    out.push(...doc.blocks);
    doc.children.forEach(walk);
  };
  walk(document);
  return out.sort((a, b) => a[startLine] - b[startLine]);
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

/* --------------------------- source tokenizer -------------------------- */

type SourceToken = {
  folded: string;
  display: string;
  /** The source occurrence began with a capital letter. */
  capital: boolean;
  /** Greek script, or a `{{…}}` Greek-mode span. */
  greek: boolean;
  line: number;
  start: number;
  end: number;
};

type BlockScan = {
  tokens: SourceToken[];
  /** Line number → the line with markup blanked to \x00 (for the regexes). */
  masked: Map<number, string>;
};

/**
 * Tokenize one block's source lines. Produces the folded tokens the matchers
 * run over, plus markup-masked copies of the lines for the citation regexes.
 * Text inside existing markup is masked: `$…$` spans, `[p:/[l:/[o:…]` names,
 * `[…]` citations, deletions, footnote references, raw-element tags, block
 * tags, and page breaks. Page breaks and editorial delimiters are
 * word-TRANSPARENT: `fo//12//ro` and `for[+o+]` both read "foro" (the edited
 * text), so a match can cover markup without being broken by it. A masked
 * span may close on a later line of the block, so mask state carries across
 * lines; tokens themselves never cross a line.
 */
const tokenizeBlock = (lines: { num: number; text: string }[]): BlockScan => {
  const tokens: SourceToken[] = [];
  const masked = new Map<number, string>();
  /** The closing delimiter of the masked span we're inside, if any. */
  let maskUntil: string | null = null;

  for (const { num, text } of lines) {
    const blank = text.split("");
    let display = "";
    let start = 0;
    let end = 0;

    const mask = (from: number, to: number): void => {
      for (let k = from; k < Math.min(to, blank.length); k++) blank[k] = "\0";
    };
    const flush = (): void => {
      if (display === "") return;
      const folded = foldWord(display);
      if (keepWord(folded)) {
        tokens.push({
          folded,
          display,
          capital: /^\p{Lu}/u.test(display),
          greek: GREEK_CHAR.test(display),
          line: num,
          start,
          end,
        });
      }
      display = "";
    };
    const append = (part: string, from: number, to: number): void => {
      if (display === "") start = from;
      display += part;
      end = to;
    };

    let i = 0;
    while (i < text.length) {
      if (maskUntil !== null) {
        if (text[i] === "\\") {
          mask(i, i + 2);
          i += 2;
        } else if (text.startsWith(maskUntil, i)) {
          mask(i, i + maskUntil.length);
          i += maskUntil.length;
          maskUntil = null;
        } else {
          mask(i, i + 1);
          i++;
        }
        continue;
      }
      const ch = text[i]!;
      if (ch === "\\") {
        const next = text[i + 1];
        if (next !== undefined && WORD_CHAR.test(next)) append(next, i, i + 2);
        else flush();
        i += 2;
        continue;
      }
      if (ch === "{") {
        if (text[i + 1] === "{") {
          // Greek mode: the span is one Greek-flagged token.
          flush();
          const close = text.indexOf("}}", i + 2);
          const to = close === -1 ? text.length : close + 2;
          const inner = text.slice(i + 2, close === -1 ? text.length : close);
          if (LETTER.test(inner)) {
            tokens.push({
              folded: foldWord(inner),
              display: inner,
              capital: false,
              greek: true,
              line: num,
              start: i,
              end: to,
            });
          }
          i = to;
          continue;
        }
        if (text[i + 1] === "#") {
          // Block tag (with any inline block metadata).
          flush();
          const close = text.indexOf("}", i);
          const to = close === -1 ? text.length : close + 1;
          mask(i, to);
          i = to;
          continue;
        }
        // Character mode: fold into the current word (or break it).
        const close = text.indexOf("}", i);
        const to = close === -1 ? text.length : close + 1;
        const decoded = decodeCharSpan(
          text.slice(i + 1, close === -1 ? text.length : close),
        );
        if (decoded !== "" && WORD_RUN.test(decoded)) append(decoded, i, to);
        else flush();
        i = to;
        continue;
      }
      if (ch === "$") {
        flush();
        mask(i, i + 1);
        maskUntil = "$";
        i++;
        continue;
      }
      if (ch === "[") {
        const pair = text.slice(i, i + 2);
        if (pair === "[+" || pair === "[?") {
          // Insertion/uncertain: transparent — the content is the reading.
          mask(i, i + 2);
          i += 2;
          continue;
        }
        if (pair === "[-") {
          // Deletion: drop the content, keep the word around it whole.
          mask(i, i + 2);
          maskUntil = "-]";
          i += 2;
          continue;
        }
        const triple = text.slice(i, i + 3);
        if (triple === "[p:" || triple === "[l:" || triple === "[o:") {
          flush();
          mask(i, i + 3);
          maskUntil = "]";
          i += 3;
          continue;
        }
        // A citation (or `[…]` illegible): already marked up.
        flush();
        mask(i, i + 1);
        maskUntil = "]";
        i++;
        continue;
      }
      if ((ch === "+" || ch === "?") && text[i + 1] === "]") {
        mask(i, i + 2);
        i += 2;
        continue;
      }
      if (ch === "/" && text[i + 1] === "/") {
        // Page break, `///` or `//ref//`: transparent, may fall mid-word.
        if (text[i + 2] === "/") {
          mask(i, i + 3);
          i += 3;
          continue;
        }
        const close = text.indexOf("//", i + 2);
        if (close === -1) {
          flush();
          mask(i, i + 2);
          i += 2;
          continue;
        }
        mask(i, close + 2);
        i = close + 2;
        continue;
      }
      if (ch === "<") {
        if (text[i + 1] === "<") {
          // Raw-element tag: mask the tag, scan the content around it.
          flush();
          const close = text.indexOf(">>", i + 2);
          const to = close === -1 ? text.length : close + 2;
          mask(i, to);
          i = to;
          continue;
        }
        const ref = FOOTNOTE_REF.exec(text.slice(i));
        if (ref !== null) {
          flush();
          mask(i, i + ref[0].length);
          i += ref[0].length;
          continue;
        }
        flush();
        i++;
        continue;
      }
      if (ch === "_" || ch === "*") {
        // Inline emphasis/small-caps: a word boundary that the match will
        // later be widened back over (expandOverMarkup), so a name or citation
        // set in italics marks up whole. Softened to a space (not \0) in the
        // masked line so the citation locators still see a boundary there.
        flush();
        blank[i] = " ";
        i++;
        continue;
      }
      if (WORD_CHAR.test(ch)) {
        append(ch, i, i + 1);
        i++;
        continue;
      }
      flush();
      i++;
    }
    flush();
    masked.set(num, blank.join(""));
  }
  return { tokens, masked };
};

/** Decode a `{…}` character-mode span to the letters it produces: digraphs
 * expand, diacritic markers drop. A span producing punctuation (en/em dash,
 * §) returns "" — a word boundary. Mirrors the Markit compiler's rules. */
const decodeCharSpan = (inner: string): string => {
  const digraphs: [string, string][] = [
    ["ae", "ae"],
    ["AE", "AE"],
    ["oe", "oe"],
    ["OE", "OE"],
    ["c,", "c"],
    ["C,", "C"],
  ];
  const markers = new Set(["/", "`", "^", '"']);
  let out = "";
  let pos = 0;
  while (pos < inner.length) {
    const ch = inner[pos];
    if (ch === "\\") {
      out += inner[pos + 1] ?? "";
      pos += 2;
      continue;
    }
    if (ch === "-" || ch === "$") return ""; // dash or § — punctuation
    const digraph = digraphs.find(([d]) => inner.startsWith(d, pos));
    if (digraph !== undefined) {
      out += digraph[1];
      pos += digraph[0].length;
      continue;
    }
    if (markers.has(ch ?? "")) {
      pos++;
      continue;
    }
    out += ch;
    pos++;
  }
  return out;
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

/** The kept, folded words of a text, in order. */
const words = (text: string): string[] => {
  const out: string[] = [];
  for (const match of text.matchAll(WORDS_RE)) {
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
  )
    return;
  list.push(seq);
  list.sort((a, b) => b.length - a.length);
  lexicon.set(head, list);
};
