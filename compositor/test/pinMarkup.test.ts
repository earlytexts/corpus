/**
 * The `[w:surface=value]` formatter: that the two halves are escaped so any
 * surface or value round-trips through markit's parser to exactly the token the
 * hover intended — including the structural characters (`=`, `]`, `\`) that
 * would otherwise break the element.
 */

import { expect, test } from "vitest";
import { compileWithPositions, tokenize } from "@jsr/earlytexts__markit";
import { wordMarkup } from "../src/lib/pinMarkup.ts";

/** The single word token of a one-block document built from `body`. */
const onlyToken = (body: string) => {
  const { document } = compileWithPositions(
    `# t\n\n[metadata]\ntitle = "t"\n\n{#1}\n${body}\n`,
  );
  const tokens = tokenize(document.blocks[0]!);
  expect(tokens).toHaveLength(1);
  return tokens[0]!;
};

test("builds a plain [w:surface=value] element", () => {
  expect(wordMarkup("lay", "lie")).toBe("[w:lay=lie]");
});

test("preserves the surface's original spelling and case", () => {
  expect(wordMarkup("Lay", "lie")).toBe("[w:Lay=lie]");
});

test("escapes = ] and the escape character in both halves", () => {
  expect(wordMarkup("a=b]c", "d\\e")).toBe("[w:a\\=b\\]c=d\\\\e]");
});

test("a plain pin round-trips to the intended surface and value", () => {
  const token = onlyToken(wordMarkup("lay", "lie"));
  expect(token.text).toBe("lay");
  expect(token.word).toBe("lie");
});

test("an escaped value round-trips through the parser intact", () => {
  // A contrived value carrying the structural characters, to prove the escaping
  // survives a real compile rather than just string-equality.
  const token = onlyToken(wordMarkup("lay", "li=e]"));
  expect(token.text).toBe("lay");
  expect(token.word).toBe("li=e]");
});
