/**
 * The resolution cascade behind adding a dictionary entry from the editor: how
 * a decision resolves the targets it references (registered, added here, or
 * refused) before it is written, recursing until everything bottoms out in the
 * register. Vscode-free — the prompts are injected, so the branch logic is
 * exercised directly with stubs.
 */

import { expect, test } from "vitest";
import {
  addEntry,
  type CascadePrompts,
  type Decisions,
  groupDecisionsByShard,
} from "../src/lib/dictionaryCascade.ts";

/** A context whose register/corpus membership is the given word sets. */
const ctxOf = (dictionary: string[], corpus: string[]) => {
  const decisions: Decisions = new Map();
  return {
    decisions,
    inDictionary: (word: string) =>
      decisions.has(word) || dictionary.includes(word),
    inCorpus: (word: string) => corpus.includes(word),
  };
};

/** Prompts that answer with the given scripts, one shifted per call, throwing
 * if a prompt fires more often than scripted (so an unexpected prompt fails). */
const promptsOf = (
  scripts: Partial<{
    words: (string | undefined)[];
    kind: ("modern" | "lemma" | undefined)[];
    confirm: boolean[];
  }>,
): CascadePrompts => {
  const next = <T>(queue: T[] | undefined, name: string): T => {
    if (queue === undefined || queue.length === 0) {
      throw new Error(`unexpected ${name} prompt`);
    }
    return queue.shift() as T;
  };
  return {
    promptWords: (_surface, _kind) =>
      Promise.resolve(next(scripts.words, "words")),
    pickAddKind: (_target, _choices) =>
      Promise.resolve(next(scripts.kind, "kind")),
    confirmUnattestedLemma: (_target) =>
      Promise.resolve(next(scripts.confirm, "confirm")),
  };
};

test("a modern word bottoms out immediately, with no prompt", async () => {
  const ctx = ctxOf([], []);
  const step = await addEntry("hath", "modern", ctx, promptsOf({}));
  expect(step).toBe("ok");
  expect([...ctx.decisions]).toEqual([["hath", null]]);
});

test("a respelling to an already-registered target writes just the one entry", async () => {
  const ctx = ctxOf(["virtue"], []);
  const step = await addEntry(
    "vertue",
    "respell",
    ctx,
    promptsOf({ words: ["virtue"] }),
  );
  expect(step).toBe("ok");
  expect([...ctx.decisions]).toEqual([["vertue", "virtue"]]);
});

test("a respelling to an attested-but-unregistered target cascades into adding it", async () => {
  // "increase" is in the corpus but has no entry: the contributor is asked how
  // to add it, and both entries land together.
  const ctx = ctxOf([], ["increase"]);
  const step = await addEntry(
    "encrease",
    "respell",
    ctx,
    promptsOf({ words: ["increase"], kind: ["modern"] }),
  );
  expect(step).toBe("ok");
  expect([...ctx.decisions]).toEqual([
    ["increase", null],
    ["encrease", "increase"],
  ]);
});

test("a respelling to an unattested target is refused, writing nothing", async () => {
  const ctx = ctxOf([], []);
  const step = await addEntry(
    "vertue",
    "respell",
    ctx,
    promptsOf({ words: ["nowhere"] }),
  );
  expect(step).toEqual({ rejected: expect.stringContaining("“nowhere”") });
  expect([...ctx.decisions]).toEqual([]);
});

test("each word of an expansion is resolved before the entry is written", async () => {
  // "'tis" → "it is": both targets already registered, so no add prompts.
  const ctx = ctxOf(["it", "is"], []);
  const step = await addEntry(
    "'tis",
    "respell",
    ctx,
    promptsOf({ words: ["it is"] }),
  );
  expect(step).toBe("ok");
  expect(ctx.decisions.get("'tis")).toBe("it is");
});

test("a stated lemma whose citation form is attested is added silently", async () => {
  const ctx = ctxOf([], ["increase"]);
  const step = await addEntry(
    "encrease",
    "lemma",
    ctx,
    promptsOf({ words: ["increase"] }),
  );
  expect(step).toBe("ok");
  expect([...ctx.decisions]).toEqual([
    ["increase", null],
    ["encrease", "=increase"],
  ]);
});

test("an unattested citation form is added only on confirmation", async () => {
  const ctx = ctxOf([], []);
  const step = await addEntry(
    "data",
    "lemma",
    ctx,
    promptsOf({ words: ["datum"], confirm: [true] }),
  );
  expect(step).toBe("ok");
  expect([...ctx.decisions]).toEqual([
    ["datum", null],
    ["data", "=datum"],
  ]);
});

test("declining the unattested-lemma confirmation cancels the whole entry", async () => {
  const ctx = ctxOf([], []);
  const step = await addEntry(
    "data",
    "lemma",
    ctx,
    promptsOf({ words: ["datum"], confirm: [false] }),
  );
  expect(step).toBe("cancel");
  expect([...ctx.decisions]).toEqual([]);
});

test("dismissing the target prompt cancels without writing anything", async () => {
  const ctx = ctxOf([], []);
  const step = await addEntry(
    "vertue",
    "respell",
    ctx,
    promptsOf({ words: [undefined] }),
  );
  expect(step).toBe("cancel");
  expect([...ctx.decisions]).toEqual([]);
});

test("dismissing the add-kind prompt cancels without writing anything", async () => {
  // "increase" is attested but unregistered, so the add-kind prompt fires;
  // dismissing it abandons the whole entry.
  const ctx = ctxOf([], ["increase"]);
  const step = await addEntry(
    "encrease",
    "respell",
    ctx,
    promptsOf({ words: ["increase"], kind: [undefined] }),
  );
  expect(step).toBe("cancel");
  expect([...ctx.decisions]).toEqual([]);
});

test("decisions are bucketed by the shard each surface files under", () => {
  const decisions: Decisions = new Map([
    ["apple", null],
    ["ant", "=ant"],
    ["bee", null],
  ]);
  const byShard = groupDecisionsByShard(decisions);
  expect(byShard.get("a.json")).toEqual([
    { surface: "apple", value: null },
    { surface: "ant", value: "=ant" },
  ]);
  expect(byShard.get("b.json")).toEqual([{ surface: "bee", value: null }]);
});
