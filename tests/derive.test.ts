/**
 * Per-file derivations: the register-independent data `deriveFile` extracts
 * once per compile so that neither validation nor the Compositor's curation
 * ever needs to re-tokenize an unchanged file (see src/validation/derive.ts).
 * Each case compiles a small document and checks one facet: the formatted
 * flag, the surface summaries (what counts as a candidate), and the marked
 * tokens.
 */

import { expect } from "@std/expect";
import { test } from "@std/testing/bdd";
import { compileWithPositions, format } from "@earlytexts/markit";
import { deriveFile } from "../src/validation/derive.ts";

const derive = (text: string) => {
  const { document: doc, errors } = compileWithPositions(text);
  expect(errors).toEqual([]);
  return deriveFile(text, doc);
};

const doc = (body: string): string => `# t\n\n{#1}\n${body}\n`;

test("derive: the formatted flag is the formatter's verdict", () => {
  const canonical = format("# t\n\n{#1}\nSome text.\n");
  expect(derive(canonical).formatted).toBe(true);
  expect(derive(`${canonical}\n`).formatted).toBe(false);
});

test("derive: surfaces tally folded candidate occurrences with a first line", () => {
  const { surfaces } = derive(doc("The cat saw the\nother cat."));
  expect(surfaces.get("the")).toEqual({ candidates: 2, line: 2 });
  expect(surfaces.get("cat")).toEqual({ candidates: 2, line: 2 });
  expect(surfaces.get("other")).toEqual({ candidates: 1, line: 2 });
});

test("derive: exempt and mechanical tokens are not candidates", () => {
  const { surfaces } = derive(
    doc('Writ by [p:*Will* Shake] in ["A Treatise"] on MDCCXL, page 42.'),
  );
  // Exempting markup and the mechanical classes (digits, roman numerals) are
  // out of the register whatever it contains, so they never join the tally.
  for (const absent of ["will", "shake", "a", "treatise", "mdccxl", "42"]) {
    expect(surfaces.has(absent)).toBe(false);
  }
  expect(surfaces.get("writ")?.candidates).toBe(1);
});

test("derive: exemptSurfaces are the folded surfaces inside exempting markup", () => {
  const { exemptSurfaces } = derive(
    doc('Writ by [p:*Will* Shake] in ["A Treatise"] on MDCCXL, page 42.'),
  );
  // The attested-vocabulary twin of `surfaces`: exempt tokens are out of the
  // register but still *printed*, so they belong to the corpus's vocabulary
  // (the compositor unions the two — dictionaryResolve.ts). Exemption is
  // checked before the mechanical class, so a roman-numeral-shaped word inside
  // exempting markup would count as exempt; the plain mechanical tokens here
  // (MDCCXL, 42) are outside any markup and so join neither set.
  expect(exemptSurfaces).toEqual(new Set(["will", "shake", "a", "treatise"]));
  expect(exemptSurfaces.has("mdccxl")).toBe(false);
  expect(exemptSurfaces.has("42")).toBe(false);
  expect(exemptSurfaces.has("writ")).toBe(false);
});

test("derive: possessives and fused units are candidates under their own key", () => {
  const { surfaces } = derive(doc("The bishop's reasoning a~priori."));
  // The possessive rule is the register's to apply — the summary just counts.
  expect(surfaces.get("bishop's")?.candidates).toBe(1);
  expect(surfaces.get("a priori")?.candidates).toBe(1);
});

test("derive: both versions count — a deleted word is still a candidate", () => {
  const { surfaces } = derive(doc("a [-mistak-][+mistake+] here"));
  expect(surfaces.get("mistak")?.candidates).toBe(1);
  expect(surfaces.get("mistake")?.candidates).toBe(1);
});

test("derive: sections' tokens tally too", () => {
  const { surfaces } = derive(
    '# t\n\n{#1}\nRoot words.\n\n## s\n\n[metadata]\ntitle = "S"\nbreadcrumb = "S"\n\n{#1}\nSection words.\n',
  );
  expect(surfaces.get("words")?.candidates).toBe(2);
});

test("derive: marked tokens carry surface, value, text id, and line", () => {
  const { marked } = derive(
    '# t\n\n{#1}\nplain [w:then=than] words\n\n## s\n\n[metadata]\ntitle = "S"\nbreadcrumb = "S"\n\n{#1}\nand [w:to~morrow=tomorrow]\n',
  );
  expect(marked).toEqual([
    { folded: "then", word: "than", textId: "t", line: 2 },
    { folded: "to morrow", word: "tomorrow", textId: "t.s", line: 11 },
  ]);
});

test("derive: a marked token is also a candidate surface", () => {
  const { surfaces } = derive(doc("[w:then=than]"));
  expect(surfaces.get("then")?.candidates).toBe(1);
});
