import { defineConfig } from "tsup";

// Build the publishable package: bundled ESM + bundled type declarations, one
// self-contained file per entry point. Bundling the declarations is what lets
// the source keep its `.ts` import extensions (the computer's Deno build wrapper
// runs the source directly, so it must name real `.ts` files) while the shipped
// `.d.ts` carry no relative imports at all — nothing for a consumer to resolve.
export default defineConfig({
  entry: {
    index: "src/index.ts",
    wire: "src/wire.ts",
    fs: "src/fs.ts",
    harness: "tests/harness.ts",
  },
  format: ["esm"],
  target: "es2022",
  dts: true,
  sourcemap: true,
  clean: true, // wipe dist/ so stale chunks never ship
  // Dependencies (Markit) stay external so the consumer resolves its own copy;
  // tsup externalises package.json `dependencies` by default, but be explicit.
  external: ["@earlytexts/markit"],
});
