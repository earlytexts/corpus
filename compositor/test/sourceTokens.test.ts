/**
 * The source-token seam's edge handling: the defensive line-array guards that
 * keep token placement, masking, and slicing robust when the `lines` a caller
 * passes do not line up with the positions the compile carries (a stale or
 * truncated buffer, a position beyond the text). The happy paths are exercised
 * through hints.test.ts / suggestions*.test.ts; these pin the fallbacks.
 */

import { expect, test } from "vitest";
import {
  type Block,
  compileWithPositions,
  type Extraction,
  extractText,
} from "@jsr/earlytexts__markit";
import {
  blockTokens,
  collectBlocks,
  maskedLines,
  sliceRange,
} from "../src/core/sourceTokens.ts";

/** The single content block of a compiled one-block body, with its extraction. */
const oneBlock = (body: string): { block: Block; extraction: Extraction } => {
  const { document } = compileWithPositions(`# T\n\n{#1}\n${body}\n`);
  const block = collectBlocks(document)[0]!;
  return { block, extraction: extractText(block) };
};

test("blockTokens tolerates a token whose line is missing from the lines", () => {
  const { block, extraction } = oneBlock("Word here.");
  // No lines at all: every token widens over an empty string and keeps its
  // compiled columns rather than throwing.
  const tokens = blockTokens(block, extraction, []);
  expect(tokens.map((t) => t.display)).toEqual(["Word", "here"]);
});

test("blockTokens skips an escaped character inside a brace span", () => {
  const { block, extraction } = oneBlock("Word here.");
  // The token line carries a character-mode span holding an escaped brace; the
  // span scanner steps over the `\}` rather than closing on it.
  const lines = ["# T", "", "{#1}", "Word {a\\}b} here"];
  const tokens = blockTokens(block, extraction, lines);
  expect(tokens.map((t) => t.display)).toEqual(["Word", "here"]);
});

test("maskedLines guards every out-of-range and missing line", () => {
  const block = {
    source: { start: { line: 0, column: 0 }, end: { line: 4, column: 0 } },
  } as unknown as Block;
  const extraction = {
    text: "",
    spans: [
      // In the block's range (line 1) — but that line is a hole in `lines`.
      {
        source: { start: { line: 1, column: 0 }, end: { line: 1, column: 1 } },
        context: [],
      },
      // Beyond the (clamped) block range — its line was never blanked.
      {
        source: { start: { line: 5, column: 0 }, end: { line: 5, column: 1 } },
        context: [],
      },
    ],
  } as unknown as Extraction;
  // A sparse array: index 1 is a hole, so the range 0..2 has a missing line.
  const lines: string[] = ["line0"];
  lines[2] = "line2";
  const masked = maskedLines(block, extraction, lines);
  expect([...masked.keys()]).toEqual([0, 1, 2]); // clamped to the lines' length
  expect(masked.get(1)).toBe(""); // the missing line masks to nothing
});

test("sliceRange returns empty text for a range past the end of the lines", () => {
  expect(sliceRange([], 0, 0, 0, 5)).toBe(""); // single-line, no such line
  expect(sliceRange([], 0, 0, 1, 3)).toBe("\n"); // multi-line, neither line present
});
