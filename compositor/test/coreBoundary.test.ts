/**
 * The hexagon's wall, enforced. `src/core/` is the compositor's domain: every
 * decision, written over ports it owns, and testable without a running editor.
 * That only holds if nothing in it reaches for the outside world — so this test
 * walks the whole tree and fails on any import of `vscode`, `node:*`, or
 * `isomorphic-git` (the three the adapters exist to keep out). `check` is only
 * tsc, which is happy to resolve these, so the boundary needs its own guard.
 *
 * When this test fails, the fix is never to relax it: it is to move the code
 * that wanted the forbidden import out to an adapter, and hand the core a port.
 */

import { expect, test } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const CORE_DIR = fileURLToPath(new URL("../src/core", import.meta.url));

/** An import the core is not allowed to name — an escape from the hexagon. */
const isForbidden = (spec: string): boolean =>
  spec === "vscode" ||
  spec.startsWith("node:") ||
  spec === "isomorphic-git" ||
  spec.startsWith("isomorphic-git/");

/** Every specifier a module imports, however it phrases the import. */
const importsOf = (source: string): string[] => {
  const specs: string[] = [];
  const patterns = [
    /(?:^|[\s;])(?:import|export)[\s\S]*?from\s*["']([^"']+)["']/g,
    /(?:^|[\s;])import\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) specs.push(match[1]);
  }
  return specs;
};

const tsFiles = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return tsFiles(full);
    return entry.isFile() && entry.name.endsWith(".ts") ? [full] : [];
  });

test("src/core/ imports nothing from vscode, node:*, or isomorphic-git", () => {
  const offenders = tsFiles(CORE_DIR).flatMap((file) =>
    importsOf(fs.readFileSync(file, "utf8"))
      .filter(isForbidden)
      .map((spec) => `${path.relative(CORE_DIR, file)} → ${spec}`),
  );
  expect(offenders).toEqual([]);
});

test("the guard has files to guard", () => {
  // A safety net against the walk silently finding nothing (a moved directory,
  // a bad path) and reporting a clean core that was never inspected.
  expect(tsFiles(CORE_DIR).length).toBeGreaterThan(20);
});
