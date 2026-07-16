import * as esbuild from "esbuild";
import path from "node:path";

const watch = process.argv.includes("--watch");

const buildOptions = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  // .cjs, not .js: the package is "type": "module", but the extension host
  // loads the bundle with require(), so it must be unambiguously CommonJS.
  outfile: "dist/extension.cjs",
  external: ["vscode"],
  format: "cjs",
  platform: "node",
  target: "node18",
  sourcemap: true,
  minify: false,
  // The corpus is the sibling package in this repo (as in markit-language's
  // esbuild.mjs, one level up); esbuild compiles its TypeScript source
  // directly rather than consuming a published package. Markit remains a
  // separate repo, so it still comes from JSR's npm compatibility layer under
  // its real registry name (@jsr/earlytexts__markit) — this alias sends the
  // corpus's own "@earlytexts/markit" import (its Deno-side bare specifier) to
  // that same installed copy, so both halves of the suggestion pipeline share
  // one markit instance. (Since markit 4 source positions are plain
  // properties, a second copy would no longer break anything — one instance
  // is now just bundle tidiness.)
  alias: {
    "@earlytexts/corpus": path.resolve(import.meta.dirname, "../src/index.ts"),
    "@earlytexts/markit": path.resolve(
      import.meta.dirname,
      "node_modules/@jsr/earlytexts__markit/src/index.js",
    ),
  },
};

if (watch) {
  const ctx = await esbuild.context(buildOptions);
  await ctx.watch();
  console.log("Watching for changes...");
} else {
  await esbuild.build(buildOptions);
  console.log("Build complete.");
}
