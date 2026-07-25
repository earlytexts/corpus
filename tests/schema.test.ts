/**
 * The metadata schema check (../src/validation/schema.ts): the rules feed real
 * corpus metadata through keyViolations, which never fails on the (valid)
 * corpus, so the unknown-key and mistyped-key paths are pinned here directly —
 * as are the external-identifier forms, which the clean corpus never breaks.
 */

import { expect } from "@std/expect";
import { test } from "@std/testing/bdd";
import {
  authorIdentifiers,
  authorSchema,
  identifierViolations,
  keyViolations,
  textIdentifiers,
} from "../src/validation/schema.ts";

test("schema: keyViolations flags unknown and mistyped keys", () => {
  expect(keyViolations({ bogus: 1 }, authorSchema)).toEqual([
    'unknown key "bogus"',
  ]);
  expect(keyViolations({ birth: "1600" }, authorSchema)).toEqual([
    '"birth" should be number',
  ]);
  expect(keyViolations({ forename: "Ann" }, authorSchema)).toEqual([]);
});

test("schema: author identifiers accept VIAF digits and Wikidata Q-numbers", () => {
  expect(
    identifierViolations(
      { viaf: "49226972", wikidata: "Q37160" },
      authorIdentifiers,
    ),
  ).toEqual([]);
  // A URL rather than a bare ID, a padded VIAF, and a lowercase q are the
  // mistakes worth catching (see ../README.md#external-identifiers).
  expect(
    identifierViolations(
      { viaf: "https://viaf.org/viaf/49226972" },
      authorIdentifiers,
    ),
  ).toEqual(['"viaf" should be a VIAF cluster ID (digits)']);
  expect(identifierViolations({ viaf: "049226972" }, authorIdentifiers))
    .toEqual(['"viaf" should be a VIAF cluster ID (digits)']);
  expect(identifierViolations({ wikidata: "q37160" }, authorIdentifiers))
    .toEqual(['"wikidata" should be a Wikidata item ID ("Q" + digits)']);
});

test("schema: text identifiers accept ESTC citation numbers and TCP text IDs", () => {
  expect(
    identifierViolations({ estc: "T77181", tcp: "A52437" }, textIdentifiers),
  ).toEqual([]);
  // ECCO-TCP IDs are six digits plus a part suffix; EEBO/Evans are five digits.
  expect(identifierViolations({ tcp: "K000039.000" }, textIdentifiers))
    .toEqual([]);
  expect(identifierViolations({ tcp: "A5243" }, textIdentifiers)).toEqual([
    '"tcp" should be a TCP text ID ("A00002", "K000039.000")',
  ]);
  // "Wing N1272" is the cross-reference in the ESTC record, not its own ID.
  expect(identifierViolations({ estc: "Wing N1272" }, textIdentifiers)).toEqual(
    [
      '"estc" should be an ESTC citation number ("N", "P", "R", "S", "T" or "W" + digits)',
    ],
  );
  expect(identifierViolations({ estc: "X1234" }, textIdentifiers)).toEqual([
    '"estc" should be an ESTC citation number ("N", "P", "R", "S", "T" or "W" + digits)',
  ]);
});

test("schema: identifierViolations ignores absent and non-string values", () => {
  // A key of the wrong type is keyViolations' business, so the format check
  // stays quiet rather than reporting the same metadata twice.
  expect(identifierViolations({}, authorIdentifiers)).toEqual([]);
  expect(identifierViolations({ viaf: 49226972 }, authorIdentifiers)).toEqual(
    [],
  );
});
