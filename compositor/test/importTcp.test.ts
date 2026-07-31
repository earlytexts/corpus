/**
 * The TCP import flow, over a fake `TeiSource` and fake prompts: the guards that
 * refuse a file already holding text, the root-stripping that makes converter
 * output appendable, the counts the confirmation reports, and every way the
 * flow declines. No network — the XML is a handful of inline TEI documents,
 * deliberately tiny, since what is under test is the flow and not the converter.
 */

import { expect, test } from "vitest";
import { compile } from "@jsr/earlytexts__markit";
import {
  type ImportDeps,
  type ImportPrompts,
  importReport,
  planTcpImport,
  stripTcpRoot,
  tcpIdError,
  tcpIdOf,
  tcpXmlUrl,
  type TeiSource,
} from "../src/core/importTcp.ts";

/* -------------------------------- fixtures ------------------------------- */

const TEI = `<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0">
  <teiHeader>
    <fileDesc>
      <titleStmt><title>A small text</title></titleStmt>
      <publicationStmt><idno type="DLPS">A00001</idno></publicationStmt>
    </fileDesc>
  </teiHeader>
  <text>
    <body>
      <div type="chapter" n="1">
        <head>CHAP. I.</head>
        <p><pb n="7"/>First words.</p>
      </div>
    </body>
  </text>
</TEI>`;

/** The same shape without a teiHeader: no root `[metadata]` to strip. */
const HEADERLESS =
  `<TEI xmlns="http://www.tei-c.org/ns/1.0"><text><body><p>Bare.</p>` +
  `</body></text></TEI>`;

/** An `imported = false` edition stub — the shape this command imports into. */
const STUB = `# Test.Work.1699

[metadata]
imported = false
title = "A small text"
breadcrumb = "1699"
authors = ["test"]
published = [1699]
tcp = "A00001"
`;

/* ---------------------------------- deps --------------------------------- */

const source =
  (xml: string): TeiSource =>
  () =>
    Promise.resolve({ ok: true as const, xml });

const failing =
  (reason: "notFound" | "network"): TeiSource =>
  () =>
    Promise.resolve({ ok: false as const, reason, detail: "detail" });

const prompts = (over: Partial<ImportPrompts> = {}): ImportPrompts => ({
  tcpId: () => Promise.resolve("A00001"),
  confirm: () => Promise.resolve("append"),
  ...over,
});

const deps = (over: Partial<ImportDeps> = {}): ImportDeps => ({
  source: source(TEI),
  prompts: prompts(),
  progress: () => {},
  ...over,
});

/* --------------------------------- pieces -------------------------------- */

test("builds the raw GitHub URL for a TCP id", () => {
  expect(tcpXmlUrl("A59472")).toBe(
    "https://raw.githubusercontent.com/textcreationpartnership/A59472/master/A59472.xml",
  );
});

test("accepts the TCP id shapes the corpus schema allows", () => {
  expect(tcpIdError("A59472")).toBeUndefined();
  expect(tcpIdError("K000039.000")).toBeUndefined();
  expect(tcpIdError(" A59472 ")).toBeUndefined(); // trimmed
});

test("rejects anything that is not a TCP id", () => {
  expect(tcpIdError("A5947")).toBeDefined();
  expect(tcpIdError("")).toBeDefined();
});

test("reads the tcp id off a stub's metadata, when there is one", () => {
  expect(tcpIdOf(STUB)).toBe("A00001");
  expect(tcpIdOf("# Test.Work.1699\n")).toBeUndefined();
  // A non-string value is metadata the schema would reject anyway; not a prefill.
  expect(tcpIdOf("# T\n\n[metadata]\ntcp = 1699\n")).toBeUndefined();
});

test("strips the converter's root heading and its metadata sections", () => {
  const stripped = stripTcpRoot(
    '# A00001\n\n[metadata]\ntitle = "t"\n\n[metadata.idno]\n' +
      'DLPS = "A00001"\n\n## text\n\n{#1}\nWords.\n',
  );
  expect(stripped).toBe("## text\n\n{#1}\nWords.\n");
});

test("strips the root heading alone when there is no root metadata", () => {
  expect(stripTcpRoot("# document\n\n## text\n\n{#1}\nBare.\n")).toBe(
    "## text\n\n{#1}\nBare.\n",
  );
});

test("keeps root-level blocks, which follow the metadata", () => {
  const stripped = stripTcpRoot(
    '# A00001\n\n[metadata]\ntitle = "t"\n\n{#1}\nLoose.\n\n## text\n\n{#2}\nIn.\n',
  );
  expect(stripped).toBe("{#1}\nLoose.\n\n## text\n\n{#2}\nIn.\n");
});

test("strips a heading-only document to nothing", () => {
  expect(stripTcpRoot("# document\n")).toBe("");
});

test("counts what an import would bring in", () => {
  const report = importReport(
    '# T\n\n[metadata]\ntitle = "t"\n\n## a\n\n{#1}\n//7// Words ▪ and <<odd>>x<</odd>>.\n',
    "## a\n\n{#1}\n//7// Words ▪ and <<odd>>x<</odd>>.\n",
  );
  expect(report.sections).toBe(1);
  expect(report.blocks).toBe(1);
  expect(report.lines).toBe(4);
  expect(report.diagnostics).toBe(0);
  expect(report.escapes).toBe(1);
  expect(report.pageMarkers).toBe(1);
  expect(report.puncGlyphs).toBe(1);
});

test("counts compile diagnostics in the prospective document", () => {
  // A footnote block before a paragraph block is a Markit ordering error.
  const document = "# T\n\n{#n1}\nNote.\n\n{#1}\nText.\n";
  expect(importReport(document, document).diagnostics).toBeGreaterThan(0);
});

/* ---------------------------------- flow --------------------------------- */

test("plans an append from a stub, prefilling the id from its metadata", async () => {
  let prefilled: string | undefined = "unset";
  const plan = await planTcpImport(
    STUB,
    deps({
      prompts: prompts({
        tcpId: (prefill) => {
          prefilled = prefill;
          return Promise.resolve("A00001");
        },
      }),
    }),
  );
  expect(prefilled).toBe("A00001");
  expect(plan.kind).toBe("append");
  if (plan.kind === "declined") throw new Error("unreachable");
  expect(plan.id).toBe("A00001");
  expect(plan.document.startsWith(STUB.trimEnd())).toBe(true);
  expect(plan.document.endsWith(plan.fragment)).toBe(true);
  // What the fragment says is the converter's business and changes with it;
  // what matters here is that it is appendable — no `#` root heading of its
  // own, so its sections sit under the stub's.
  expect(plan.fragment).not.toMatch(/^# /m);
  // And that appending it leaves one valid document: the stub's own root and
  // metadata, with the converted text as sections and blocks beneath it.
  const { document, errors } = compile(plan.document);
  expect(errors).toEqual([]);
  expect(document.id).toBe("Test.Work.1699");
  expect(document.metadata).toEqual(compile(STUB).document.metadata);
  expect(plan.report.sections).toBeGreaterThan(0);
  expect(plan.report.blocks).toBeGreaterThan(0);
});

test("reports progress while it works", async () => {
  const messages: string[] = [];
  await planTcpImport(STUB, deps({ progress: (m) => messages.push(m) }));
  expect(messages).toEqual(["Fetching A00001…", "Converting…"]);
});

test("plans a preview when that is what was chosen", async () => {
  const plan = await planTcpImport(
    STUB,
    deps({ prompts: prompts({ confirm: () => Promise.resolve("preview") }) }),
  );
  expect(plan.kind).toBe("preview");
});

test("trims the id before fetching it", async () => {
  const asked: string[] = [];
  const plan = await planTcpImport(
    STUB,
    deps({
      source: (id) => {
        asked.push(id);
        return Promise.resolve({ ok: true as const, xml: TEI });
      },
      prompts: prompts({ tcpId: () => Promise.resolve("  A00001  ") }),
    }),
  );
  expect(asked).toEqual(["A00001"]);
  expect(plan.kind).toBe("append");
});

test("imports into a stub with no root metadata at all", async () => {
  const plan = await planTcpImport(
    "# Test.Work.1699\n",
    deps({ source: source(HEADERLESS) }),
  );
  expect(plan.kind).toBe("append");
});

test("declines when the document already holds blocks", async () => {
  const plan = await planTcpImport(`${STUB}\n{#1}\nAlready here.\n`, deps());
  expect(plan).toEqual({
    kind: "declined",
    message: expect.stringContaining("already holds text"),
  });
});

test("declines when the document already holds sections", async () => {
  const plan = await planTcpImport(`${STUB}\n## 1\n\n{#1}\nIn.\n`, deps());
  expect(plan).toEqual({
    kind: "declined",
    message: expect.stringContaining("already holds text"),
  });
});

test("declines quietly when the id prompt is dismissed", async () => {
  const plan = await planTcpImport(
    STUB,
    deps({ prompts: prompts({ tcpId: () => Promise.resolve(undefined) }) }),
  );
  expect(plan).toEqual({ kind: "declined" });
});

test("declines quietly when the confirmation is dismissed", async () => {
  const plan = await planTcpImport(
    STUB,
    deps({ prompts: prompts({ confirm: () => Promise.resolve(undefined) }) }),
  );
  expect(plan).toEqual({ kind: "declined" });
});

test("declines with a naming message when TCP has no such text", async () => {
  const plan = await planTcpImport(STUB, deps({ source: failing("notFound") }));
  expect(plan).toEqual({
    kind: "declined",
    message: expect.stringContaining("A00001"),
  });
});

test("declines with the detail when the fetch fails", async () => {
  const plan = await planTcpImport(STUB, deps({ source: failing("network") }));
  expect(plan).toEqual({
    kind: "declined",
    message: expect.stringContaining("detail"),
  });
});

test("declines when the response converts to nothing", async () => {
  const plan = await planTcpImport(
    STUB,
    deps({ source: source("no markup here at all") }),
  );
  expect(plan).toEqual({
    kind: "declined",
    message: expect.stringContaining("converted to nothing"),
  });
});
