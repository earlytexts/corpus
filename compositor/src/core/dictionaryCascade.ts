/**
 * The resolution cascade behind curating one unaccounted surface: deciding the
 * entry to write and, before it, resolving every target that entry references —
 * so the register is never left invalid. A respelling names a target spelling,
 * a lemma its citation form; if a target is itself unregistered it is added (or
 * refused) first, recursing until everything bottoms out in the register.
 *
 * The branch logic here is vscode-free and unit-tested; the editor layer
 * (surface/commands/dictionaryDiagnostics.ts) injects the prompts the cascade
 * drives and writes the resulting decisions across their shards. The resolution
 * *rules* — attested vs. unattested, which kinds keep the register valid — live
 * in dictionaryResolve.ts; this is the interactive walk over them.
 */

import { type EntryValue, shardOf } from "@earlytexts/corpus";
import type { EntryAction } from "./dictionaryEdits.ts";
import { unattestedRejectMessage } from "./dictionaryEntryText.ts";
import {
  resolveLemmaTarget,
  resolveSpellingTarget,
} from "./dictionaryResolve.ts";

/** The entries a cascade has decided to write, folded surface → value. */
export type Decisions = Map<string, EntryValue>;

/** What a target is measured against: the entries decided so far (plus the
 * loaded register), and the corpus vocabulary. */
export type ResolveCtx = {
  decisions: Decisions;
  inDictionary: (word: string) => boolean;
  inCorpus: (word: string) => boolean;
};

/** How a step ended: written, abandoned (a cancelled prompt), or refused (an
 * unattested respelling target — carrying the message to show). */
export type Step = "ok" | "cancel" | { rejected: string };

/** The interactive decisions the cascade defers to the editor: the target
 * spelling/lemma of a surface, how to give a target its own entry, and whether
 * to add an unattested citation form. Each resolves to `undefined` / `false`
 * when the contributor dismisses it, ending the cascade as a cancel. */
export type CascadePrompts = {
  promptWords: (
    surface: string,
    kind: "respell" | "lemma",
  ) => Promise<string | undefined>;
  pickAddKind: (
    target: string,
    choices: Array<"modern" | "lemma">,
  ) => Promise<"modern" | "lemma" | undefined>;
  confirmUnattestedLemma: (target: string) => Promise<boolean>;
};

/**
 * Decide one entry, resolving whatever it references first (so the write never
 * leaves the register invalid). `modern` bottoms out immediately; a respelling
 * resolves each target spelling, a lemma its citation form — recursing until
 * every target is registered, added here, refused, or the contributor cancels.
 */
export const addEntry = async (
  surface: string,
  kind: EntryAction["kind"],
  ctx: ResolveCtx,
  prompts: CascadePrompts,
): Promise<Step> => {
  if (kind === "modern") {
    ctx.decisions.set(surface, null);
    return "ok";
  }
  const target = await prompts.promptWords(surface, kind);
  if (target === undefined) return "cancel";
  if (kind === "lemma") {
    const step = await resolveLemma(target, ctx, prompts);
    if (step !== "ok") return step;
    ctx.decisions.set(surface, `=${target}`);
    return "ok";
  }
  for (const spelling of target.split(" ")) {
    const step = await resolveSpelling(spelling, ctx, prompts);
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
  prompts: CascadePrompts,
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
  const kind = await prompts.pickAddKind(target, resolution.choices);
  if (kind === undefined) return "cancel";
  return addEntry(target, kind, ctx, prompts);
};

/** Resolve a stated lemma's citation form: registered already, else added as a
 * modern word — silently when attested, on confirmation when not (a citation
 * form may be unprinted). */
const resolveLemma = async (
  target: string,
  ctx: ResolveCtx,
  prompts: CascadePrompts,
): Promise<Step> => {
  const resolution = resolveLemmaTarget(target, ctx.inDictionary, ctx.inCorpus);
  if (resolution.kind === "resolved") return "ok";
  if (resolution.kind === "add") {
    ctx.decisions.set(target, resolution.value);
    return "ok";
  }
  if (!(await prompts.confirmUnattestedLemma(target))) return "cancel";
  ctx.decisions.set(target, null);
  return "ok";
};

/** Bucket a cascade's decisions by the shard each surface files under — the
 * pure half of writing them back, so every shard's entries are gathered before
 * any I/O and a malformed value can throw before anything is written. */
export const groupDecisionsByShard = (
  decisions: Decisions,
): Map<string, { surface: string; value: EntryValue }[]> => {
  const byShard = new Map<string, { surface: string; value: EntryValue }[]>();
  for (const [surface, value] of decisions) {
    const shard = shardOf(surface);
    const group = byShard.get(shard) ?? [];
    group.push({ surface, value });
    byShard.set(shard, group);
  }
  return byShard;
};
