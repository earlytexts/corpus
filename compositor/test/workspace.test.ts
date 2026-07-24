/**
 * The two pure workspace decisions over fake ports: `findCorpusRoot` walking a
 * `CorpusFs` over a plain list of folder paths to the first that holds a corpus
 * (honouring a workspace-relative prefix, canonicalising via realPath), and
 * `viewMessage` mapping the model's status to the tree view's message.
 */

import { expect, test } from "vitest";
import type { CorpusFs } from "@earlytexts/corpus";
import type { CorpusModel } from "../src/core/corpusModel.ts";
import { findCorpusRoot, viewMessage } from "../src/core/workspace.ts";

/** A CorpusFs answering only `stat`/`realPath` (all `findCorpusRoot` touches):
 * `dirs` are the directory paths that exist, `files` the ones that stat as a
 * file; realPath canonicalises by suffixing `#real` so the result is visibly a
 * realPath and not the raw input. */
const fakeFs = (dirs: string[], files: string[] = []): CorpusFs => {
  const dirSet = new Set(dirs);
  const fileSet = new Set(files);
  return {
    readFile: () => Promise.resolve(null),
    readDir: () => Promise.resolve([]),
    realPath: (path) => Promise.resolve(`${path}#real`),
    stat: (path) =>
      Promise.resolve(
        dirSet.has(path)
          ? { isFile: false }
          : fileSet.has(path)
            ? { isFile: true }
            : null,
      ),
  };
};

/* ---------------------------- findCorpusRoot ---------------------------- */

test("a configured prefix roots the corpus at the folder's subdirectory", async () => {
  const fs = fakeFs(["/ws/sub/data/authors"]);
  // The trailing slash on the prefix is trimmed; the root is canonicalised.
  expect(await findCorpusRoot(fs, ["/ws"], "sub/")).toBe("/ws/sub#real");
});

test("with an empty prefix the folder itself is the root", async () => {
  const fs = fakeFs(["/ws/data/authors"]);
  expect(await findCorpusRoot(fs, ["/ws"], "")).toBe("/ws#real");
});

test("discovery picks the first folder that holds a corpus, skipping the rest", async () => {
  // /a has no data/authors; /b does; /c is never consulted.
  const fs = fakeFs(["/b/data/authors", "/c/data/authors"]);
  expect(await findCorpusRoot(fs, ["/a", "/b", "/c"], "")).toBe("/b#real");
});

test("a data/authors that is a file is not a corpus root", async () => {
  const fs = fakeFs([], ["/ws/data/authors"]);
  expect(await findCorpusRoot(fs, ["/ws"], "")).toBeUndefined();
});

test("no folder holding a corpus yields undefined", async () => {
  const fs = fakeFs([]);
  expect(await findCorpusRoot(fs, ["/a", "/b"], "")).toBeUndefined();
});

/* ------------------------------ viewMessage ----------------------------- */

/** A bare model stub — `viewMessage` reads nothing but `status`. */
const model = (status: CorpusModel["status"]): CorpusModel =>
  ({ status }) as CorpusModel;

test("no model falls back to the view's welcome content", () => {
  expect(viewMessage(undefined)).toBeUndefined();
});

test("each model status maps to its tree message", () => {
  expect(viewMessage(model("loading"))).toBe("Loading the corpus…");
  expect(viewMessage(model("failed"))).toBe("The corpus failed to load.");
  // A ready corpus shows its tree, not a message.
  expect(viewMessage(model("ready"))).toBeUndefined();
});
