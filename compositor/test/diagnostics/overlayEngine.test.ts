/**
 * The inline-overlay lifecycle over fake ports: the scanned-map state, the
 * scan/drop/refresh branching gated on `enabled`/`isTarget`/`prepare`, and the
 * per-document debounced re-scan — driven through a spec that records every
 * port call and lets a test flip the gates. `Doc` is a plain path string here.
 */

import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  createOverlayEngine,
  type OverlayEngineSpec,
} from "../../src/core/diagnostics/overlayEngine.ts";

type Doc = string;
type Item = string;
type Ctx = { tag: string };

const DEBOUNCE = 300;

/** A recording overlay spec with flippable gates. `context: undefined` makes
 * `prepare` yield nothing to scan against; `nonTargets` marks docs the overlay
 * does not squiggle; `open` is the set `refresh` sweeps. */
const harness = (
  init: {
    enabled?: boolean;
    context?: Ctx | undefined;
    open?: Doc[];
    nonTargets?: Doc[];
  } = {},
) => {
  const state = {
    enabled: init.enabled ?? true,
    context: "context" in init ? init.context : ({ tag: "ctx" } as Ctx),
    open: init.open ?? ([] as Doc[]),
    nonTargets: new Set(init.nonTargets ?? []),
  };
  const events: string[] = [];
  const rendered = new Map<string, Item[]>();
  const spec: OverlayEngineSpec<Doc, Item, Ctx> = {
    enabled: () => state.enabled,
    isTarget: (doc) => !state.nonTargets.has(doc),
    pathOf: (doc) => doc,
    openDocs: () => state.open,
    // Returned as a resolved promise to exercise the awaited prepare path.
    prepare: () => Promise.resolve(state.context),
    scan: (doc, ctx) => {
      events.push(`scan(${doc},${ctx.tag})`);
      return [`${doc}!`];
    },
    render: (path, items) => {
      events.push(`render(${path})`);
      rendered.set(path, items);
    },
    clearRender: (path) => {
      events.push(`clearRender(${path})`);
      rendered.delete(path);
    },
    clearAllRender: () => {
      events.push("clearAll");
      rendered.clear();
    },
  };
  return { state, events, rendered, spec, engine: createOverlayEngine(spec) };
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/* ------------------------------- publish -------------------------------- */

test("publish records a document's findings and renders them", () => {
  const h = harness();
  h.engine.publish("a.mit", ["x"]);
  expect(h.rendered.get("a.mit")).toEqual(["x"]);
  expect(h.engine.scanned.get("a.mit")).toEqual(["x"]);
  expect(h.engine.itemsOf("a.mit")).toEqual(["x"]);
});

test("itemsOf is empty for a document never scanned", () => {
  const h = harness();
  expect(h.engine.itemsOf("never.mit")).toEqual([]);
});

/* ------------------------------ onDocument ------------------------------ */

test("onDocument scans an enabled target and publishes its findings", async () => {
  const h = harness();
  await h.engine.onDocument("a.mit");
  expect(h.engine.itemsOf("a.mit")).toEqual(["a.mit!"]);
  expect(h.events).toEqual(["scan(a.mit,ctx)", "render(a.mit)"]);
});

test("onDocument drops a document's findings when the overlay is off", async () => {
  const h = harness();
  h.engine.publish("a.mit", ["x"]);
  h.state.enabled = false;
  await h.engine.onDocument("a.mit");
  expect(h.rendered.has("a.mit")).toBe(false);
  expect(h.events).toContain("clearRender(a.mit)");
});

test("onDocument on a non-target it never scanned clears nothing", async () => {
  const h = harness({ nonTargets: ["other.mit"] });
  await h.engine.onDocument("other.mit");
  // drop short-circuits: no clearRender for a path with no findings.
  expect(h.events).toEqual([]);
});

test("onDocument drops when there is nothing to scan against yet", async () => {
  const h = harness({ context: undefined });
  h.engine.publish("a.mit", ["x"]);
  await h.engine.onDocument("a.mit");
  expect(h.rendered.has("a.mit")).toBe(false);
  expect(h.events).toContain("clearRender(a.mit)");
});

/* ------------------------------- refresh -------------------------------- */

test("refresh re-scans every open target and skips the non-targets", async () => {
  const h = harness({ open: ["a.mit", "b.txt"], nonTargets: ["b.txt"] });
  await h.engine.refresh();
  expect(h.engine.itemsOf("a.mit")).toEqual(["a.mit!"]);
  expect(h.rendered.has("b.txt")).toBe(false);
});

test("refresh clears everything when the overlay is off", async () => {
  const h = harness({ enabled: false, open: ["a.mit"] });
  h.engine.publish("a.mit", ["x"]);
  await h.engine.refresh();
  expect(h.engine.scanned.size).toBe(0);
  expect(h.events).toContain("clearAll");
});

test("refresh does nothing while there is nothing to scan against", async () => {
  const h = harness({ context: undefined, open: ["a.mit"] });
  await h.engine.refresh();
  expect(h.events).toEqual([]);
  expect(h.engine.scanned.size).toBe(0);
});

/* -------------------------------- onEdit -------------------------------- */

test("onEdit re-scans the document once the edit settles", async () => {
  const h = harness();
  h.engine.onEdit("a.mit");
  // Nothing happens until the debounce elapses.
  expect(h.events).toEqual([]);
  await vi.advanceTimersByTimeAsync(DEBOUNCE);
  expect(h.engine.itemsOf("a.mit")).toEqual(["a.mit!"]);
  expect(h.events).toEqual(["scan(a.mit,ctx)", "render(a.mit)"]);
});

test("a burst of edits collapses into a single re-scan", async () => {
  const h = harness();
  h.engine.onEdit("a.mit");
  h.engine.onEdit("a.mit");
  h.engine.onEdit("a.mit");
  await vi.advanceTimersByTimeAsync(DEBOUNCE);
  expect(h.events.filter((e) => e.startsWith("scan"))).toHaveLength(1);
});

test("onEdit is inert when the overlay is off", async () => {
  const h = harness({ enabled: false });
  h.engine.onEdit("a.mit");
  await vi.advanceTimersByTimeAsync(DEBOUNCE);
  expect(h.events).toEqual([]);
});

test("onEdit ignores a document that is not a target", async () => {
  const h = harness({ nonTargets: ["a.mit"] });
  h.engine.onEdit("a.mit");
  await vi.advanceTimersByTimeAsync(DEBOUNCE);
  expect(h.events).toEqual([]);
});

/* ---------------------------- close & dispose --------------------------- */

test("onClose forgets a document's findings and clears its squiggles", () => {
  const h = harness();
  h.engine.publish("a.mit", ["x"]);
  h.engine.onClose("a.mit");
  expect(h.engine.scanned.has("a.mit")).toBe(false);
  expect(h.events).toContain("clearRender(a.mit)");
});

test("dispose cancels a pending debounced re-scan", async () => {
  const h = harness();
  h.engine.onEdit("a.mit");
  h.engine.dispose();
  await vi.advanceTimersByTimeAsync(DEBOUNCE);
  expect(h.events).toEqual([]);
});
