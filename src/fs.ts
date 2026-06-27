/**
 * The Deno-backed CorpusFs the build script passes to buildCatalog. Kept tiny
 * and separate so the catalogue logic stays free of direct filesystem calls
 * (and so tests can pass an in-memory equivalent).
 */

import type { CorpusFs } from "./types.ts";

export const denoCorpusFs: CorpusFs = {
  readFile: async (path) => {
    try {
      return await Deno.readTextFile(path);
    } catch {
      return null;
    }
  },
  readDir: async (path) => {
    const out: Deno.DirEntry[] = [];
    for await (const entry of Deno.readDir(path)) out.push(entry);
    return out;
  },
  realPath: (path) => Deno.realPath(path),
  stat: async (path) => {
    try {
      return { isFile: (await Deno.stat(path)).isFile };
    } catch {
      return null;
    }
  },
};
