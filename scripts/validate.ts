/**
 * Corpus validation: every file must be valid Markit, formatted canonically,
 * and conform to the metadata schema and layout conventions in README.md.
 */

import { format } from "@earlytexts/markit";
import {
  allTexts,
  borrowedChild,
  type CorpusFile,
  corpusRoot,
  expectedId,
  headingSegment,
  isDated,
  loadCorpus,
  report,
  YEAR,
} from "./lib.ts";
import {
  authorRequired,
  authorSchema,
  authorSexValues,
  blockSchema,
  checkKeys,
  textSchema,
} from "../src/schema.ts";

const files = await loadCorpus();
const authorFiles = files.filter((f) => f.path.startsWith("authors/"));
const workFiles = files.filter((f) => f.path.startsWith("works/"));
/** Files that compile cleanly; schema/structure suites skip the rest to avoid
 * cascading noise — suite 1 already reports them. */
const compiled = (list: CorpusFile[]) =>
  list.filter((f) => f.errors.length === 0);

const fail = (violations: string[]): void => {
  const message = report(violations);
  if (message !== undefined) throw new Error(message);
};

/** Metadata viewed as plain entries (drops Markit's symbol-keyed ranges). */
const meta = (value: unknown): Record<string, unknown> =>
  (value ?? {}) as Record<string, unknown>;

Deno.test("every file compiles without errors", () => {
  fail(
    files.flatMap(({ path, errors }) =>
      errors.map((e) => `${path}:${e.line}:${e.column}: ${e.message}`)
    ),
  );
});

Deno.test("every file is formatted canonically", () => {
  fail(
    files.filter(({ text }) => format(text) !== text)
      .map(({ path }) =>
        `${path}: differs from formatter output (run \`deno task fix\`)`
      ),
  );
});

Deno.test("author files match the author schema", () => {
  const violations: string[] = [];
  for (const { path, doc } of compiled(authorFiles)) {
    const metadata = meta(doc.metadata);
    checkKeys(metadata, authorSchema, path, violations);
    for (const key of authorRequired) {
      if (!(key in metadata)) violations.push(`${path}: missing "${key}"`);
    }
    if (
      metadata.sex !== undefined &&
      !authorSexValues.includes(metadata.sex as string)
    ) {
      violations.push(`${path}: "sex" must be "Male" or "Female"`);
    }
    if (doc.children.length > 0) {
      violations.push(`${path}: author files cannot have sections`);
    }
    if (doc.blocks.length > 0) {
      violations.push(`${path}: author files cannot have content`);
    }
  }
  fail(violations);
});

/** A work stub: `index.mit` carrying a `canonical` pointer, metadata only. */
const isStub = (path: string, doc: { metadata?: unknown }): boolean =>
  path.endsWith("/index.mit") && "canonical" in meta(doc.metadata);

Deno.test("texts match the text schema", () => {
  const violations: string[] = [];
  for (const { path, doc } of compiled(workFiles)) {
    const dated = isDated(path);
    const stub = isStub(path, doc);
    for (const { text, ancestors } of allTexts(doc)) {
      const parent = ancestors[ancestors.length - 1];
      // A borrowed-child placeholder (`## <Hume.EHU.1750>`) carries no metadata
      // of its own; the edition it names is validated as its own file.
      if (borrowedChild(headingSegment(text.id, parent?.id)) !== undefined) {
        continue;
      }
      const where = `${path} (${text.id})`;
      const metadata = meta(text.metadata);
      checkKeys(metadata, textSchema, where, violations);
      for (const key of ["title", "breadcrumb"]) {
        if (!(key in metadata)) violations.push(`${where}: missing "${key}"`);
      }
      // A stub holds only work identity + the canonical pointer; it has no
      // text, so the imported/published presence rules don't apply to it.
      // `authors`, however, is part of a work's identity, so it is required on
      // the stub too (own value, not inherited — a stub has no ancestor).
      if (!stub) {
        for (const key of ["imported", "published", "authors"]) {
          const inherited = [...ancestors, text].some((t) =>
            key in meta(t.metadata)
          );
          if (!inherited) {
            violations.push(
              `${where}: missing "${key}" (not inherited either)`,
            );
          }
        }
      } else if (!("authors" in metadata)) {
        violations.push(`${where}: missing "authors"`);
      }
      if (dated && "copytext" in metadata) {
        violations.push(
          `${where}: "copytext" is for reading texts; dated editions are their own copytext`,
        );
      }
      if ("canonical" in metadata && !stub) {
        violations.push(
          `${where}: "canonical" belongs only on a work's index.mit stub`,
        );
      }
      if ("standalone" in metadata && !stub) {
        violations.push(
          `${where}: "standalone" belongs only on a work's index.mit stub`,
        );
      }
    }
  }
  fail(violations);
});

Deno.test("work stubs name a canonical edition that exists", async () => {
  const violations: string[] = [];
  for (const { path, doc } of compiled(workFiles)) {
    if (!isStub(path, doc)) continue;
    const metadata = meta(doc.metadata);
    if (doc.blocks.length > 0 || doc.children.length > 0) {
      violations.push(`${path}: a stub holds metadata only (no text/sections)`);
    }
    const canonical = metadata.canonical;
    if (typeof canonical !== "string") continue; // schema test reports the type
    const dir = path.slice(0, path.lastIndexOf("/"));
    const resolves = await fileExists(`${dir}/${canonical}.mit`) ||
      await fileExists(`${dir}/${canonical}/index.mit`);
    if (!resolves) {
      violations.push(
        `${path}: canonical "${canonical}" has no edition in ${dir}`,
      );
    }
  }
  fail(violations);
});

Deno.test("block metadata matches the block schema", () => {
  const violations: string[] = [];
  for (const { path, doc } of compiled(workFiles)) {
    for (const { text } of allTexts(doc)) {
      for (const block of text.blocks) {
        if (block.metadata !== undefined) {
          checkKeys(
            meta(block.metadata),
            blockSchema,
            `${path} (${text.id} {#${block.id}})`,
            violations,
          );
        }
      }
    }
  }
  fail(violations);
});

const authorSlugs = new Set(
  authorFiles.map((f) => f.path.slice("authors/".length, -".mit".length)),
);

/** Slugs named by an `authors` value (text or block level), if any. */
const authorsOf = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((s): s is string => typeof s === "string")
    : [];

Deno.test("every authors slug names a known author", () => {
  const violations: string[] = [];
  for (const { path, doc } of compiled(workFiles)) {
    for (const { text } of allTexts(doc)) {
      const where = `${path} (${text.id})`;
      for (const slug of authorsOf(meta(text.metadata).authors)) {
        if (!authorSlugs.has(slug)) {
          violations.push(`${where}: unknown author "${slug}"`);
        }
      }
      for (const block of text.blocks) {
        if (block.metadata === undefined) continue;
        for (const slug of authorsOf(meta(block.metadata).authors)) {
          if (!authorSlugs.has(slug)) {
            violations.push(
              `${where} {#${block.id}}: unknown author "${slug}"`,
            );
          }
        }
      }
    }
  }
  fail(violations);
});

Deno.test("root IDs match file paths", () => {
  fail(
    compiled(files)
      .filter(({ path, doc }) =>
        doc.id.toLowerCase() !== expectedId(path).toLowerCase()
      )
      .map(({ path, doc }) =>
        `${path}: root ID is "${doc.id}", expected "${expectedId(path)}"`
      ),
  );
});

Deno.test("section headings are bare segments", () => {
  const violations: string[] = [];
  for (const { path, doc } of compiled(workFiles)) {
    for (const { text, ancestors } of allTexts(doc)) {
      const parent = ancestors[ancestors.length - 1];
      if (parent === undefined) continue;
      const segment = headingSegment(text.id, parent.id);
      // A borrowed-child placeholder's segment is a bracketed dotted edition ID
      // (`<Hume.EHU.1750>`) — the dots are expected; resolution is checked below.
      if (borrowedChild(segment) !== undefined) continue;
      if (segment.includes(".")) {
        violations.push(
          `${path}: heading "${segment}" should be a bare segment (no dots)`,
        );
      }
    }
  }
  fail(violations);
});

/** Case-insensitive file existence, resolving "." and "..". Paths are corpus
 * paths like "works/astell/llg/1.mit", relative to the data directory. */
const fileExists = async (path: string): Promise<boolean> => {
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  let current = `${corpusRoot}/data`;
  for (const part of parts) {
    let matched: string | undefined;
    try {
      for await (const entry of Deno.readDir(current)) {
        if (entry.name.toLowerCase() === part.toLowerCase()) {
          matched = entry.name;
          break;
        }
      }
    } catch {
      return false;
    }
    if (matched === undefined) return false;
    current = `${current}/${matched}`;
  }
  try {
    return (await Deno.stat(current)).isFile;
  } catch {
    return false;
  }
};

Deno.test("borrowed-child references resolve to an edition", async () => {
  const violations: string[] = [];
  for (const { path, doc } of compiled(workFiles)) {
    for (const { text, ancestors } of allTexts(doc)) {
      const parent = ancestors[ancestors.length - 1];
      const ref = borrowedChild(headingSegment(text.id, parent?.id));
      if (ref === undefined) continue;
      // <Author.Work.Edition> → data/works/<author>/<work>/<edition>{.mit,/index.mit}.
      const [author, work, ...rest] = ref.split(".");
      const base = `works/${author}/${work}/${rest.join(".")}`;
      const resolves = rest.length > 0 &&
        (await fileExists(`${base}.mit`) ||
          await fileExists(`${base}/index.mit`));
      if (!resolves) {
        violations.push(
          `${path} (${text.id}): unresolvable borrowed child "${ref}"`,
        );
      }
    }
  }
  fail(violations);
});

Deno.test("layout: lowercase names, index.mit in every directory", async () => {
  const violations: string[] = [];
  const walkDirs = async (dir: string, depth: number): Promise<void> => {
    const names = new Set<string>();
    for await (const entry of Deno.readDir(`${corpusRoot}/${dir}`)) {
      names.add(entry.name);
      const stem = entry.name.replace(/\.mit$/, "");
      if (!/^[a-z0-9]+$/.test(stem)) {
        violations.push(
          `${dir}/${entry.name}: name should be a lowercase slug`,
        );
      }
      if (entry.isDirectory) await walkDirs(`${dir}/${entry.name}`, depth + 1);
    }
    // works/<author>/ holds works; every deeper directory is a work or a
    // dated edition and must have a reading text / index.
    if (depth >= 2 && !names.has("index.mit")) {
      violations.push(`${dir}: missing index.mit`);
    }
    if (depth === 2 && YEAR.test(dir.split("/").pop() ?? "")) {
      violations.push(`${dir}: year-named directory directly under an author`);
    }
  };
  await walkDirs("data/works", 0);
  for await (const entry of Deno.readDir(`${corpusRoot}/data/authors`)) {
    if (!/^[a-z0-9]+\.mit$/.test(entry.name)) {
      violations.push(
        `data/authors/${entry.name}: name should be a lowercase slug`,
      );
    }
  }
  fail(violations);
});
