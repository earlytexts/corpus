/**
 * Corpus validation: every file must be valid Markit, formatted canonically,
 * and conform to the metadata schema and layout conventions in ../README.md.
 * The rules live in ../src/validate.ts (runtime-neutral, also consumed by the
 * Compositor extension); this suite runs each rule as a vitest test over the
 * real corpus on disk. Run with: npm run validate.
 */

import { test } from "@std/testing/bdd";
import {
  loadCorpus,
  type RuleContext,
  rules,
  violationText,
} from "../src/validate.ts";
import { nodeCorpusFs } from "../src/fs.ts";
import { corpusRoot, report } from "../scripts/lib.ts";

const ctx: RuleContext = {
  files: await loadCorpus(nodeCorpusFs, corpusRoot),
  fs: nodeCorpusFs,
  root: corpusRoot,
};

for (const rule of rules) {
  test(rule.name, async () => {
    const message = report((await rule.check(ctx)).map(violationText));
    if (message !== undefined) throw new Error(message);
  });
}
