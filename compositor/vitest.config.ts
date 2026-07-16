import { defineConfig } from "vitest/config";
import path from "node:path";

// Mirrors esbuild.mjs: the corpus is the sibling package in this repo, resolved
// straight to its TypeScript source rather than an installed package. Markit
// stays external (JSR's npm compatibility layer); aliasing the corpus's own
// "@earlytexts/markit" import to that installed copy keeps a single markit
// throughout. (Since markit 4 source positions are plain properties, a second
// copy would no longer break anything — one instance is now just tidiness.)
export default defineConfig({
  resolve: {
    alias: {
      "@earlytexts/corpus/test": path.resolve(
        import.meta.dirname,
        "../tests/harness.ts",
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
