/**
 * Shared helpers for the corpus scripts: where the corpus root is, and how
 * violations are assembled into a failure message. The corpus-walking and
 * validation logic itself lives in ../src (runtime-neutral); these scripts are
 * its disk bindings.
 */

import { resolve } from "node:path";

// import.meta.dirname is only undefined for remote modules; these scripts are
// always run from a local checkout.
export const corpusRoot = resolve(import.meta.dirname!, "..");

/** Assemble an assertion message from a list of violations, capped. */
export const report = (violations: string[], cap = 50): string | undefined => {
  if (violations.length === 0) return undefined;
  const shown = violations.slice(0, cap);
  const more = violations.length - shown.length;
  return (
    `${violations.length} violation(s):\n` +
    shown.join("\n") +
    (more > 0 ? `\n… and ${more} more` : "")
  );
};
