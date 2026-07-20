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
 * one "Suggest Markup & Flag Unaccounted Words" command — there is no per-kind
 * filter, so turning the overlay on flags every kind at once.
 *
 * How it hangs together (mirrors the dictionary overlay):
 *  - Hints (the lexicons) are built once from the loaded catalogue and cached,
 *    rebuilt only when the corpus model reloads (a save) — so a newly marked-up
 *    name improves every later suggestion. Building is ~1–2s, so the first
 *    build shows progress.
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
  buildHints,
  type Hints,
  type MarkupSuggestion,
  scanSource,
} from "../../lib/hints.ts";
import type { CorpusModel } from "../../corpusModel.ts";
import { hintOverrides } from "../../lib/hintOverrides.ts";
import {
  fixTitle,
  suggestionKey,
  suggestionMessage,
  wrapText,
} from "../../lib/suggestions.ts";
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
  /** The corpus reloaded: drop the cached hints and refresh what's shown. */
  onCorpusChanged: () => void;
  dispose: () => void;
};

export const createSuggestionController = (
  getModel: () => CorpusModel | undefined,
  context: vscode.ExtensionContext,
): SuggestionController => {
  /** Cached lexicons, and the catalogue identity they were built from. */
  let hints: Hints | undefined;
  let hintsFrom: Catalogue | undefined;

  /** Build (or reuse) the hints for the loaded corpus, showing progress on the
   * first, slow build. Undefined until a corpus has loaded. */
  const ensureHints = async (): Promise<Hints | undefined> => {
    const catalogue = getModel()?.state?.catalogue;
    if (catalogue === undefined) return undefined;
    if (hints !== undefined && hintsFrom === catalogue) return hints;
    hints = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Window,
        title: "Indexing corpus markup…",
      },
      () => Promise.resolve(buildHints(catalogue, hintOverrides)),
    );
    hintsFrom = catalogue;
    return hints;
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
    onCorpusChanged: () => {
      hints = undefined;
      hintsFrom = undefined;
      void overlay.refresh();
    },
    dispose: overlay.dispose,
  };
};
