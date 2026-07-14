/**
 * The whole-word matcher underpinning "Replace in Work / Author": it must hit
 * only complete words, honour case, and treat accented and Greek letters as
 * word characters so it never bites into the middle of one.
 */

import { describe, expect, it } from "vitest";
import { replaceWholeWord } from "../src/lib/wholeWord.ts";

describe("replaceWholeWord", () => {
  it("replaces standalone occurrences", () => {
    const { text, count } = replaceWholeWord(
      "vertue is its own reward; vertue again.",
      "vertue",
      "virtue",
    );
    expect(text).toBe("virtue is its own reward; virtue again.");
    expect(count).toBe(2);
  });

  it("never touches substrings", () => {
    const { text, count } = replaceWholeWord(
      "vertuous men have vertue",
      "vertue",
      "virtue",
    );
    expect(text).toBe("vertuous men have virtue");
    expect(count).toBe(1);
  });

  it("is case-sensitive", () => {
    const { text, count } = replaceWholeWord(
      "Reason and reason",
      "reason",
      "sense",
    );
    expect(text).toBe("Reason and sense");
    expect(count).toBe(1);
  });

  it("matches at string boundaries and around punctuation", () => {
    const { text, count } = replaceWholeWord("cat, (cat) cat", "cat", "dog");
    expect(text).toBe("dog, (dog) dog");
    expect(count).toBe(3);
  });

  it("treats accented letters as part of the word", () => {
    // The bare "cafe" must not match inside "café".
    const { text, count } = replaceWholeWord("café and cafe", "cafe", "shop");
    expect(text).toBe("café and shop");
    expect(count).toBe(1);
  });

  it("matches whole accented and Greek words", () => {
    expect(replaceWholeWord("a café here", "café", "inn").count).toBe(1);
    expect(replaceWholeWord("ὁ λόγος", "λόγος", "verbum").text).toBe(
      "ὁ verbum",
    );
  });

  it("escapes regex metacharacters in the search term", () => {
    const { text, count } = replaceWholeWord("a.b and axb", "a.b", "z");
    expect(text).toBe("z and axb");
    expect(count).toBe(1);
  });

  it("reports zero when nothing matches", () => {
    const { text, count } = replaceWholeWord("nothing here", "absent", "x");
    expect(text).toBe("nothing here");
    expect(count).toBe(0);
  });
});
