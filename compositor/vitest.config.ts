import { defineConfig } from "vitest/config";
import path from "node:path";

// Mirrors esbuild.mjs: the corpus is the sibling package in this repo, resolved
// straight to its TypeScript source rather than an installed package. Markit
// stays external (JSR's npm compatibility layer); aliasing the corpus's own
// "@earlytexts/markit" import to that installed copy keeps `scanSource` (our
// hints.ts) reading the very blocks `buildCatalogue` (the corpus) and `compile`
// (a test) produced — markit tags blocks with Symbol()s (startLine/endLine)
// that only compare equal within one instance. No dedupe is needed; if Vite
// ever splits the copy into two module records, reinstate
// `resolve.dedupe: ["@jsr/earlytexts__markit"]` here.
export default defineConfig({
  resolve: {
    alias: {
      "@earlytexts/corpus/test": path.resolve(
        import.meta.dirname,
        "../src/test.ts",
      ),
      "@earlytexts/corpus": path.resolve(
        import.meta.dirname,
        "../src/index.ts",
      ),
      "@earlytexts/markit": path.resolve(
        import.meta.dirname,
        "node_modules/@jsr/earlytexts__markit/src/index.js",
      ),
    },
  },
});
