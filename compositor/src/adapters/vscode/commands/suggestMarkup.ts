/**
 * Markup suggestions: a toggleable overlay that flags likely people, places,
 * organisations, citations, and foreign text in the open editions, so a
 * contributor can cycle through them (F8, like any diagnostic) and mark each up
 * with a quick fix — or leave it. The finding is hints.ts's (`scanSource` over
 * the whole-corpus lexicons `buildHints` mines); this module is the editor
 * surface for it.
 *
 * It is the enrichment half of the inline overlay, sitting alongside the
 * dictionary-accounting half (commands/dictionaryDiagnostics.ts): unaccounted
 * words squiggle as warnings, markup candidates as hints. Both are off by
 * default and driven by their own boolean setting, flipped together from the
 * one "Toggle Dictionary Accounting Hints" command — there is no per-kind
 * filter, so turning the overlay on flags every kind at once.
 *
 * How it hangs together (mirrors the dictionary overlay):
 *  - Hints (the lexicons) are mined from the corpus's sources once per session,
 *    on first demand, and then maintained as a fold: a save replaces just the
 *    saved file's contribution (see core/markup/hintIndex.ts), so a newly
 *    marked-up name improves every later suggestion without the whole corpus
 *    being re-read. Only the first mine is slow (~1–2s), so only it shows
 *    progress; a dictionary edit is ignored outright, the lexicons owing the
 *    register nothing.
 *  - Scanning is per-file and cheap (~tens of ms): a shown edition's current
 *    text is compiled and scanned on demand — when the setting flips, when the
 *    active editor changes, on edits (debounced), and after a rebuild.
 *  - Suggestions surface as Hint diagnostics in their own collection (kept
 *    apart from validation, so toggling them never disturbs the Problems the
 *    corpus rules report), each offering a "mark up as …" quick fix plus a
 *    "mark up all N identical" fix for repeated names and citations.
 */

import * as vscode from "vscode";
import { compileWithPositions } from "@jsr/earlytexts__markit";
import type { Catalogue } from "@earlytexts/corpus";
import {
  hintContribution,
  type Hints,
  type MarkupSuggestion,
  scanSource,
} from "../../../core/markup/hints.ts";
import { createHintIndex } from "../../../core/markup/hintIndex.ts";
import { distinctWorks } from "../../../core/catalogue/walk.ts";
import type {
  CorpusChange,
  CorpusModel,
} from "../../../core/model/corpusModel.ts";
import { hintOverrides } from "../../../core/markup/hintOverrides.ts";
import {
  fixTitle,
  suggestionKey,
  suggestionMessage,
  wrapText,
} from "../../../core/markup/suggestions.ts";
import { createOverlay } from "../overlay.ts";

const SOURCE = "compositor-suggestions";
const SETTING = "suggestMarkup";

const suggestionRange = (suggestion: MarkupSuggestion): vscode.Range =>
  new vscode.Range(
    suggestion.startLine,
    suggestion.startColumn,
    suggestion.endLine,
    suggestion.endColumn,
  );

/** Scan one document with the current hints. */
const scan = (
  document: vscode.TextDocument,
  active: Hints,
): MarkupSuggestion[] => {
  const source = document.getText();
  const { document: doc } = compileWithPositions(source);
  return scanSource(source, doc, active);
};

/** Render suggestions as Hint diagnostics under this overlay's own source. */
const suggestionDiagnostics = (
  suggestions: MarkupSuggestion[],
): vscode.Diagnostic[] =>
  suggestions.map((s) => {
    const diagnostic = new vscode.Diagnostic(
      suggestionRange(s),
      suggestionMessage(s),
      vscode.DiagnosticSeverity.Hint,
    );
    // A source distinct from the validation diagnostics (also "compositor")
    // so the code-action provider never mistakes one for the other.
    diagnostic.source = SOURCE;
    diagnostic.code = suggestionKey(s);
    return diagnostic;
  });

/** The "mark up as …" quick fixes for a shown suggestion, plus a "mark up all N
 * identical" fix for repeated names and citations. */
const suggestionProvider = (
  itemsOf: (document: vscode.TextDocument) => MarkupSuggestion[],
): vscode.Disposable =>
  vscode.languages.registerCodeActionsProvider(
    { scheme: "file", pattern: "**/*.mit" },
    {
      provideCodeActions: (document, _range, ctx) => {
        const suggestions = itemsOf(document);
        const actions: vscode.CodeAction[] = [];
        for (const diagnostic of ctx.diagnostics) {
          if (diagnostic.source !== SOURCE) continue;
          const suggestion = suggestions.find((s) =>
            suggestionRange(s).isEqual(diagnostic.range),
          );
          if (suggestion === undefined) continue;

          const one = new vscode.CodeAction(
            fixTitle(suggestion),
            vscode.CodeActionKind.QuickFix,
          );
          one.diagnostics = [diagnostic];
          one.edit = new vscode.WorkspaceEdit();
          one.edit.replace(
            document.uri,
            diagnostic.range,
            wrapText(suggestion),
          );
          actions.push(one);

          // Repeated names/citations: offer to mark every identical match at
          // once (same kind and same text — languages vary too much to batch).
          if (suggestion.type !== "language") {
            const twins = suggestions.filter(
              (s) =>
                suggestionKey(s) === suggestionKey(suggestion) &&
                s.text === suggestion.text,
            );
            if (twins.length > 1) {
              const all = new vscode.CodeAction(
                `Mark up all ${twins.length} “${suggestion.text}” in this file`,
                vscode.CodeActionKind.QuickFix,
              );
              all.diagnostics = [diagnostic];
              all.edit = new vscode.WorkspaceEdit();
              for (const twin of twins) {
                all.edit.replace(
                  document.uri,
                  suggestionRange(twin),
                  wrapText(twin),
                );
              }
              actions.push(all);
            }
          }
        }
        return actions;
      },
    },
    { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] },
  );

export type SuggestionController = {
  /** The corpus reloaded: fold the changed sources' markup into the lexicons and
   * refresh what's shown. A dictionary edit is ignored outright — the lexicons
   * are mined from markup and owe nothing to the register. */
  onCorpusChanged: (change: CorpusChange) => void;
  dispose: () => void;
};

export const createSuggestionController = (
  getModel: () => CorpusModel | undefined,
  context: vscode.ExtensionContext,
): SuggestionController => {
  const index = createHintIndex(hintOverrides);
  /** The one full mine, and whether it has completed — `mining` is also the
   * in-flight guard, so the overlay's per-keystroke `prepare()` joins the mine
   * already running instead of starting a second one beside it. */
  let mining: Promise<void> | undefined;
  let mined = false;
  /** The work titles seeding the citation lexicon, and the catalogue they came
   * from — `distinctWorks` walks the whole catalogue, so it is not something to
   * redo on every scan. */
  let works: { title: string }[] = [];
  let worksFrom: Catalogue | undefined;

  /** Mine every `works/**` source once, folding each file's contribution in and
   * setting the unmarked-word baseline from the whole sweep. The resident
   * catalogue is body-free, so this streams the sources — transiently, so a
   * 43 MB pass does not evict the editions actually being worked on from the
   * model's bounded working set. */
  const sweep = async (model: CorpusModel): Promise<void> => {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Window,
        title: "Indexing corpus markup…",
      },
      async () => {
        const unmarked = new Map<string, number>();
        const unmarkedLower = new Map<string, number>();
        for (const path of model.workSourcePaths()) {
          const file = await model.compileTransient(path);
          if (file === undefined) continue;
          const { marked, frequencies } = hintContribution(file.doc);
          index.set(path, marked);
          tally(unmarked, frequencies.unmarked);
          tally(unmarkedLower, frequencies.unmarkedLower);
        }
        index.rebase({ unmarked, unmarkedLower });
      },
    );
    mined = true;
  };

  /** The hints for the loaded corpus, mining once on first demand. Undefined
   * until a corpus has loaded. */
  const ensureHints = async (): Promise<Hints | undefined> => {
    const model = getModel();
    const catalogue = model?.state?.catalogue;
    if (model === undefined || catalogue === undefined) return undefined;
    if (!mined) {
      mining ??= sweep(model);
      await mining;
    }
    if (worksFrom !== catalogue) {
      works = distinctWorks(catalogue.authors);
      worksFrom = catalogue;
    }
    return index.hints(catalogue.authors, works);
  };

  /** Replace just the saved sources' contributions. Each is warm in the model's
   * working set — the save compiled it — so this reads no disk. Before the first
   * mine there is nothing to fold into; that mine will pick them up. */
  const refold = async (sources: ReadonlySet<string>): Promise<void> => {
    const model = getModel();
    if (model === undefined || !mined) return;
    for (const path of sources) {
      if (!path.startsWith("works/")) continue;
      const file = await model.getCompiledFile(path);
      if (file === undefined) index.remove(path);
      else index.set(path, hintContribution(file.doc).marked);
    }
  };

  const overlay = createOverlay(context, {
    setting: SETTING,
    source: SOURCE,
    prepare: ensureHints,
    scan,
    diagnostics: suggestionDiagnostics,
    provider: suggestionProvider,
  });

  return {
    onCorpusChanged: (change) => {
      // The lexicons are mined from markup and owe the register nothing.
      if (change.kind === "dictionary") return;
      if (change.kind === "full") {
        // The file set moved wholesale; re-mine lazily, on the next demand.
        mined = false;
        mining = undefined;
        void overlay.refresh();
        return;
      }
      // Fold first, so the refresh scans against the markup that was just saved.
      void refold(change.sources).then(() => overlay.refresh());
    },
    dispose: overlay.dispose,
  };
};

/** Sum one file's word frequencies into the running baseline. */
const tally = (into: Map<string, number>, from: Map<string, number>): void => {
  for (const [word, count] of from)
    into.set(word, (into.get(word) ?? 0) + count);
};
