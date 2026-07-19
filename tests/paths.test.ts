/**
 * Textual path normalisation (../src/fs/paths.ts): the loaders lean on it for
 * every corpus path, but a well-formed corpus never carries a ".." segment, so
 * the collapsing and parent-resolving cases are pinned here directly.
 */

import { expect } from "@std/expect";
import { test } from "@std/testing/bdd";
import { normalizePath } from "../src/fs/paths.ts";

test("paths: normalizePath drops empty/'.' segments and resolves '..'", () => {
  expect(normalizePath("/a/./b//c")).toBe("/a/b/c");
  expect(normalizePath("/a/b/../c")).toBe("/a/c");
});
