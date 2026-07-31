/**
 * Importing a TCP text into the open edition: fetch the Text Creation
 * Partnership's TEI transcription by its id, run it through markit's converter,
 * and append the result below the file's existing metadata.
 *
 * This is deliberately a thin harness around `fromTEIXML` **as it stands**. It
 * does no corpus-shaping — the wrapper texts, `type`/`n` keys, `book_1` section
 * ids, `^N` heading levels and inline `//n//` markers all arrive exactly as the
 * converter emits them, so that opening a stub and running this command shows
 * what the converter does today, squiggled by the extension's own diagnostics.
 * The shaping described in FROMTEI_PLAN.md Part B belongs in the corpus package,
 * shared with the bulk importer; nothing here should pre-empt it.
 *
 * The one transform is `stripTcpRoot`: the converter emits its own `# <DLPS>`
 * root and a TCP-shaped `[metadata]` block, neither of which can join a corpus
 * file (a second `#` is not a document, and none of the header's keys are in
 * `textSchema`). Everything below that is appendable as it stands — the
 * converter's top-level children are already `##`, relative to its root, so they
 * sit at exactly the right depth under the target file's own `#`.
 *
 * Written over two ports: a `TeiSource` that fetches the XML (adapters/http),
 * and an `ImportPrompts` that asks for the id and confirms the result
 * (adapters/vscode). The flow returns a plan; the editor layer applies it.
 */

import {
  compile,
  compileWithPositions,
  fromTEIXML,
  type MarkitDocument,
} from "@jsr/earlytexts__markit";
import { textIdentifiers } from "@earlytexts/corpus";

/* --------------------------------- ports -------------------------------- */

/** Where the TEI came from, or why it didn't. Failure is a value rather than a
 * throw so every branch of the flow stays reachable from a test. */
export type TeiFetch =
  | { ok: true; xml: string }
  | { ok: false; reason: "notFound" | "network"; detail: string };

/** Fetching one TCP text's TEI-XML by id. */
export type TeiSource = (id: string) => Promise<TeiFetch>;

/** The two questions the import defers to the editor: which text to bring in
 * (seeded with the id already on the file, when there is one), and what to do
 * with what arrived. Each resolves undefined when dismissed, abandoning the
 * import. */
export type ImportPrompts = {
  tcpId: (prefill: string | undefined) => Promise<string | undefined>;
  confirm: (
    id: string,
    report: ImportReport,
  ) => Promise<"append" | "preview" | undefined>;
};

/** The world the import reaches: the TEI source, the prompts, and a place to
 * say what it is doing while the network is slow. */
export type ImportDeps = {
  source: TeiSource;
  prompts: ImportPrompts;
  progress: (message: string) => void;
};

/** What an import would bring in — the numbers the confirmation reports, and
 * the ones worth watching: raw converter output routinely carries markup the
 * corpus schema will reject, and saying so up front is the point of the
 * command. */
export type ImportReport = {
  /** Sections (`##` and deeper) in the prospective document. */
  sections: number;
  /** Content blocks in the prospective document. */
  blocks: number;
  /** Lines the append would add. */
  lines: number;
  /** Markit compile errors in the prospective document. */
  diagnostics: number;
  /** `<<tag>>` escapes — markup with no native Markit equivalent. */
  escapes: number;
  /** Inline `//n//` page markers, kept as the converter emits them. */
  pageMarkers: number;
  /** `▪` glyphs — EEBO-TCP's sigil for an unidentifiable punctuation mark,
   * which the converter currently resolves into the reading text (FROMTEI_PLAN
   * A6). Each one becomes an unaccounted surface in the dictionary. */
  puncGlyphs: number;
};

/** What the editor should do: append the fragment, show the whole prospective
 * document for inspection, or nothing (with a reason, unless the contributor
 * simply dismissed a prompt). */
export type ImportPlan =
  | {
      kind: "append" | "preview";
      id: string;
      /** The text to append below the file's existing content. */
      fragment: string;
      /** The whole file as it would stand — what a preview shows. */
      document: string;
      report: ImportReport;
    }
  | { kind: "declined"; message?: string };

/* ---------------------------------- flow -------------------------------- */

/** Ask for a TCP id, fetch and convert it, and plan what to do with the result.
 * Refuses outright on a file that already holds text: appending there would
 * silently duplicate a work, and reconciling two transcriptions is a merge
 * problem this does not pretend to solve. */
export const planTcpImport = async (
  documentText: string,
  { source, prompts, progress }: ImportDeps,
): Promise<ImportPlan> => {
  const existing = compile(documentText).document;
  if (existing.blocks.length > 0 || existing.children.length > 0) {
    return {
      kind: "declined",
      message:
        "This edition already holds text. Import into an empty stub, or " +
        "clear the existing text first.",
    };
  }

  const asked = await prompts.tcpId(tcpIdOf(documentText));
  if (asked === undefined) return { kind: "declined" };
  const id = asked.trim();

  progress(`Fetching ${id}…`);
  const fetched = await source(id);
  if (!fetched.ok) {
    return {
      kind: "declined",
      message:
        fetched.reason === "notFound"
          ? `TCP has no text for ${id} — check the id against the TCP catalogue.`
          : `Could not fetch ${id} from GitHub: ${fetched.detail}`,
    };
  }

  progress("Converting…");
  const fragment = stripTcpRoot(fromTEIXML(fetched.xml, { modernize: true }));
  if (fragment === "") {
    return {
      kind: "declined",
      message: `${id} converted to nothing — is the response really TEI?`,
    };
  }

  const document = `${documentText.trimEnd()}\n\n${fragment}`;
  const report = importReport(document, fragment);
  const choice = await prompts.confirm(id, report);
  if (choice === undefined) return { kind: "declined" };
  return { kind: choice, id, fragment, document, report };
};

/* --------------------------------- pieces ------------------------------- */

/** The id already on the file, as the id prompt's starting point. Anything but
 * a string is metadata the schema would reject anyway, so it is no prefill. */
export const tcpIdOf = (documentText: string): string | undefined => {
  const value = compile(documentText).document.metadata?.tcp;
  return typeof value === "string" ? value : undefined;
};

/** Drop the converter's own root — its `# <DLPS>` heading line and the
 * `[metadata]` sections beneath it — leaving text that appends cleanly under
 * the target file's root. Root-level content blocks follow the metadata, so
 * they survive; only the heading and the header go. */
export const stripTcpRoot = (markit: string): string => {
  const { document } = compileWithPositions(markit);
  // Whole-line and end-exclusive, spanning the `[metadata]` block and every
  // `[metadata.<key>]` sub-block. With no metadata there is only the heading.
  const from = document.metadataSource?.source.end.line ?? 1;
  const lines = markit.split("\n").slice(from);
  while (lines.length > 0 && lines[0].trim() === "") lines.shift();
  return lines.join("\n");
};

/** The numbers the confirmation reports: structure and diagnostics measured on
 * the prospective document (what the contributor would actually be left with),
 * size and markup counts on the fragment being added. */
export const importReport = (
  document: string,
  fragment: string,
): ImportReport => {
  const compiled = compile(document);
  return {
    sections: countSections(compiled.document),
    blocks: countBlocks(compiled.document),
    lines: fragment.trimEnd().split("\n").length,
    diagnostics: compiled.errors.length,
    escapes: tally(fragment, /<<(?!\/)/g),
    pageMarkers: tally(fragment, /\/\/\/|\/\/[^\n/]+\/\//g),
    puncGlyphs: tally(fragment, /▪/g),
  };
};

/** A TCP id in one of the shapes the corpus schema allows, for live validation
 * in the id prompt. The pattern is the corpus's own, not a copy of it. */
export const tcpIdError = (input: string): string | undefined =>
  textIdentifiers.tcp.pattern.test(input.trim())
    ? undefined
    : `Must be ${textIdentifiers.tcp.shape}`;

/** Where the TCP publishes a text's TEI-XML. The branch is `master`, and a 404
 * means that id has no repository — not that another branch should be tried. */
export const tcpXmlUrl = (id: string): string =>
  `https://raw.githubusercontent.com/textcreationpartnership/${id}/master/${id}.xml`;

const countSections = (text: MarkitDocument): number =>
  text.children.length +
  text.children.reduce((total, child) => total + countSections(child), 0);

const countBlocks = (text: MarkitDocument): number =>
  text.blocks.length +
  text.children.reduce((total, child) => total + countBlocks(child), 0);

const tally = (text: string, pattern: RegExp): number =>
  (text.match(pattern) ?? []).length;
