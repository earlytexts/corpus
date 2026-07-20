/**
 * The token-accounting hover: point at a word in a `.mit` document and see the
 * citation lemma the corpus files it under, the normalised form it takes within
 * that lemma's paradigm (its form highlighted among the lemma's siblings, so a
 * respelling shows itself), and — when the reading is ambiguous — the other
 * lemmas on offer, each a click away from being pinned with `[w:surface=value]`
 * markup. The TypeScript language server's type-on-hover, for the dictionary.
 *
 * It speaks only of lemmas and forms, never the accounting engine's internal
 * classes: a mechanical or unaccounted token gets no hover at all (an unknown
 * word's "not in the dictionary" squiggle is the one tooltip it shows), so every
 * hover a contributor sees reads as the same lemma view rather than betraying
 * which route accounted for the word.
 *
 * A hover is lazy — it classifies the one token under the cursor on demand — so
 * it is far cheaper than the per-edit scan the squiggle overlay already runs
 * over the whole document. Compiling the source to place tokens is memoised per
 * (uri, version), and the register's paradigms are indexed once per catalogue.
 *
 * Like the two squiggle overlays it is gated behind a boolean setting
 * (`compositor.showTokenHover`, default on), the third tick box in the one
 * "Toggle Dictionary Accounting Hints" command — read live on each hover, so
 * flipping it needs no re-registration.
 *
 * All the accounting is the pure `resolveHoverInfo`/`lemmaForms`
 * (lib/hoverInfo.ts); this module is the editor surface — locating the token
 * under the cursor (reusing the source-token walk the squiggle and suggestion
 * overlays share, so exempt and already-`[w:]`-marked tokens are transparently
 * skipped), rendering the result as Markdown, and applying the pin edit.
 */

import * as vscode from "vscode";
import {
  compileWithPositions,
  type MarkitDocument,
} from "@jsr/earlytexts__markit";
import { type Dictionary, overridesOf } from "@earlytexts/corpus";
import type { CorpusModel } from "../corpusModel.ts";
import {
  blockSourceTokens,
  collectBlocks,
  type SourceToken,
} from "../lib/sourceTokens.ts";
import {
  type AccountedInfo,
  type HoverInfo,
  lemmaForms,
  type OtherReading,
  resolveHoverInfo,
} from "../lib/hoverInfo.ts";
import { wordMarkup } from "../lib/pinMarkup.ts";

/** The internal command a pin link fires. Not a palette command — invoked only
 * from the trusted hover Markdown, so it needs no package.json contribution. */
const PIN_COMMAND = "compositor.pinReading";

/** The setting that gates the hover (default on), flipped from the shared
 * "Toggle Dictionary Accounting Hints" command. */
const SETTING = "showTokenHover";

const MIT = { scheme: "file", pattern: "**/*.mit" } as const;

type PinArgs = {
  uri: string;
  /** [startLine, startColumn, endLine, endColumn], the token range to replace. */
  range: [number, number, number, number];
  value: string;
};

export const registerHover = (
  model: CorpusModel,
  context: vscode.ExtensionContext,
): void => {
  const compiled = compileCache();
  const forms = formsCache();
  context.subscriptions.push(
    vscode.languages.registerHoverProvider(MIT, {
      provideHover: (document, position) =>
        hoverFor(model, compiled, forms, document, position),
    }),
    vscode.commands.registerCommand(PIN_COMMAND, pinReading),
  );
};

/** The hover for a position, or undefined when the setting is off, the corpus is
 * not loaded, the cursor is not on a token, or the token is not one the register
 * accounts for (a mechanical or unaccounted word gets no lemma hover). */
const hoverFor = (
  model: CorpusModel,
  compiled: CompileCache,
  forms: FormsCache,
  document: vscode.TextDocument,
  position: vscode.Position,
): vscode.Hover | undefined => {
  const config = vscode.workspace.getConfiguration("compositor");
  if (!config.get<boolean>(SETTING, true)) return undefined;
  const dictionary = model.state?.catalogue.dictionary;
  if (dictionary === undefined) return undefined;
  const { doc, lines } = compiled(document);
  const token = tokenAt(doc, lines, position);
  if (token === undefined) return undefined;
  const info = resolveHoverInfo(
    token.display,
    dictionary,
    overridesOf(doc.metadata),
  );
  if (!isAccounted(info)) return undefined;
  const range = new vscode.Range(
    token.line,
    token.start,
    token.line,
    token.end,
  );
  const paradigm = forms(dictionary).get(info.lemma) ?? [info.form];
  return new vscode.Hover(render(info, paradigm, document.uri, range), range);
};

const isAccounted = (info: HoverInfo): info is AccountedInfo =>
  info.status === "registered" || info.status === "possessive";

/** The source token whose range contains the position, if any. Reuses the
 * squiggle/suggestion source-token walk, so exempt and `[w:]`-marked tokens are
 * already absent — the hover only fires on plain, accountable words. */
const tokenAt = (
  doc: MarkitDocument,
  lines: string[],
  position: vscode.Position,
): SourceToken | undefined => {
  for (const block of collectBlocks(doc)) {
    // Block source is a whole-line, end-exclusive range: skip the blocks that
    // cannot hold the cursor before tokenising (a lazy hover over a large
    // edition then tokenises one block, not every block).
    const source = block.source;
    if (
      source !== undefined &&
      (position.line < source.start.line || position.line >= source.end.line)
    ) {
      continue;
    }
    for (const token of blockSourceTokens(block, lines)) {
      if (
        token.line === position.line &&
        position.character >= token.start &&
        position.character < token.end
      ) {
        return token;
      }
    }
  }
  return undefined;
};

/* ------------------------------ rendering ------------------------------ */

/** Render an accounted token as its lemma view: the headword, the lemma's forms
 * with this token's form highlighted, and (for an ambiguous surface) the other
 * lemmas, each a pin link when the surface can carry `[w:]`. */
const render = (
  info: AccountedInfo,
  paradigm: string[],
  uri: vscode.Uri,
  range: vscode.Range,
): vscode.MarkdownString => {
  const md = new vscode.MarkdownString();
  // Trusted, but scoped to the one command the pin links fire.
  md.isTrusted = { enabledCommands: [PIN_COMMAND] };

  const possessive = info.status === "possessive" ? " · possessive" : "";
  md.appendMarkdown(`**${escape(info.lemma)}** · lemma${possessive}\n\n`);
  md.appendMarkdown(
    paradigm
      .map((form) =>
        form === info.form ? `**${escape(form)}**` : escape(form),
      )
      .join(" · "),
  );
  if (info.overridden) {
    md.appendMarkdown("\n\n_reading pinned by this edition_");
  }
  if (info.others.length > 0) {
    const items = info.others
      .map((other) => otherLemmaLink(other, uri, range))
      .join(" · ");
    md.appendMarkdown(`\n\nother readings: ${items}`);
  }
  return md;
};

/** One alternative lemma: a command link when it can be pinned, plain text
 * otherwise. The spelling is shown in parentheses only when it differs from the
 * lemma (telling apart two readings that share a headword). */
const otherLemmaLink = (
  other: OtherReading,
  uri: vscode.Uri,
  range: vscode.Range,
): string => {
  const label =
    other.lemma === other.spelling
      ? other.lemma
      : `${other.lemma} (${other.spelling})`;
  if (other.value === undefined) return escape(label);
  const args: PinArgs = {
    uri: uri.toString(),
    range: [
      range.start.line,
      range.start.character,
      range.end.line,
      range.end.character,
    ],
    value: other.value,
  };
  const encoded = encodeURIComponent(JSON.stringify(args));
  return `[${escape(label)}](command:${PIN_COMMAND}?${encoded})`;
};

/** Escape the Markdown-significant characters a printed word or reading might
 * carry, so it renders literally in the hover. */
const escape = (text: string): string =>
  text.replace(/[\\`*_[\]<>]/g, (char) => `\\${char}`);

/* -------------------------------- pinning ------------------------------- */

/** Replace a token with `[w:surface=value]`, reading the surface live from the
 * current document (its original spelling and case) so the edit stays valid even
 * if the buffer changed since the hover was shown. Mirrors the suggestion
 * overlay's replace-and-apply. */
const pinReading = async (args: PinArgs): Promise<void> => {
  const uri = vscode.Uri.parse(args.uri);
  const range = new vscode.Range(
    args.range[0],
    args.range[1],
    args.range[2],
    args.range[3],
  );
  const document = await vscode.workspace.openTextDocument(uri);
  const surface = document.getText(range);
  const edit = new vscode.WorkspaceEdit();
  edit.replace(uri, range, wordMarkup(surface, args.value));
  await vscode.workspace.applyEdit(edit);
};

/* -------------------------------- caching ------------------------------- */

type CompileCache = (document: vscode.TextDocument) => {
  doc: MarkitDocument;
  lines: string[];
};

/** A single-entry compile memo keyed by (uri, version): a burst of hovers over
 * one unchanged document compiles it once. */
const compileCache = (): CompileCache => {
  let last: { key: string; doc: MarkitDocument; lines: string[] } | undefined;
  return (document) => {
    const key = `${document.uri.toString()}\n${document.version}`;
    if (last?.key === key) return last;
    const source = document.getText();
    const { document: doc } = compileWithPositions(source);
    last = { key, doc, lines: source.split("\n") };
    return last;
  };
};

type FormsCache = (dictionary: Dictionary) => Map<string, string[]>;

/** The register's lemma paradigms, indexed once per catalogue: the dictionary
 * object identity is the cache key, so a reload (a fresh catalogue) rebuilds and
 * an unchanged one is reused across every hover. */
const formsCache = (): FormsCache => {
  let last:
    { dictionary: Dictionary; index: Map<string, string[]> } | undefined;
  return (dictionary) => {
    if (last?.dictionary !== dictionary) {
      last = { dictionary, index: lemmaForms(dictionary) };
    }
    return last.index;
  };
};
