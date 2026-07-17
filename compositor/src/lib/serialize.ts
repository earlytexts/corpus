/**
 * A minimal FIFO mutex. `serial()` returns a function that runs async
 * operations one at a time, in call order — the next never starts until the
 * previous has fully settled.
 *
 * The dictionary shard write is a read-modify-write (read the file, add/remove
 * an entry, write it back). Run two of those concurrently against one shard and
 * the second read can land inside the first write: VS Code's `fs.writeFile`
 * truncates before it writes, so a read in that window sees "", which the parse
 * treats as an empty shard — and the second edit writes back a shard holding
 * only its own entry, wiping the rest. Funnelling every shard write through one
 * serializer closes that window; edits are user-paced, so the queue is never a
 * bottleneck. A rejected operation never stalls the queue — the next runs
 * regardless of whether the previous resolved or threw.
 */

export const serial = (): (<T>(op: () => Promise<T>) => Promise<T>) => {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(op: () => Promise<T>): Promise<T> => {
    const run = tail.then(op, op);
    tail = run.then(noop, noop);
    return run;
  };
};

const noop = (): void => {};
