/**
 * The "unaccounted word" overlay: while it is on, every surface the dictionary
 * does not yet account for (no entry) is squiggled in the open editions, so a
 * contributor can walk them (F8) and curate each with a quick fix.
 *
 * The finding is dictionaryScan.ts's (the corpus's `accountTokens` rule located
 * back in the source); this module is its editor surface. It is off by default
 * and gated behind the `compositor.flagUnaccountedWords` setting, because until
 * the register is backfilled almost every word is unaccounted — the overlay is
 * a curation tool, not an everyday distraction. The setting is flipped from the
 * one "Suggest Markup & Flag Unaccounted Words" command (alongside the markup
 * overlay); turning it on lights this up, turning it off takes it back down.
 *
 * Lifecycle mirrors the markup-suggestion overlay (commands/suggestMarkup.ts):
 * the active edition is compiled and scanned on demand — when the setting
 * flips, the active editor changes, on edits (debounced), and whenever the
 * corpus model reloads (a save may have added a dictionary entry). The
 * dictionary itself comes from the loaded catalogue.
 */

import * as vscode from "vscode";
import { compileWithPositions } from "@jsr/earlytexts__markit";
import { type EntryValue, shardOf } from "@earlytexts/corpus";
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
  addTargetTitle,
  entryActionTitle,
  entryWords,
  fuseActionTitle,
  unaccountedMessage,
  unattestedLemmaMessage,
  unattestedRejectMessage,
} from "../../lib/dictionaryEntryText.ts";
import {
  corpusVocabulary,
  resolveLemmaTarget,
  resolveSpellingTarget,
} from "../../lib/dictionaryResolve.ts";
import {
  readShardText,
  updateShards,
  writeShardText,
} from "../dictionaryShardIO.ts";
import type { CorpusModel } from "../../corpusModel.ts";

const SOURCE = "compositor-dictionary";
const SETTING = "flagUnaccountedWords";
const ENTRY_COMMAND = "compositor.dictionaryEntry";
const RESCAN_DEBOUNCE_MS = 300;

const isMit = (document: vscode.TextDocument): boolean =>
  document.uri.scheme === "file" && document.uri.fsPath.endsWith(".mit");

const enabled = (): boolean =>
  vscode.workspace.getConfiguration("compositor").get<boolean>(SETTING, false);

const wordRange = (word: UnaccountedWord): vscode.Range =>
  new vscode.Range(word.line, word.startColumn, word.line, word.endColumn);

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

/* -------------------------- the resolution cascade ---------------------- */

/** The entries a cascade has decided to write, folded surface → value. */
type Decisions = Map<string, EntryValue>;

/** What a target is measured against: the entries decided so far (plus the
 * loaded register), and the corpus vocabulary. */
type ResolveCtx = {
  decisions: Decisions;
  inDictionary: (word: string) => boolean;
  inCorpus: (word: string) => boolean;
};

/** How a step ended: written, abandoned (a cancelled prompt), or refused (an
 * unattested respelling target — carrying the message to show). */
type Step = "ok" | "cancel" | { rejected: string };

/**
 * Decide one entry, resolving whatever it references first (so the write never
 * leaves the register invalid). `modern` bottoms out immediately; a respelling
 * resolves each target spelling, a lemma its citation form — recursing until
 * every target is registered, added here, refused, or the contributor cancels.
 */
const addEntry = async (
  surface: string,
  kind: EntryAction["kind"],
  ctx: ResolveCtx,
): Promise<Step> => {
  if (kind === "modern") {
    ctx.decisions.set(surface, null);
    return "ok";
  }
  const target = await promptWords(surface, kind);
  if (target === undefined) return "cancel";
  if (kind === "lemma") {
    const step = await resolveLemma(target, ctx);
    if (step !== "ok") return step;
    ctx.decisions.set(surface, `=${target}`);
    return "ok";
  }
  for (const spelling of target.split(" ")) {
    const step = await resolveSpelling(spelling, ctx);
    if (step !== "ok") return step;
  }
  ctx.decisions.set(surface, target);
  return "ok";
};

/** Resolve a respelling's target spelling: registered already, else added as a
 * modern word or a lemma (an attested spelling), else refused (unattested). */
const resolveSpelling = async (
  target: string,
  ctx: ResolveCtx,
): Promise<Step> => {
  const resolution = resolveSpellingTarget(
    target,
    ctx.inDictionary,
    ctx.inCorpus,
  );
  if (resolution.kind === "resolved") return "ok";
  if (resolution.kind === "reject") {
    return { rejected: unattestedRejectMessage(target) };
  }
  const kind = await pickAddKind(target, resolution.choices);
  if (kind === undefined) return "cancel";
  return addEntry(target, kind, ctx);
};

/** Resolve a stated lemma's citation form: registered already, else added as a
 * modern word — silently when attested, on confirmation when not (a citation
 * form may be unprinted). */
const resolveLemma = async (target: string, ctx: ResolveCtx): Promise<Step> => {
  const resolution = resolveLemmaTarget(target, ctx.inDictionary, ctx.inCorpus);
  if (resolution.kind === "resolved") return "ok";
  if (resolution.kind === "add") {
    ctx.decisions.set(target, resolution.value);
    return "ok";
  }
  if (!(await confirmUnattestedLemma(target))) return "cancel";
  ctx.decisions.set(target, null);
  return "ok";
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

/** Write a cascade's decisions, one write per shard, as a single unit
 * serialized against every other dictionary edit (else a concurrent edit's read
 * can land mid-write and wipe a shard). Every shard's new text is computed
 * first, so a malformed value throws before anything is written. */
const writeDecisions = (root: string, decisions: Decisions): Promise<void> =>
  updateShards(async () => {
    const byShard = new Map<string, { surface: string; value: EntryValue }[]>();
    for (const [surface, value] of decisions) {
      const shard = shardOf(surface);
      const group = byShard.get(shard) ?? [];
      group.push({ surface, value });
      byShard.set(shard, group);
    }
    const writes: { shard: string; text: string }[] = [];
    for (const [shard, entries] of byShard) {
      writes.push({
        shard,
        text: upsertEntriesText(await readShardText(root, shard), entries),
      });
    }
    for (const { shard, text } of writes) {
      await writeShardText(root, shard, text);
    }
  });

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
): DictionaryController => {
  const collection = vscode.languages.createDiagnosticCollection(SOURCE);
  /** The last scan of each open document, keyed by path. */
  const scanned = new Map<string, UnaccountedWord[]>();

  /** Scan one document and publish its diagnostics (or clear them, when the
   * overlay is off or the corpus has no dictionary yet). */
  const scan = (document: vscode.TextDocument): void => {
    const dictionary = getModel()?.state?.catalogue.dictionary;
    if (!enabled() || dictionary === undefined || !isMit(document)) {
      drop(document);
      return;
    }
    const source = document.getText();
    const { document: doc } = compileWithPositions(source);
    const words = scanUnaccounted(source, doc, dictionary);
    scanned.set(document.uri.fsPath, words);
    collection.set(
      document.uri,
      words.map((word) => {
        const diagnostic = new vscode.Diagnostic(
          wordRange(word),
          unaccountedMessage(word),
          vscode.DiagnosticSeverity.Warning,
        );
        diagnostic.source = SOURCE;
        diagnostic.code = word.surface;
        return diagnostic;
      }),
    );
  };

  /** Forget a document's findings and clear its squiggles. */
  const drop = (document: vscode.TextDocument): void => {
    if (!scanned.has(document.uri.fsPath)) return;
    scanned.delete(document.uri.fsPath);
    collection.delete(document.uri);
  };

  /** Re-scan every open edition (or clear everything when off). */
  const refresh = (): void => {
    if (!enabled()) {
      scanned.clear();
      collection.clear();
      return;
    }
    for (const document of vscode.workspace.textDocuments) {
      if (isMit(document)) scan(document);
    }
  };

  // Re-scan on edits to an open edition, debounced per document.
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const onEdit = (document: vscode.TextDocument): void => {
    if (!enabled() || !isMit(document)) return;
    const key = document.uri.fsPath;
    clearTimeout(timers.get(key));
    timers.set(
      key,
      setTimeout(() => {
        timers.delete(key);
        scan(document);
      }, RESCAN_DEBOUNCE_MS),
    );
  };

  /** Curate one surface, resolving every target it references all the way down
   * before writing, so the register is never left invalid. A respelling/lemma
   * prompts for its target and, if that target is itself unregistered, cascades
   * (adding an attested one, refusing an unattested spelling, confirming an
   * unattested citation form). The decisions land across their shards in one
   * pass; the corpus watcher reloads and the squiggles clear on re-scan. */
  const runEntry = async (
    surface: string,
    kind: EntryAction["kind"],
  ): Promise<void> => {
    const model = getModel();
    if (model === undefined || model.state === undefined) return;
    const { root, state } = model;
    const dictionary = state.catalogue.dictionary;
    if (dictionary === undefined) return;
    const vocabulary = corpusVocabulary(state.catalogue);
    const decisions: Decisions = new Map();
    const step = await addEntry(surface, kind, {
      decisions,
      inDictionary: (word) =>
        decisions.has(word) || Object.hasOwn(dictionary, word),
      inCorpus: (word) => vocabulary.has(word),
    });
    if (step === "cancel") return;
    if (typeof step === "object") {
      void vscode.window.showErrorMessage(`Compositor: ${step.rejected}`);
      return;
    }
    try {
      await writeDecisions(root, decisions);
    } catch (error) {
      void vscode.window.showErrorMessage(
        `Compositor: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  const provider = vscode.languages.registerCodeActionsProvider(
    { scheme: "file", pattern: "**/*.mit" },
    {
      provideCodeActions: (document, _range, ctx) => {
        const words = scanned.get(document.uri.fsPath) ?? [];
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

  context.subscriptions.push(
    collection,
    provider,
    vscode.commands.registerCommand(ENTRY_COMMAND, runEntry),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration(`compositor.${SETTING}`)) refresh();
    }),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor !== undefined) scan(editor.document);
    }),
    vscode.workspace.onDidChangeTextDocument((e) => onEdit(e.document)),
    vscode.workspace.onDidCloseTextDocument(drop),
    { dispose: () => timers.forEach(clearTimeout) },
  );
  refresh();

  return {
    wordsOf: (document) => scanned.get(document.uri.fsPath) ?? [],
    onCorpusChanged: refresh,
    dispose: () => collection.dispose(),
  };
};
