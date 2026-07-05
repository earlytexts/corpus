/**
 * Shared helpers for the corpus scripts: where the corpus root is, and how
 * violations are assembled into a failure message. The corpus-walking and
 * validation logic itself lives in ../src (runtime-neutral); these scripts are
 * its Deno bindings.
 */

export const corpusRoot = new URL("..", import.meta.url).pathname.replace(
  /\/$/,
  "",
);

/** Assemble an assertion message from a list of violations, capped. */
export const report = (violations: string[], cap = 50): string | undefined => {
  if (violations.length === 0) return undefined;
  const shown = violations.slice(0, cap);
  const more = violations.length - shown.length;
  return `${violations.length} violation(s):\n` +
    shown.join("\n") +
    (more > 0 ? `\n… and ${more} more` : "");
};
