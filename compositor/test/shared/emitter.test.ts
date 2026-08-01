/**
 * The tiny core emitter that stands in for `vscode.EventEmitter`: subscribe,
 * fire to every listener, unsubscribe via the returned Disposable, and the
 * fire-over-a-copy guarantee that lets a listener unsubscribe mid-fire without
 * the next listener being skipped.
 */

import { expect, test } from "vitest";
import { createEmitter } from "../../src/core/shared/emitter.ts";

test("fire delivers the value to every subscriber", () => {
  const emitter = createEmitter<number>();
  const seen: number[] = [];
  emitter.event((v) => seen.push(v));
  emitter.event((v) => seen.push(v * 10));
  emitter.fire(3);
  expect(seen).toEqual([3, 30]);
});

test("the Disposable unsubscribes just that listener", () => {
  const emitter = createEmitter<void>();
  let a = 0;
  let b = 0;
  const subA = emitter.event(() => a++);
  emitter.event(() => b++);
  emitter.fire();
  subA.dispose();
  emitter.fire();
  expect([a, b]).toEqual([1, 2]);
});

test("a listener unsubscribing mid-fire does not skip the next listener", () => {
  const emitter = createEmitter<void>();
  const seen: string[] = [];
  const first = emitter.event(() => {
    seen.push("first");
    first.dispose();
  });
  emitter.event(() => seen.push("second"));
  emitter.fire();
  // Both ran even though `first` removed itself while firing.
  expect(seen).toEqual(["first", "second"]);
});

test("dispose clears every listener", () => {
  const emitter = createEmitter<void>();
  let fired = 0;
  emitter.event(() => fired++);
  emitter.dispose();
  emitter.fire();
  expect(fired).toBe(0);
});
