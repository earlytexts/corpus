/**
 * The shard-write serializer: the FIFO mutex that makes a dictionary shard's
 * read-modify-write atomic against concurrent edits. The regression it guards
 * is a second edit reading a shard mid-write (seeing "") and writing back only
 * its own entry — so the shape that matters is: overlapping read-modify-writes
 * of a shared store must not interleave, and one throwing edit must not stall
 * the queue.
 */

import { expect, test } from "vitest";
import { serial } from "../src/lib/serialize.ts";

/** A read-modify-write with a gap between read and write — the window in which
 * the real bug let a second edit see a truncated (empty) shard. */
const rmw = async (
  store: { text: string },
  transform: (current: string) => string,
): Promise<void> => {
  const current = store.text;
  await delay(1);
  store.text = transform(current);
};

test("overlapping read-modify-writes do not interleave", async () => {
  const run = serial();
  const store = { text: "" };
  // Fired together, unawaited between — without the mutex the second read lands
  // in the first's write window and one of the entries is lost.
  await Promise.all([
    run(() => rmw(store, (t) => `${t}a`)),
    run(() => rmw(store, (t) => `${t}b`)),
    run(() => rmw(store, (t) => `${t}c`)),
  ]);
  expect(store.text).toBe("abc");
});

test("operations run in call order", async () => {
  const run = serial();
  const order: number[] = [];
  await Promise.all([
    run(async () => {
      await delay(3);
      order.push(1);
    }),
    run(async () => {
      await delay(1);
      order.push(2);
    }),
    run(async () => {
      order.push(3);
    }),
  ]);
  expect(order).toEqual([1, 2, 3]);
});

test("a rejected operation does not stall the queue", async () => {
  const run = serial();
  const store = { text: "" };
  const boom = run(() => Promise.reject(new Error("boom")));
  const after = run(() => rmw(store, (t) => `${t}ok`));
  await expect(boom).rejects.toThrow("boom");
  await after;
  expect(store.text).toBe("ok");
});

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));
