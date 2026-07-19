/**
 * The metadata schema check (../src/validation/schema.ts): the rules feed real
 * corpus metadata through keyViolations, which never fails on the (valid)
 * corpus, so the unknown-key and mistyped-key paths are pinned here directly.
 */

import { expect } from "@std/expect";
import { test } from "@std/testing/bdd";
import { authorSchema, keyViolations } from "../src/validation/schema.ts";

test("schema: keyViolations flags unknown and mistyped keys", () => {
  expect(keyViolations({ bogus: 1 }, authorSchema)).toEqual([
    'unknown key "bogus"',
  ]);
  expect(keyViolations({ birth: "1600" }, authorSchema)).toEqual([
    '"birth" should be number',
  ]);
  expect(keyViolations({ forename: "Ann" }, authorSchema)).toEqual([]);
});
