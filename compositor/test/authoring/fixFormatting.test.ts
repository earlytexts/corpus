/**
 * The one-click "fix formatting" sweep: walk every `.mit` under `data/`, run the
 * Markit formatter, and rewrite only the files it actually changed, over the
 * corpus filesystem port. Exercised over the writable in-memory corpus, with a
 * hand-rolled port for the one path memoryCorpus cannot produce (a listed file
 * that reads back null).
 */

import { expect, test } from "vitest";
import { format } from "@jsr/earlytexts__markit";
import type { CorpusFsWrite } from "@earlytexts/corpus";
import { CORPUS_ROOT } from "@earlytexts/corpus/test";
import { formatCorpus } from "../../src/core/authoring/fixFormatting.ts";
import { writableCorpus } from "../writableCorpus.ts";

const tidy = format('# Foo\n\n[metadata]\nsurname = "Foo"\n');
const messy = '# Bar\n\n[metadata]\nsurname = "Bar"\n\n\n\n';

test("only the files the formatter changes are rewritten, and the tally counts both", async () => {
  const files: Record<string, string> = {
    // Already canonical: seen, but left untouched.
    [`${CORPUS_ROOT}/data/authors/foo.mit`]: tidy,
    // Not a .mit file: skipped entirely (not even counted).
    [`${CORPUS_ROOT}/data/authors/notes.txt`]: "leave me be",
    // Under a nested work directory, so the walk recurses; needs reformatting.
    [`${CORPUS_ROOT}/data/works/bar/enquiry/1748.mit`]: messy,
  };
  const fs = writableCorpus(files);

  const tally = await formatCorpus(fs, CORPUS_ROOT);

  expect(tally).toEqual({ changed: 1, total: 2 });
  // The messy edition was rewritten to its canonical form.
  expect(files[`${CORPUS_ROOT}/data/works/bar/enquiry/1748.mit`]).toBe(
    format(messy),
  );
  // The already-tidy author file was not touched, and the .txt untouched.
  expect(files[`${CORPUS_ROOT}/data/authors/foo.mit`]).toBe(tidy);
  expect(files[`${CORPUS_ROOT}/data/authors/notes.txt`]).toBe("leave me be");
});

test("a listed .mit file that reads back null is counted but skipped", async () => {
  const written: string[] = [];
  // A port that lists one .mit file under data/authors but cannot read it, and
  // nothing under data/works.
  const fs: CorpusFsWrite = {
    readDir: (dir) =>
      Promise.resolve(
        dir === `${CORPUS_ROOT}/data/authors`
          ? [{ name: "gone.mit", isFile: true, isDirectory: false }]
          : [],
      ),
    readFile: () => Promise.resolve(null),
    writeFile: (path) => {
      written.push(path);
      return Promise.resolve();
    },
    mkdir: () => Promise.resolve(),
    remove: () => Promise.resolve(),
    realPath: (p) => Promise.resolve(p),
    stat: () => Promise.resolve(null),
  };

  const tally = await formatCorpus(fs, CORPUS_ROOT);

  // Counted among the total, but with no text there is nothing to write.
  expect(tally).toEqual({ changed: 0, total: 1 });
  expect(written).toEqual([]);
});
