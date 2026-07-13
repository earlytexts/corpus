/**
 * The disk-backed CorpusFs binding. Built on node:fs — which Deno provides
 * natively — so this one binding serves the corpus's own Deno scripts and Node
 * hosts (the Compositor extension) alike. Kept tiny and separate from the
 * catalogue logic so that logic stays free of direct filesystem calls (and so
 * tests can pass an in-memory equivalent); it ships as part of the `build`
 * subpath (`@earlytexts/corpus/build`, which the computer's build wrapper
 * imports) and is re-exported from the main entry point.
 */

import { promises as fs } from "node:fs";
import type { CorpusFsWrite } from "./ports.ts";

export const nodeCorpusFs: CorpusFsWrite = {
  readFile: async (path) => {
    try {
      return await fs.readFile(path, "utf8");
    } catch {
      return null;
    }
  },
  readDir: async (path) =>
    (await fs.readdir(path, { withFileTypes: true })).map((entry) => ({
      name: entry.name,
      isFile: entry.isFile(),
      isDirectory: entry.isDirectory(),
    })),
  realPath: (path) => fs.realpath(path),
  stat: async (path) => {
    try {
      return { isFile: (await fs.stat(path)).isFile() };
    } catch {
      return null;
    }
  },
  writeFile: (path, text) => fs.writeFile(path, text),
  mkdir: async (path) => {
    await fs.mkdir(path, { recursive: true });
  },
  remove: (path) => fs.rm(path, { recursive: true, force: true }),
};
