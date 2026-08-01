/**
 * The body-free corpus model over fake ports: its cold-start (instant seed from
 * the derivations cache vs. full compile), the background sweep that reconciles
 * out-of-session changes, the debounced watcher that turns file events into the
 * right load (recompile / revalidate / full), the incremental recompile of just
 * the touched sources, the background write-back queue, the one-load-at-a-time
 * orchestration, and the failure path — all driven through the outbound ports
 * (`fs`/`watch`/`notify`) with an in-memory writable corpus and a fake watcher.
 */

import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { CorpusFsWrite } from "@earlytexts/corpus";
import { CORPUS_ROOT, corpus } from "@earlytexts/corpus/test";
import { writableCorpus } from "../writableCorpus.ts";
import {
  type CorpusChange,
  createCorpusModel,
  type CorpusModel,
  type CorpusModelDeps,
  type CorpusWatcher,
} from "../../src/core/model/corpusModel.ts";

const ROOT = CORPUS_ROOT;
const DEBOUNCE = 300;

const ED_1748 = `${ROOT}/data/works/hume/enquiry/1748.mit`;
const ED_1750 = `${ROOT}/data/works/hume/enquiry/1750.mit`;
const DICT_T = `${ROOT}/data/dictionary/t.json`;

/* ------------------------------- fixtures ------------------------------- */

/** A minimal but genuine corpus: one author, one work, one edition (plus a
 * dictionary shard so validation has something to read). */
const oneEdition = (
  body = "{#1}\nThe wombat and the wombat sleep.",
): Record<string, string> =>
  corpus()
    .author("hume", { forename: "David", surname: "Hume" })
    .work("hume", "enquiry", {
      title: "An Enquiry",
      breadcrumb: "Enquiry",
      canonical: "1748",
    })
    .edition(
      "hume",
      "enquiry",
      "1748",
      {
        imported: false,
        title: "An Enquiry",
        breadcrumb: "Enquiry",
        published: [1748],
      },
      body,
    )
    .file("data/dictionary/t.json", '{\n  "the": null\n}\n')
    .build();

/** Two editions of the one work — for the removal and multi-delete paths. */
const twoEditions = (): Record<string, string> =>
  corpus()
    .author("hume", { forename: "David", surname: "Hume" })
    .work("hume", "enquiry", {
      title: "An Enquiry",
      breadcrumb: "Enquiry",
      canonical: "1748",
    })
    .edition(
      "hume",
      "enquiry",
      "1748",
      {
        imported: false,
        title: "An Enquiry",
        breadcrumb: "Enquiry",
        published: [1748],
      },
      "{#1}\nThe wombat sleeps.",
    )
    .edition(
      "hume",
      "enquiry",
      "1750",
      {
        imported: false,
        title: "An Enquiry",
        breadcrumb: "Enquiry",
        published: [1750],
      },
      "{#1}\nThe kangaroo sleeps.",
    )
    .file("data/dictionary/t.json", '{\n  "the": null\n}\n')
    .build();

/* -------------------------------- ports -------------------------------- */

/** A writable in-memory corpus with the extra controls the write-queue and
 * failure tests need: a gate that holds every `writeFile` open, a one-shot
 * write failure, and a read-failure toggle. */
const controllableFs = (files: Record<string, string>) => {
  const base = writableCorpus(files);
  const authorsDir = `${ROOT}/data/authors`;
  let gate: Promise<void> | undefined;
  let release: (() => void) | undefined;
  let failWriteOnce = false;
  let readFail = false;
  let readFailReason: unknown = new Error("read error");
  let failAuthorsDirOn: number | undefined;
  let authorsReads = 0;
  const nullReadPaths = new Set<string>();
  const readCounts = new Map<string, number>();
  /** Every port call, so a test can assert what a save costs the filesystem. */
  const calls = { readFile: 0, readDir: 0 };
  const fs: CorpusFsWrite = {
    ...base,
    readFile: (path) => {
      calls.readFile++;
      readCounts.set(path, (readCounts.get(path) ?? 0) + 1);
      return readFail
        ? Promise.reject(readFailReason)
        : nullReadPaths.has(path)
          ? Promise.resolve(null)
          : base.readFile(path);
    },
    readDir: (path) => {
      calls.readDir++;
      if (path === authorsDir && ++authorsReads === failAuthorsDirOn) {
        return Promise.reject(new Error("no such directory"));
      }
      return base.readDir(path);
    },
    writeFile: async (path, text) => {
      if (failWriteOnce) {
        failWriteOnce = false;
        throw new Error("disk full");
      }
      if (gate !== undefined) await gate;
      return base.writeFile(path, text);
    },
  };
  return {
    fs,
    closeGate: () => {
      gate = new Promise<void>((r) => (release = r));
    },
    openGate: () => {
      release?.();
      gate = undefined;
      release = undefined;
    },
    failWriteOnce: () => (failWriteOnce = true),
    setReadFail: (v: boolean, reason?: unknown) => {
      readFail = v;
      if (reason !== undefined) readFailReason = reason;
    },
    nullRead: (path: string) => nullReadPaths.add(path),
    /** A snapshot of the port-call tallies, for before/after comparison. */
    calls: () => ({ ...calls }),
    /** How often an absolute path has been read — so a test can assert a warm
     * cache served a request rather than recompiling from disk. */
    reads: (path: string) => readCounts.get(path) ?? 0,
    // Fail the Nth `readDir(data/authors)` — the sweep's own walk is the third
    // (two cold-start reads precede it), so `3` makes the sweep's directory walk
    // hit its missing-directory catch without breaking the cold start.
    failAuthorsDirOn: (n: number) => (failAuthorsDirOn = n),
  };
};

/** A fake `CorpusWatcher` that captures the model's `onEvent` so a test can
 * drive file events, and records its disposal. */
const fakeWatcher = () => {
  const state = {
    handler: undefined as ((path: string) => void) | undefined,
    disposed: false,
  };
  const watch: CorpusWatcher = (_root, onEvent) => {
    state.handler = onEvent;
    return { dispose: () => (state.disposed = true) };
  };
  return { watch, state };
};

const setup = (files: Record<string, string> = oneEdition()) => {
  const controls = controllableFs(files);
  const watcher = fakeWatcher();
  const notify = { error: vi.fn() };
  const deps: CorpusModelDeps = {
    fs: controls.fs,
    watch: watcher.watch,
    notify,
  };
  return { files, controls, watcher, notify, deps };
};

/* ------------------------------- timing -------------------------------- */

/** Advance any debounce timer by `ms`, then drain the microtask queue enough
 * turns to settle the whole async load → sweep → write-back cascade. */
const flush = async (ms = 0): Promise<void> => {
  await vi.advanceTimersByTimeAsync(ms);
  for (let i = 0; i < 200; i++) await Promise.resolve();
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/** Seed a `files` map with a valid `catalogue/derivations.json` by running one
 * model to a full compile (its write-back populates the map), then disposing
 * it — so a second model over the same map takes the instant-seed cold path. */
const withDerivations = async (
  files: Record<string, string>,
): Promise<void> => {
  const first = setup(files);
  const model = createCorpusModel(ROOT, first.deps);
  await flush();
  model.dispose();
  expect(files[`${ROOT}/catalogue/derivations.json`]).toBeDefined();
};

const fire = (watcher: ReturnType<typeof fakeWatcher>, path: string): void =>
  watcher.state.handler!(path);

/* ------------------------------ cold start ------------------------------ */

test("with no derivations cache, cold start does a full compile and writes the build output", async () => {
  const { files, notify, deps } = setup();
  const model = createCorpusModel(ROOT, deps);
  // Loading before the first compile settles.
  expect(model.loading).toBe(true);
  expect(model.status).toBe("loading");
  expect(model.loaded).toBe(false);

  await flush();

  expect(model.loading).toBe(false);
  expect(model.status).toBe("ready");
  expect(model.loaded).toBe(true);
  expect(model.state).toBeDefined();
  expect(notify.error).not.toHaveBeenCalled();
  // The full compile wrote the catalogue and the derivations cache.
  expect(files[`${ROOT}/catalogue/derivations.json`]).toBeDefined();
  expect(files[`${ROOT}/catalogue/catalogue.json`]).toBeDefined();
  model.dispose();
});

test("with a valid derivations cache, cold start seeds instantly and the sweep finds nothing to do", async () => {
  const files = oneEdition();
  await withDerivations(files);

  const { notify, deps } = setup(files);
  const model = createCorpusModel(ROOT, deps);
  await flush();

  expect(model.status).toBe("ready");
  expect(model.state?.vocabulary.has("wombat")).toBe(true);
  expect(notify.error).not.toHaveBeenCalled();
  model.dispose();
});

test("the sweep recompiles a source changed out of session", async () => {
  const files = oneEdition();
  await withDerivations(files);
  // Change the edition on disk before the second model reads the cache.
  files[ED_1748] = files[ED_1748].replace("wombat", "platypus");

  const { deps } = setup(files);
  const model = createCorpusModel(ROOT, deps);
  await flush();

  expect(model.state?.vocabulary.has("platypus")).toBe(true);
  model.dispose();
});

test("the sweep does a full reload when a new source appears", async () => {
  const files = oneEdition();
  await withDerivations(files);
  files[ED_1750] = files[ED_1748].replace("1748", "1750").replace(
    "wombat and the wombat sleep",
    "kangaroo sleeps",
  );

  const { deps } = setup(files);
  const model = createCorpusModel(ROOT, deps);
  await flush();

  expect(model.state?.vocabulary.has("kangaroo")).toBe(true);
  expect(model.state?.vocabulary.has("wombat")).toBe(true);
  model.dispose();
});

test("the sweep does a full reload when a source is removed", async () => {
  const files = twoEditions();
  await withDerivations(files);
  delete files[ED_1750];

  const { deps } = setup(files);
  const model = createCorpusModel(ROOT, deps);
  await flush();

  expect(model.state?.vocabulary.has("kangaroo")).toBe(false);
  expect(model.state?.vocabulary.has("wombat")).toBe(true);
  model.dispose();
});

test("the sweep tolerates a source directory that cannot be read", async () => {
  const files = oneEdition();
  await withDerivations(files);

  const { controls, notify, deps } = setup(files);
  // The sweep's own `authors/` walk throws; it swallows the error, treats the
  // authors record as removed, and reconciles with a full reload.
  controls.failAuthorsDirOn(3);
  const model = createCorpusModel(ROOT, deps);
  await flush();

  expect(model.status).toBe("ready");
  expect(model.state?.vocabulary.has("wombat")).toBe(true);
  expect(notify.error).not.toHaveBeenCalled();
  model.dispose();
});

test("the sweep skips a listed source that reads back as gone", async () => {
  const files = oneEdition();
  await withDerivations(files);

  const { controls, notify, deps } = setup(files);
  // The source is still listed by the directory walk but reads as null; the
  // sweep skips it rather than treating it as changed.
  controls.nullRead(ED_1748);
  const model = createCorpusModel(ROOT, deps);
  await flush();

  expect(model.status).toBe("ready");
  expect(notify.error).not.toHaveBeenCalled();
  model.dispose();
});

/* ------------------------------- watcher ------------------------------- */

test("a .mit save recompiles just that file (body edit keeps the structure)", async () => {
  const { files, watcher, deps } = setup();
  const model = createCorpusModel(ROOT, deps);
  await flush();

  // A body-only edit within the same block: the skeleton is unchanged.
  files[ED_1748] = files[ED_1748].replaceAll("wombat", "platypus");
  fire(watcher, ED_1748);
  await flush(DEBOUNCE);

  expect(model.state?.vocabulary.has("platypus")).toBe(true);
  expect(model.state?.vocabulary.has("wombat")).toBe(false);
  model.dispose();
});

test("a .mit save that changes the structure rebuilds the catalogue", async () => {
  const { files, watcher, deps } = setup();
  const model = createCorpusModel(ROOT, deps);
  await flush();

  // A new block changes the skeleton, forcing the structure rebuild.
  files[ED_1748] =
    `${files[ED_1748]}\n\n{#2}\nA second section about platypus.`;
  fire(watcher, ED_1748);
  await flush(DEBOUNCE);

  expect(model.state?.vocabulary.has("platypus")).toBe(true);
  model.dispose();
});

test("deleting a .mit drops its record and its written-back document", async () => {
  const { files, watcher, deps } = setup(twoEditions());
  const model = createCorpusModel(ROOT, deps);
  await flush();
  expect(model.state?.vocabulary.has("kangaroo")).toBe(true);

  delete files[ED_1750];
  fire(watcher, ED_1750);
  await flush(DEBOUNCE);

  expect(model.state?.vocabulary.has("kangaroo")).toBe(false);
  expect(model.state?.vocabulary.has("wombat")).toBe(true);
  model.dispose();
});

test("two deletions in one burst reuse the pre-edit doc-key lookup", async () => {
  const { files, watcher, deps } = setup(twoEditions());
  const model = createCorpusModel(ROOT, deps);
  await flush();

  delete files[ED_1748];
  delete files[ED_1750];
  fire(watcher, ED_1748);
  fire(watcher, ED_1750);
  await flush(DEBOUNCE);

  expect(model.state?.vocabulary.has("wombat")).toBe(false);
  expect(model.state?.vocabulary.has("kangaroo")).toBe(false);
  model.dispose();
});

test("a dictionary-shard save revalidates without a recompile", async () => {
  const { files, watcher, notify, deps } = setup();
  const model = createCorpusModel(ROOT, deps);
  await flush();

  files[DICT_T] = '{\n  "the": null,\n  "wombat": null\n}\n';
  fire(watcher, DICT_T);
  await flush(DEBOUNCE);

  expect(model.status).toBe("ready");
  expect(model.state).toBeDefined();
  expect(notify.error).not.toHaveBeenCalled();
  model.dispose();
});

test("a non-.mit data change and a change outside data both force a full reload", async () => {
  const { watcher, notify, deps } = setup();
  const model = createCorpusModel(ROOT, deps);
  await flush();

  // A non-.mit file under data/ is structural.
  fire(watcher, `${ROOT}/data/works/hume/enquiry/notes.txt`);
  await flush(DEBOUNCE);
  expect(model.status).toBe("ready");

  // A path outside data/ has no data-relative kind and is treated as full.
  fire(watcher, `${ROOT}/README.md`);
  await flush(DEBOUNCE);
  expect(model.status).toBe("ready");
  expect(notify.error).not.toHaveBeenCalled();
  model.dispose();
});

/* ---------------------------- orchestration ---------------------------- */

test("a reload requested mid-load is queued and replayed (latest wins)", async () => {
  const { deps } = setup();
  const model = createCorpusModel(ROOT, deps);
  // Still loading from construction — these are queued, latest wins.
  expect(model.loading).toBe(true);
  model.reload();
  model.reload();

  await flush();
  expect(model.status).toBe("ready");
  model.dispose();
});

test("reload recompiles everything from disk", async () => {
  const { files, deps } = setup();
  const model = createCorpusModel(ROOT, deps);
  await flush();

  files[ED_1748] = files[ED_1748].replace("wombat", "platypus");
  await model.reload();
  await flush();

  expect(model.state?.vocabulary.has("platypus")).toBe(true);
  model.dispose();
});

/* ------------------------------ failure ------------------------------ */

test("a load failure clears the state, notifies, and reports 'failed'", async () => {
  const { controls, notify, deps } = setup();
  controls.setReadFail(true);
  const model = createCorpusModel(ROOT, deps);
  await flush();

  expect(model.status).toBe("failed");
  expect(model.state).toBeUndefined();
  expect(model.loaded).toBe(true);
  expect(notify.error).toHaveBeenCalledWith(
    expect.stringContaining("corpus load failed"),
  );
  model.dispose();
});

test("a non-Error thrown by a load is still reported", async () => {
  const { controls, notify, deps } = setup();
  controls.setReadFail(true, "boom");
  const model = createCorpusModel(ROOT, deps);
  await flush();

  expect(model.status).toBe("failed");
  expect(notify.error).toHaveBeenCalledWith(
    expect.stringContaining("corpus load failed: boom"),
  );
  model.dispose();
});

test("a delete event after a failed load rebuilds without a resident doc-key map", async () => {
  const { files, controls, watcher, deps } = setup();
  controls.setReadFail(true);
  const model = createCorpusModel(ROOT, deps);
  await flush();
  expect(model.state).toBeUndefined();

  // Reads recover, but with no resident state the removal has no pre-edit
  // catalogue to look a doc-key up in — it simply rebuilds.
  controls.setReadFail(false);
  delete files[ED_1748];
  fire(watcher, ED_1748);
  await flush(DEBOUNCE);

  expect(model.status).toBe("ready");
  expect(model.state).toBeDefined();
  model.dispose();
});

test("a dictionary event after a failed load falls back to a full compile", async () => {
  const { controls, watcher, notify, deps } = setup();
  controls.setReadFail(true);
  const model = createCorpusModel(ROOT, deps);
  await flush();
  expect(model.status).toBe("failed");

  // Reads recover; a dictionary event now has no resident state to revalidate,
  // so loadDictionary falls back to a full compile.
  controls.setReadFail(false);
  fire(watcher, DICT_T);
  await flush(DEBOUNCE);

  expect(model.status).toBe("ready");
  expect(model.state).toBeDefined();
  expect(notify.error).toHaveBeenCalledTimes(1);
  model.dispose();
});

/* ---------------------------- write queue ---------------------------- */

test("a burst of incremental saves coalesces into a single write-back", async () => {
  const { files, controls, watcher, deps } = setup();
  // Hold every write open from the outset: the cold-start write parks, so the
  // writer stays busy and later enqueues coalesce onto one pending docs write.
  controls.closeGate();
  const model = createCorpusModel(ROOT, deps);
  await flush();

  files[ED_1748] = files[ED_1748].replaceAll("wombat", "platypus");
  fire(watcher, ED_1748);
  await flush(DEBOUNCE);
  files[ED_1748] = files[ED_1748].replaceAll("platypus", "aardvark");
  fire(watcher, ED_1748);
  await flush(DEBOUNCE);

  controls.openGate();
  await flush();

  expect(model.state?.vocabulary.has("aardvark")).toBe(true);
  model.dispose();
});

test("a full rewrite supersedes a pending docs write-back", async () => {
  const { files, controls, watcher, deps } = setup();
  controls.closeGate();
  const model = createCorpusModel(ROOT, deps);
  await flush();

  // An incremental leaves a docs write-back pending behind the parked cold write.
  files[ED_1748] = files[ED_1748].replaceAll("wombat", "platypus");
  fire(watcher, ED_1748);
  await flush(DEBOUNCE);
  // A full reload supersedes the pending docs write.
  await model.reload();
  await flush();

  controls.openGate();
  await flush();

  expect(model.status).toBe("ready");
  model.dispose();
});

test("an incremental save while a full rewrite is pending is dropped", async () => {
  const { files, controls, watcher, deps } = setup();
  controls.closeGate();
  const model = createCorpusModel(ROOT, deps);
  await flush();

  // A full reload leaves a full write pending behind the parked cold write.
  await model.reload();
  await flush();
  // An incremental now finds a pending full and does not enqueue.
  files[ED_1748] = files[ED_1748].replaceAll("wombat", "platypus");
  fire(watcher, ED_1748);
  await flush(DEBOUNCE);

  controls.openGate();
  await flush();

  expect(model.status).toBe("ready");
  model.dispose();
});

test("a failing write-back is swallowed and does not fail the model", async () => {
  const { files, controls, watcher, notify, deps } = setup();
  const model = createCorpusModel(ROOT, deps);
  await flush();

  controls.failWriteOnce();
  files[ED_1748] = files[ED_1748].replace("wombat", "platypus");
  fire(watcher, ED_1748);
  await flush(DEBOUNCE);

  expect(model.status).toBe("ready");
  expect(model.state?.vocabulary.has("platypus")).toBe(true);
  expect(notify.error).not.toHaveBeenCalled();
  model.dispose();
});

/* --------------------------- reads & getters --------------------------- */

test("getCompiledFile compiles a present source and returns undefined for a missing one", async () => {
  const { deps } = setup();
  const model = createCorpusModel(ROOT, deps);
  await flush();

  const present = await model.getCompiledFile("works/hume/enquiry/1748.mit");
  expect(present?.text).toContain("wombat");
  const missing = await model.getCompiledFile("works/hume/enquiry/nope.mit");
  expect(missing).toBeUndefined();
  model.dispose();
});

test("workSourcePaths lists the works sources and excludes the authors", async () => {
  const { deps } = setup();
  const model = createCorpusModel(ROOT, deps);
  await flush();

  const paths = model.workSourcePaths();
  expect(paths).toContain("works/hume/enquiry/1748.mit");
  expect(paths).toContain("works/hume/enquiry/index.mit");
  expect(paths.some((p) => p.startsWith("authors/"))).toBe(false);
  model.dispose();
});

/* ------------------------------ the fan-out ------------------------------ */

/** Record the change payload of every settled load, plus the starts, so a test
 * can assert both the count and the scope. */
const listen = (model: CorpusModel) => {
  const changes: CorpusChange[] = [];
  let starts = 0;
  const subs = [
    model.onDidChange((change) => changes.push(change)),
    model.onDidStartLoading(() => starts++),
  ];
  return {
    changes,
    starts: () => starts,
    last: () => changes[changes.length - 1],
    dispose: () => subs.forEach((s) => s.dispose()),
  };
};

test("a load starts once and settles once, and only the settle carries a change", async () => {
  const files = oneEdition();
  await withDerivations(files);
  const { watcher, deps } = setup(files);
  const model = createCorpusModel(ROOT, deps);
  await flush();
  const heard = listen(model);

  files[ED_1748] = files[ED_1748].replace("wombat", "kangaroo");
  fire(watcher, ED_1748);
  await flush(DEBOUNCE);

  // One save: one start, one settle — not the two undifferentiated fires every
  // listener used to have to filter on `loading` itself to avoid doing its work
  // twice (and, for the hint miner, twice concurrently).
  expect(heard.starts()).toBe(1);
  expect(heard.changes).toHaveLength(1);
  expect(model.loading).toBe(false);
  heard.dispose();
  model.dispose();
});

test("a cold start reports a full change", async () => {
  const { deps } = setup();
  const model = createCorpusModel(ROOT, deps);
  const heard = listen(model);
  await flush();

  expect(heard.last()).toEqual({
    kind: "full",
    sources: new Set(),
    structural: true,
  });
  heard.dispose();
  model.dispose();
});

test("a body-only save reports just that source, and not as structural", async () => {
  const files = oneEdition();
  await withDerivations(files);
  const { watcher, deps } = setup(files);
  const model = createCorpusModel(ROOT, deps);
  await flush();
  const heard = listen(model);

  files[ED_1748] = files[ED_1748].replace("wombat", "kangaroo");
  fire(watcher, ED_1748);
  await flush(DEBOUNCE);

  expect(heard.changes).toHaveLength(1);
  expect(heard.last()).toEqual({
    kind: "sources",
    sources: new Set(["works/hume/enquiry/1748.mit"]),
    structural: false,
  });
  heard.dispose();
  model.dispose();
});

test("a save that changes the structure reports it as structural", async () => {
  const files = oneEdition();
  await withDerivations(files);
  const { watcher, deps } = setup(files);
  const model = createCorpusModel(ROOT, deps);
  await flush();
  const heard = listen(model);

  // Metadata is what a skeleton keeps (its blocks are emptied), so retitling
  // the edition moves the catalogue and a body edit does not.
  files[ED_1748] = files[ED_1748].replace(
    'title = "An Enquiry"',
    'title = "An Enquiry, Revised"',
  );
  fire(watcher, ED_1748);
  await flush(DEBOUNCE);

  expect(heard.last()?.structural).toBe(true);
  heard.dispose();
  model.dispose();
});

test("a save that breaks the compile is structural even though the skeleton is unchanged", async () => {
  // `projection.clean` gates every cross-file rule but is not skeleton-derived:
  // an unclosed inline tag leaves the id/metadata/children the skeleton keeps
  // untouched while flipping the file out of the cleanly-compiled set. The
  // scoped tiers key off `structural`, so it has to cover this too.
  const files = oneEdition();
  await withDerivations(files);
  const { watcher, deps } = setup(files);
  const model = createCorpusModel(ROOT, deps);
  await flush();
  const heard = listen(model);

  files[ED_1748] = files[ED_1748].replace("The wombat", "The [p:wombat");
  fire(watcher, ED_1748);
  await flush(DEBOUNCE);

  expect(heard.last()?.structural).toBe(true);
  heard.dispose();
  model.dispose();
});

test("a dictionary shard save reports the dictionary scope and no sources", async () => {
  const files = oneEdition();
  await withDerivations(files);
  const { watcher, deps } = setup(files);
  const model = createCorpusModel(ROOT, deps);
  await flush();
  const heard = listen(model);

  files[DICT_T] = '{\n  "the": null,\n  "thus": null\n}\n';
  fire(watcher, DICT_T);
  await flush(DEBOUNCE);

  expect(heard.last()).toEqual({
    kind: "dictionary",
    sources: new Set(),
    structural: false,
  });
  heard.dispose();
  model.dispose();
});

test("a failed load reports a full change, so no listener trusts a narrower scope", async () => {
  const { controls, notify, deps } = setup();
  controls.setReadFail(true);
  const model = createCorpusModel(ROOT, deps);
  const heard = listen(model);
  await flush();

  expect(notify.error).toHaveBeenCalled();
  expect(model.status).toBe("failed");
  expect(heard.changes).toHaveLength(1);
  expect(heard.last()?.kind).toBe("full");
  heard.dispose();
  model.dispose();
});

/* -------------------------- the working set -------------------------- */

test("compileTransient compiles a source without evicting the working set", async () => {
  const { deps } = setup();
  const model = createCorpusModel(ROOT, deps);
  await flush();

  const file = await model.compileTransient("works/hume/enquiry/1748.mit");
  expect(file?.text).toContain("wombat");
  expect(
    await model.compileTransient("works/hume/enquiry/nope.mit"),
  ).toBeUndefined();
  model.dispose();
});

test("an incremental save leaves the file it recompiled warm", async () => {
  const files = oneEdition();
  await withDerivations(files);
  const { controls, watcher, deps } = setup(files);
  const model = createCorpusModel(ROOT, deps);
  await flush();

  files[ED_1748] = files[ED_1748].replace("wombat", "kangaroo");
  fire(watcher, ED_1748);
  await flush(DEBOUNCE);

  // The save already compiled it; asking for it must not read it again.
  const before = controls.reads(ED_1748);
  const file = await model.getCompiledFile("works/hume/enquiry/1748.mit");
  expect(file?.text).toContain("kangaroo");
  expect(controls.reads(ED_1748)).toBe(before);
  model.dispose();
});

/* ------------------------------ dispose ------------------------------ */

test("dispose clears a pending debounce timer and tears the watcher down", async () => {
  const { watcher, deps } = setup();
  const model = createCorpusModel(ROOT, deps);
  await flush();

  // A queued event leaves a live timer; dispose must clear it.
  fire(watcher, ED_1748);
  model.dispose();

  expect(watcher.state.disposed).toBe(true);
  // The timer was cleared: advancing past the debounce triggers no reload.
  await flush(DEBOUNCE);
  expect(watcher.state.disposed).toBe(true);
});

test("dispose with no pending timer still tears the watcher down", async () => {
  const { watcher, deps } = setup();
  const model = createCorpusModel(ROOT, deps);
  await flush();

  model.dispose();
  expect(watcher.state.disposed).toBe(true);
});

/* ------------------------ what a save actually costs ------------------------ */

test("a body-only save does not walk the corpus or re-read the register", async () => {
  // The cross-file tier is the only one that touches the filesystem, and it does
  // so heavily (a recursive `data/**` walk plus a probe per stub and borrowed
  // ref). A save that moves neither a skeleton nor a file's compile-cleanliness
  // cannot change what it reports, so it must not run — and the register, which
  // only a shard edit can change, must not be re-read or re-expanded either.
  const files = oneEdition();
  await withDerivations(files);
  const { controls, watcher, deps } = setup(files);
  const model = createCorpusModel(ROOT, deps);
  await flush();

  const before = controls.calls();
  files[ED_1748] = files[ED_1748].replace("wombat", "kangaroo");
  fire(watcher, ED_1748);
  await flush(DEBOUNCE);
  const after = controls.calls();

  // No directory walk at all, and exactly one file read: the saved source. That
  // single read is the whole assertion — it leaves no room for the shard read,
  // the reference word list, or a resolution probe.
  expect(after.readDir - before.readDir).toBe(0);
  expect(after.readFile - before.readFile).toBe(1);
  model.dispose();
});

test("a structural save does run the cross-file tier", async () => {
  const files = oneEdition();
  await withDerivations(files);
  const { controls, watcher, deps } = setup(files);
  const model = createCorpusModel(ROOT, deps);
  await flush();

  const before = controls.calls();
  files[ED_1748] = files[ED_1748].replace(
    'title = "An Enquiry"',
    'title = "An Enquiry, Revised"',
  );
  fire(watcher, ED_1748);
  await flush(DEBOUNCE);

  expect(controls.calls().readDir).toBeGreaterThan(before.readDir);
  model.dispose();
});

test("the violations after a scoped save match a from-scratch validation", async () => {
  // The tier cache must never drift from what a full recompose would produce.
  const files = twoEditions();
  await withDerivations(files);
  const { watcher, deps } = setup(files);
  const scoped = createCorpusModel(ROOT, deps);
  await flush();

  // A body edit (dict-dependent only), then a structural one (cross-file too).
  files[ED_1748] = files[ED_1748].replace("wombat", "[w:kangaroo]");
  fire(watcher, ED_1748);
  await flush(DEBOUNCE);
  files[ED_1750] = files[ED_1750].replace(
    'title = "An Enquiry"',
    'title = "An Enquiry, Revised"',
  );
  fire(watcher, ED_1750);
  await flush(DEBOUNCE);

  // A second model over the same files takes the whole-corpus path throughout.
  const fresh = setup(files);
  const reference = createCorpusModel(ROOT, fresh.deps);
  await flush();

  const key = (v: { rule: string; path: string; message: string }) =>
    `${v.rule}|${v.path}|${v.message}`;
  expect(scoped.state!.violations.map(key).sort()).toEqual(
    reference.state!.violations.map(key).sort(),
  );
  scoped.dispose();
  reference.dispose();
});

/* ------------------------- the register after an edit ------------------------- */

test("a shard save refreshes the expanded register, in memory and on disk", async () => {
  const files = oneEdition();
  await withDerivations(files);
  const { watcher, deps } = setup(files);
  const model = createCorpusModel(ROOT, deps);
  await flush();
  expect(model.state!.catalogue.dictionary).not.toHaveProperty("thus");

  files[DICT_T] = '{\n  "the": null,\n  "thus": null\n}\n';
  fire(watcher, DICT_T);
  await flush(DEBOUNCE);

  // The catalogue's register is what hover and the unaccounted-word overlay
  // read; leaving it stale kept a just-registered word squiggled.
  expect(model.state!.catalogue.dictionary).toHaveProperty("thus");
  // And the computer's input must not drift from the shards either.
  expect(files[`${ROOT}/catalogue/dictionary.json`]).toContain("thus");
  model.dispose();
});

test("a shard save behind a queued write is covered by that wider write", async () => {
  const files = oneEdition();
  await withDerivations(files);
  const { controls, watcher, deps } = setup(files);
  const model = createCorpusModel(ROOT, deps);
  await flush();

  // One write parked at the gate, a second queued behind it — then a shard
  // edit. The queued docs write already rewrites dictionary.json, so the
  // register edit must not stack a third write behind it.
  controls.closeGate();
  files[ED_1748] = files[ED_1748].replace("wombat", "kangaroo");
  fire(watcher, ED_1748);
  await flush(DEBOUNCE);
  files[ED_1748] = files[ED_1748].replace("kangaroo", "platypus");
  fire(watcher, ED_1748);
  await flush(DEBOUNCE);
  files[DICT_T] = '{\n  "the": null,\n  "thus": null\n}\n';
  fire(watcher, DICT_T);
  await flush(DEBOUNCE);

  controls.openGate();
  await flush();

  expect(model.status).toBe("ready");
  expect(files[`${ROOT}/catalogue/dictionary.json`]).toContain("thus");
  model.dispose();
});

test("a queued write-back draining after a failed load writes nothing", async () => {
  const files = oneEdition();
  await withDerivations(files);
  const { controls, watcher, notify, deps } = setup(files);
  const model = createCorpusModel(ROOT, deps);
  await flush();

  // Park one write at the gate and queue a second, then fail a load so nothing
  // is resident by the time the queue gets to that second write.
  controls.closeGate();
  files[ED_1748] = files[ED_1748].replace("wombat", "kangaroo");
  fire(watcher, ED_1748);
  await flush(DEBOUNCE);
  files[ED_1748] = files[ED_1748].replace("kangaroo", "platypus");
  fire(watcher, ED_1748);
  await flush(DEBOUNCE);

  controls.setReadFail(true);
  await model.reload();
  await flush();
  controls.openGate();
  await flush();

  expect(notify.error).toHaveBeenCalled();
  expect(model.status).toBe("failed");
  model.dispose();
});
