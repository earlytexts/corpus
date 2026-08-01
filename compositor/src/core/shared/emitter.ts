/**
 * A minimal event/emitter, replacing `vscode.EventEmitter` in the vscode-free
 * core. The shape is a deliberate subset of vscode's — `event` is a subscribe
 * function returning a `Disposable`, so an adapter can hand a core `Event`
 * straight to `context.subscriptions.push(model.onDidChange(...))` and it just
 * works. Ten lines of core, no port needed.
 */

/** Something that can be torn down; structurally compatible with `vscode.Disposable`. */
export type Disposable = { dispose: () => void };

/** Subscribe to an event; the returned `Disposable` unsubscribes. */
export type Event<T> = (listener: (value: T) => void) => Disposable;

/** An `Event` with the fire/dispose controls kept private to the producer. */
export type Emitter<T> = {
  readonly event: Event<T>;
  fire: (value: T) => void;
  dispose: () => void;
};

export const createEmitter = <T>(): Emitter<T> => {
  const listeners = new Set<(value: T) => void>();
  return {
    event: (listener) => {
      listeners.add(listener);
      return { dispose: () => void listeners.delete(listener) };
    },
    // Iterate a copy so a listener that unsubscribes mid-fire doesn't skip the next.
    fire: (value) => {
      for (const listener of [...listeners]) listener(value);
    },
    dispose: () => listeners.clear(),
  };
};
