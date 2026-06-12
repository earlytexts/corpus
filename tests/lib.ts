/**
 * Shared helpers for the corpus test suites: file walking, compilation, and
 * the path conventions documented in README.md.
 */

import {
  compile,
  type MarkitDocument,
  type MarkitError,
} from "@earlytexts/markit";

export const corpusRoot = new URL("..", import.meta.url).pathname.replace(
  /\/$/,
  "",
);

export const YEAR = /^\d{4}[a-z]?$/;

export type CorpusFile = {
  /** Path relative to the corpus root, e.g. "works/hume/thn.mit". */
  path: string;
  text: string;
  doc: MarkitDocument;
  errors: MarkitError[];
};

const walk = async function* (dir: string): AsyncGenerator<string> {
  for await (const entry of Deno.readDir(`${corpusRoot}/${dir}`)) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory) yield* walk(path);
    else if (entry.name.endsWith(".mit")) yield path;
  }
};

/** Load and compile every .mit file under authors/ and works/. */
export const loadCorpus = async (): Promise<CorpusFile[]> => {
  const files: CorpusFile[] = [];
  for (const top of ["authors", "works"]) {
    for await (const path of walk(top)) {
      const text = await Deno.readTextFile(`${corpusRoot}/${path}`);
      const [doc, errors] = compile(text);
      files.push({ path, text, doc, errors });
    }
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
};

/** Whether a works/ file is (part of) a dated edition. */
export const isDated = (path: string): boolean =>
  path.split("/").some((segment) => YEAR.test(segment.replace(/\.mit$/, "")));

/**
 * The document ID implied by a file's path: dot-joined path segments after
 * works/<author>/ (prefixed with the author), with a trailing "index" dropped.
 * Compared case-insensitively against the actual root ID.
 */
export const expectedId = (path: string): string => {
  const segments = path.replace(/\.mit$/, "").split("/");
  if (segments[0] === "authors") return segments[1];
  const parts = segments.slice(1);
  if (parts[parts.length - 1] === "index") parts.pop();
  return parts.join(".");
};

/** Every text in a document, paired with its ancestors (root first). */
export const allTexts = (
  doc: MarkitDocument,
  ancestors: MarkitDocument[] = [],
): { text: MarkitDocument; ancestors: MarkitDocument[] }[] => [
  { text: doc, ancestors },
  ...doc.children.flatMap((child) => allTexts(child, [...ancestors, doc])),
];

/** Assemble an assertion message from a list of violations, capped. */
export const report = (violations: string[], cap = 50): string | undefined => {
  if (violations.length === 0) return undefined;
  const shown = violations.slice(0, cap);
  const more = violations.length - shown.length;
  return `${violations.length} violation(s):\n` +
    shown.join("\n") +
    (more > 0 ? `\n… and ${more} more` : "");
};
