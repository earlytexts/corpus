/**
 * The pure validation-overlay plan: phase → collection action + status text,
 * with the compile-error suppression and 1-based→0-based range conversion that
 * surface/diagnostics.ts used to bury in its VSCode wiring.
 */

import { expect, test } from "vitest";
import type { Violation } from "@earlytexts/corpus";
import {
  COMPILE_RULE,
  type DiagnosticsPlan,
  type FileDiagnostics,
  type ModelPhase,
  planDiagnostics,
} from "../src/lib/diagnosticsPlan.ts";

const ROOT = "/corpus";
const abs = (path: string) => `${ROOT}/data/${path}`;

const loaded = (violations: Violation[], open: string[] = []): ModelPhase => ({
  phase: "loaded",
  violations,
  openPaths: new Set(open),
  root: ROOT,
});

/** The files of a plan we expect to be a `replace` (fails the test otherwise). */
const filesOf = (plan: DiagnosticsPlan): FileDiagnostics[] => {
  if (plan.collection.action !== "replace") {
    throw new Error(`expected a replace plan, got ${plan.collection.action}`);
  }
  return plan.collection.files;
};

test("loading leaves the collection untouched and spins the status", () => {
  const plan = planDiagnostics({ phase: "loading" });
  expect(plan.collection).toEqual({ action: "leave" });
  expect(plan.status.text).toContain("sync~spin");
});

test("a failed load clears the collection", () => {
  const plan = planDiagnostics({ phase: "failed" });
  expect(plan.collection).toEqual({ action: "clear" });
  expect(plan.status.text).toContain("circle-slash");
});

test("a clean corpus replaces with no files and reports valid", () => {
  const plan = planDiagnostics(loaded([]));
  expect(plan.collection).toEqual({ action: "replace", files: [] });
  expect(plan.status.text).toBe("$(check) Corpus");
  expect(plan.status.tooltip).toBe("Compositor: the corpus is valid");
});

test("a precise violation converts 1-based positions to a 0-based range", () => {
  const plan = planDiagnostics(
    loaded([
      {
        rule: "some rule",
        path: "works/hume/enquiry/1748.mit",
        message: "bad",
        line: 3,
        column: 5,
        endLine: 3,
        endColumn: 9,
        severity: "warning",
      },
    ]),
  );
  expect(plan.collection).toEqual({
    action: "replace",
    files: [
      {
        path: abs("works/hume/enquiry/1748.mit"),
        diagnostics: [
          {
            startLine: 2,
            startColumn: 4,
            endLine: 2,
            endColumn: 8,
            message: "bad",
            severity: "warning",
            rule: "some rule",
          },
        ],
      },
    ],
  });
  expect(plan.status.text).toBe("$(error) Corpus: 1");
});

test("a columnless violation spans the whole line, and locus prefixes the message", () => {
  const plan = planDiagnostics(
    loaded([
      {
        rule: "layout",
        path: "authors/hume.mit",
        locus: "(Hume)",
        message: "missing",
      },
    ]),
  );
  const [file] = filesOf(plan);
  expect(file).toEqual({
    path: abs("authors/hume.mit"),
    diagnostics: [
      {
        startLine: 0,
        startColumn: 0,
        endLine: 0,
        endColumn: 1000,
        message: "(Hume) missing",
        severity: "error",
        rule: "layout",
      },
    ],
  });
});

test("endLine/endColumn fall back to the start when only a column is known", () => {
  const plan = planDiagnostics(
    loaded([{ rule: "r", path: "a.mit", message: "m", line: 4, column: 2 }]),
  );
  const diag = filesOf(plan)[0].diagnostics[0];
  // line 4 col 2, no end → end defaults to line 4 col 3 (0-based: 3 / 2).
  expect(diag).toMatchObject({
    startLine: 3,
    startColumn: 1,
    endLine: 3,
    endColumn: 2,
  });
});

test("violations in the same file are grouped; distinct files stay separate", () => {
  const plan = planDiagnostics(
    loaded([
      { rule: "r", path: "a.mit", message: "1" },
      { rule: "r", path: "b.mit", message: "2" },
      { rule: "r", path: "a.mit", message: "3" },
    ]),
  );
  const files = filesOf(plan);
  expect(files.map((f) => f.path)).toEqual([abs("a.mit"), abs("b.mit")]);
  expect(files[0].diagnostics).toHaveLength(2);
});

test("compile errors in open files are suppressed and flagged in the tooltip", () => {
  const plan = planDiagnostics(
    loaded(
      [
        { rule: COMPILE_RULE, path: "a.mit", message: "syntax", line: 1 },
        { rule: "other", path: "a.mit", message: "rule", line: 1 },
      ],
      [abs("a.mit")],
    ),
  );
  const files = filesOf(plan);
  // The compile error is dropped; the other rule survives.
  expect(files).toHaveLength(1);
  expect(files[0].diagnostics).toHaveLength(1);
  // total counts every violation; the tooltip says some are shown elsewhere.
  expect(plan.status.text).toBe("$(error) Corpus: 2");
  expect(plan.status.tooltip).toContain("some shown by the Markit extension");
});

test("a compile error in a closed file is not suppressed", () => {
  const plan = planDiagnostics(
    loaded([{ rule: COMPILE_RULE, path: "a.mit", message: "syntax", line: 1 }]),
  );
  expect(filesOf(plan)).toHaveLength(1);
  expect(plan.status.tooltip).not.toContain("some shown");
});
