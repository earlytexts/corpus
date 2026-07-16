/**
 * The pure core of the validation overlay: turn the corpus model's current
 * phase and violations into a plan the Problems panel and status bar can apply
 * directly. All the decisions live here — which violations to suppress (compile
 * errors the Markit LSP already shows for open files), how a violation maps to
 * a range, and what the status bar should read — as plain data. surface/
 * diagnostics.ts is then only the adapter that turns this plan into VSCode
 * objects (Range/Diagnostic) and pushes it. Positions are 0-based, end-
 * exclusive — the shape a VSCode Range wants (the corpus's own convention is
 * 1-based, converted here).
 */

import type { Violation } from "@earlytexts/corpus";

/** The rule whose failures the Markit language server already reports live in
 * open documents; the compositor suppresses its own copy for those files. */
export const COMPILE_RULE = "every file compiles without errors";

/** A diagnostic as plain data, ready to become a vscode.Diagnostic. */
export type PlainDiagnostic = {
  /** 0-based, end-exclusive. */
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  message: string;
  severity: "error" | "warning";
  rule: string;
};

export type FileDiagnostics = { path: string; diagnostics: PlainDiagnostic[] };

/** How the diagnostic collection should be updated. `leave` keeps whatever is
 * shown (used mid-reload, when serialised documents carry no ranges yet). */
export type CollectionAction =
  | { action: "leave" }
  | { action: "clear" }
  | { action: "replace"; files: FileDiagnostics[] };

export type DiagnosticsPlan = {
  collection: CollectionAction;
  status: { text: string; tooltip: string };
};

/** The model's phase, as the plan needs to see it. */
export type ModelPhase =
  | { phase: "loading" }
  | { phase: "failed" }
  | {
      phase: "loaded";
      violations: readonly Violation[];
      /** Absolute paths of the .mit files currently open in the editor. */
      openPaths: Set<string>;
      /** The corpus root (the directory containing data/). */
      root: string;
    };

export const planDiagnostics = (phase: ModelPhase): DiagnosticsPlan => {
  if (phase.phase === "loading") {
    return {
      collection: { action: "leave" },
      status: {
        text: "$(sync~spin) Corpus",
        tooltip: "Compositor: reloading the corpus",
      },
    };
  }
  if (phase.phase === "failed") {
    return {
      collection: { action: "clear" },
      status: {
        text: "$(circle-slash) Corpus",
        tooltip: "Compositor: the corpus failed to load",
      },
    };
  }
  const { files, shown } = groupByFile(
    phase.violations,
    phase.openPaths,
    phase.root,
  );
  const total = phase.violations.length;
  return {
    collection: { action: "replace", files },
    status: {
      text: total === 0 ? "$(check) Corpus" : `$(error) Corpus: ${total}`,
      tooltip:
        total === 0
          ? "Compositor: the corpus is valid"
          : `Compositor: ${total} corpus violation(s)` +
            (shown < total ? " (some shown by the Markit extension)" : ""),
    },
  };
};

/** Group violations by their absolute file path, dropping the compile errors
 * the Markit LSP already reports for open files. `shown` is how many survived. */
const groupByFile = (
  violations: readonly Violation[],
  openPaths: Set<string>,
  root: string,
): { files: FileDiagnostics[]; shown: number } => {
  const byFile = new Map<string, PlainDiagnostic[]>();
  let shown = 0;
  for (const violation of violations) {
    const path = `${root}/data/${violation.path}`;
    if (violation.rule === COMPILE_RULE && openPaths.has(path)) continue;
    const list = byFile.get(path) ?? [];
    list.push(toPlainDiagnostic(violation));
    byFile.set(path, list);
    shown++;
  }
  return {
    files: [...byFile].map(([path, diagnostics]) => ({ path, diagnostics })),
    shown,
  };
};

const toPlainDiagnostic = (v: Violation): PlainDiagnostic => {
  const line = (v.line ?? 1) - 1;
  const [startLine, startColumn, endLine, endColumn] =
    v.column !== undefined
      ? [
          line,
          v.column - 1,
          (v.endLine ?? v.line ?? 1) - 1,
          (v.endColumn ?? v.column + 1) - 1,
        ]
      : [line, 0, line, 1000];
  return {
    startLine,
    startColumn,
    endLine,
    endColumn,
    message: v.locus === undefined ? v.message : `${v.locus} ${v.message}`,
    severity: v.severity === "warning" ? "warning" : "error",
    rule: v.rule,
  };
};
