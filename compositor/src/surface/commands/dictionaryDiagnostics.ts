/**
 * The "unaccounted word" overlay: while it is on, every surface the dictionary
 * does not yet account for (no entry) is squiggled in the open editions, so a
 * contributor can walk them (F8) and curate each with a quick fix.
 *
 * The finding is dictionaryScan.ts's (the corpus's `accountTokens` rule located
 * back in the source); this module is its editor surface. It is on by default
 * and gated behind the `compositor.flagUnaccountedWords` setting: while the
 * register is still being backfilled the overlay is a curation tool, so it can
 * be turned off when the volume of unaccounted words is more noise than help.
 * The setting is flipped from the one "Toggle Dictionary Accounting Hints"
 * command (alongside the markup overlay); turning it on lights this up, turning
 * it off takes it back down.
 *
 * Lifecycle mirrors the markup-suggestion overlay (commands/suggestMarkup.ts):
 * the active edition is compiled and scanned on demand — when the setting
 * flips, the active editor changes, on edits (debounced), and whenever the
 * corpus model reloads (a save may have added a dictionary entry). The
 * dictionary itself comes from the loaded catalogue.
 *
 * Curating a squiggle runs the resolution cascade (lib/dictionaryCascade.ts):
 * this module supplies only the editor prompts it drives and writes the
 * resulting decisions across their shards.
 */

import * as vscode from "vscode";
import { compileWithPositions } from "@jsr/earlytexts__markit";
import {
  scanUnaccounted,
  type UnaccountedWord,
} from "../../lib/dictionaryScan.ts";
import {
  actionsFor,
  type EntryAction,
  upsertEntriesText,
} from "../../lib/dictionaryEdits.ts";
import {
  addEntry,
  type CascadePrompts,
  type Decisions,
  groupDecisionsByShard,
} from "../../lib/dictionaryCascade.ts";
import {
  addTargetTitle,
  entryActionTitle,
  entryWords,
  fuseActionTitle,
  unaccountedMessage,
  unattestedLemmaMessage,
} from "../../lib/dictionaryEntryText.ts";
import { corpusVocabulary } from "../../lib/dictionaryResolve.ts";
import {
  readShardText,
  updateShards,
  writeShardText,
} from "../dictionaryShardIO.ts";
import { createOverlay } from "../overlay.ts";
import type { CorpusModel, CorpusState } from "../../corpusModel.ts";

const SOURCE = "compositor-dictionary";
const SETTING = "flagUnaccountedWords";
const ENTRY_COMMAND = "compositor.dictionaryEntry";

const wordRange = (word: UnaccountedWord): vscode.Range =>
  new vscode.Range(word.line, word.startColumn, word.line, word.endColumn);

/* ------------------- the cascade's editor prompts ----------------------- */

/** Ask for the modern spelling (respell) or lemma of a surface, folded to the
 * register's key form. One word, or space-separated words for an expansion
 * (`'tis` → "it is"). undefined when cancelled. */
const promptWords = async (
  surface: string,
  kind: "respell" | "lemma",
): Promise<string | undefined> => {
  const input = await vscode.window.showInputBox({
    title:
      kind === "respell"
        ? `Modern spelling of “${surface}”`
        : `Lemma (citation form) of “${surface}”`,
    placeHolder:
      kind === "respell"
        ? "e.g. virtue — or space-separate an expansion (it is)"
        : "e.g. increase",
    validateInput: (value) =>
      entryWords(value).length > 0
        ? undefined
        : "Enter one or more words (letters and apostrophes only).",
  });
  if (input === undefined) return undefined;
  const words = entryWords(input);
  return words.length === 0 ? undefined : words.join(" ");
};

/** Ask how to give a target its own entry — the choices are the only ones that
 * keep the register valid. undefined when dismissed. */
const pickAddKind = async (
  target: string,
  choices: Array<"modern" | "lemma">,
): Promise<"modern" | "lemma" | undefined> => {
  const pick = await vscode.window.showQuickPick(
    choices.map((action) =>
      action === "modern"
        ? {
            label: "Modern word",
            action,
            description: `“${target}” is spelled and lemmatised as itself`,
          }
        : {
            label: "With a lemma…",
            action,
            description: `“${target}” is a modern spelling of another headword`,
          },
    ),
    { title: addTargetTitle(target) },
  );
  return pick?.action;
};

/** Confirm adding an unattested citation form (a lemma that never appears in
 * the corpus). Modal, defaulting to no. */
const confirmUnattestedLemma = async (target: string): Promise<boolean> =>
  (await vscode.window.showWarningMessage(
    unattestedLemmaMessage(target),
    { modal: true },
    "Add as modern word",
  )) === "Add as modern word";

/** The editor prompts the resolution cascade drives (dictionaryCascade.ts). */
const prompts: CascadePrompts = {
  promptWords,
  pickAddKind,
  confirmUnattestedLemma,
};

/** Write a cascade's decisions, one write per shard, as a single unit
 * serialized against every other dictionary edit (else a concurrent edit's read
 * can land mid-write and wipe a shard). Every shard's new text is computed
 * first, so a malformed value throws before anything is written. */
const writeDecisions = (root: string, decisions: Decisions): Promise<void> =>
  updateShards(async () => {
    const writes: { shard: string; text: string }[] = [];
    for (const [shard, entries] of groupDecisionsByShard(decisions)) {
      writes.push({
        shard,
        text: upsertEntriesText(await readShardText(root, shard), entries),
      });
    }
    for (const { shard, text } of writes) {
      await writeShardText(root, shard, text);
    }
  });

/** Shared by the `modern` path, which never reads it. */
const EMPTY_VOCABULARY: ReadonlySet<string> = new Set();

/** The attested vocabulary a respelling/lemma target resolves against. Once the
 * first full load has completed the model holds it (register-independent,
 * rebuilt only when documents change), so this is O(1) and the prompt opens at
 * once. Only the pre-first-load window — seeded from the catalogue cache, which
 * carries no token data — falls back to walking the catalogue, behind a
 * progress notification since that is a few seconds on a cold corpus. */
const resolveVocabulary = async (
  model: CorpusModel,
  state: CorpusState,
): Promise<ReadonlySet<string>> => {
  if (model.loaded) return state.vocabulary;
  return await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Compositor: indexing the corpus vocabulary…",
    },
    () => Promise.resolve(corpusVocabulary(state.catalogue)),
  );
};

/** Render unaccounted words as warning diagnostics under this overlay's source,
 * carrying the surface as the code so the code-action provider can find them. */
const unaccountedDiagnostics = (
  words: UnaccountedWord[],
): vscode.Diagnostic[] =>
  words.map((word) => {
    const diagnostic = new vscode.Diagnostic(
      wordRange(word),
      unaccountedMessage(word),
      vscode.DiagnosticSeverity.Warning,
    );
    diagnostic.source = SOURCE;
    diagnostic.code = word.surface;
    return diagnostic;
  });

/** The quick fixes for a squiggled surface: a ~ fusion (preferred) when the run
 * is a registered multi-word unit, then the curation actions that dispatch to
 * the resolution cascade via ENTRY_COMMAND. */
const unaccountedProvider = (
  itemsOf: (document: vscode.TextDocument) => UnaccountedWord[],
): vscode.Disposable =>
  vscode.languages.registerCodeActionsProvider(
    { scheme: "file", pattern: "**/*.mit" },
    {
      provideCodeActions: (document, _range, ctx) => {
        const words = itemsOf(document);
        const actions: vscode.CodeAction[] = [];
        for (const diagnostic of ctx.diagnostics) {
          if (diagnostic.source !== SOURCE) continue;
          const word = words.find((w) =>
            wordRange(w).isEqual(diagnostic.range),
          );
          if (word === undefined) continue;
          // The ~ fusion first (and preferred): the run is a registered
          // multi-word unit, so joining it in the source is the right fix —
          // curating the fragment would paper over it.
          if (word.fuse !== undefined) {
            const fuse = new vscode.CodeAction(
              fuseActionTitle(word.fuse),
              vscode.CodeActionKind.QuickFix,
            );
            fuse.diagnostics = [diagnostic];
            fuse.isPreferred = true;
            fuse.edit = new vscode.WorkspaceEdit();
            for (const gap of word.fuse.gaps) {
              fuse.edit.replace(
                document.uri,
                new vscode.Range(
                  gap.startLine,
                  gap.startColumn,
                  gap.endLine,
                  gap.endColumn,
                ),
                "~",
              );
            }
            actions.push(fuse);
          }
          for (const { kind } of actionsFor()) {
            const fix = new vscode.CodeAction(
              entryActionTitle(word.surface, kind),
              vscode.CodeActionKind.QuickFix,
            );
            fix.diagnostics = [diagnostic];
            fix.command = {
              command: ENTRY_COMMAND,
              title: fix.title,
              arguments: [word.surface, kind],
            };
            actions.push(fix);
          }
        }
        return actions;
      },
    },
    { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] },
  );

export type DictionaryController = {
  /** The scanned words of a document, for the code-action provider. */
  wordsOf: (document: vscode.TextDocument) => UnaccountedWord[];
  /** The corpus reloaded (or a shard was saved): re-scan what's shown. */
  onCorpusChanged: () => void;
  dispose: () => void;
};

export const createDictionaryController = (
  getModel: () => CorpusModel | undefined,
  context: vscode.ExtensionContext,
  /** Called with the surfaces a curation cascade just wrote (the shards are on
   * disk by then) — the dictionary panel patches them in immediately off this,
   * rather than waiting for the corpus watcher's debounced reload. */
  onEntriesWritten?: (surfaces: ReadonlySet<string>) => void,
): DictionaryController => {
  const overlay = createOverlay(context, {
    setting: SETTING,
    source: SOURCE,
    prepare: () => getModel()?.state?.catalogue.dictionary,
    scan: (document, dictionary) => {
      const source = document.getText();
      const { document: doc } = compileWithPositions(source);
      return scanUnaccounted(source, doc, dictionary);
    },
    diagnostics: unaccountedDiagnostics,
    provider: unaccountedProvider,
  });

  /** Optimistically drop the squiggles a just-written entry accounts for —
   * these entries *are* the edit, not a prediction. Exact surfaces only: a
   * possessive whose base was just registered waits for the model's reload
   * and re-scan, which follows within a second and confirms the rest. */
  const clearSurfaces = (surfaces: ReadonlySet<string>): void => {
    for (const [path, words] of overlay.scanned) {
      const kept = words.filter((word) => !surfaces.has(word.surface));
      if (kept.length === words.length) continue;
      overlay.publish(vscode.Uri.file(path), kept);
    }
  };

  /** Curate one surface, resolving every target it references all the way down
   * before writing, so the register is never left invalid. A respelling/lemma
   * prompts for its target and, if that target is itself unregistered, cascades
   * (adding an attested one, refusing an unattested spelling, confirming an
   * unattested citation form). The decisions land across their shards in one
   * pass; their squiggles clear immediately (clearSurfaces) and the corpus
   * watcher's reload re-scans to confirm. */
  const runEntry = async (
    surface: string,
    kind: EntryAction["kind"],
  ): Promise<void> => {
    const model = getModel();
    if (model === undefined || model.state === undefined) return;
    const { root, state } = model;
    const dictionary = state.catalogue.dictionary;
    if (dictionary === undefined) return;
    // `modern` bottoms out without consulting the corpus vocabulary; every
    // other kind needs it, but only after the user types a target — and the
    // model holds it ready (O(1)), so the input box opens at once instead of
    // waiting on a whole-corpus walk (see resolveVocabulary).
    const vocabulary =
      kind === "modern"
        ? EMPTY_VOCABULARY
        : await resolveVocabulary(model, state);
    const decisions: Decisions = new Map();
    const step = await addEntry(
      surface,
      kind,
      {
        decisions,
        inDictionary: (word) =>
          decisions.has(word) || Object.hasOwn(dictionary, word),
        inCorpus: (word) => vocabulary.has(word),
      },
      prompts,
    );
    if (step === "cancel") return;
    if (typeof step === "object") {
      void vscode.window.showErrorMessage(`Compositor: ${step.rejected}`);
      return;
    }
    try {
      const written = new Set(decisions.keys());
      await writeDecisions(root, decisions);
      clearSurfaces(written);
      onEntriesWritten?.(written);
    } catch (error) {
      void vscode.window.showErrorMessage(
        `Compositor: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  context.subscriptions.push(
    vscode.commands.registerCommand(ENTRY_COMMAND, runEntry),
  );

  return {
    wordsOf: overlay.itemsOf,
    onCorpusChanged: () => void overlay.refresh(),
    dispose: overlay.dispose,
  };
};
