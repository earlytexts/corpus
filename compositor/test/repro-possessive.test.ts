import { expect, test } from "vitest";
import { compileWithPositions } from "@jsr/earlytexts__markit";
import {
  accountTokens,
  type Dictionary,
  expandDictionary,
  parseDictionary,
} from "@earlytexts/corpus";
import { scanUnaccounted } from "../src/lib/dictionaryScan.ts";

const dict = (entries: Record<string, unknown>): Dictionary =>
  expandDictionary(
    parseDictionary(new Map([["_.json", JSON.stringify(entries)]])).dictionary,
  );

const build = (body: string) => {
  const source = `# t\n\n[metadata]\ntitle = "t"\n\n{#1}\n${body}\n`;
  const { document } = compileWithPositions(source);
  return { source, document };
};

test("REPRO: possessive whose base is registered", () => {
  const d = dict({ the: null, bishop: null, folly: null });
  const { source, document } = build("The bishop's folly.");

  // What the corpus accounting rule says:
  console.log(
    "accountTokens:",
    accountTokens(document, d).map((a) => `${a.text}:${a.status}`),
  );

  // What the compositor's scan flags:
  const found = scanUnaccounted(source, document, d);
  console.log("scanUnaccounted:", found.map((w) => `${w.display}=>${w.surface}`));
});

test("REPRO: possessive base registered, straight vs curly apostrophe", () => {
  const d = dict({ the: null, bishop: null, folly: null });
  for (const apos of ["'", "’"]) {
    const { source, document } = build(`The bishop${apos}s folly.`);
    console.log(
      `apostrophe ${JSON.stringify(apos)} accountTokens:`,
      accountTokens(document, d).map((a) => `${a.text}:${a.status}`),
    );
    console.log(
      `apostrophe ${JSON.stringify(apos)} scan:`,
      scanUnaccounted(source, document, d).map((w) => w.display),
    );
  }
});
