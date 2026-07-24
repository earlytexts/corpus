/**
 * The vscode adapter for the shared inline-overlay lifecycle (core/overlayEngine
 * .ts). The engine owns every decision — the scanned-map, the per-document
 * debounce, the scan/drop/refresh branching; this file is translation: it
 * creates the diagnostic collection, reads the gating setting, maps documents to
 * paths, renders findings as diagnostics, and wires the four vscode triggers
 * (setting flipped, active editor changed, edit landed, document closed) into
 * the engine. Each overlay still supplies only what is genuinely its own via the
 * spec — how to prepare a scan, how to scan a document, how to render its
 * findings, and its code-action provider.
 */

import * as vscode from "vscode";
import {
  createOverlayEngine,
  type OverlayEngineSpec,
} from "../../core/overlayEngine.ts";

/** Only real `.mit` files on disk carry an overlay's findings. */
const isMit = (document: vscode.TextDocument): boolean =>
  document.uri.scheme === "file" && document.uri.fsPath.endsWith(".mit");

/** What an overlay contributes on top of the shared lifecycle. */
export type OverlaySpec<Item, Context> = {
  /** The `compositor.<setting>` boolean that gates the overlay (default on). */
  setting: string;
  /** The diagnostic-collection source, distinct per overlay. */
  source: string;
  /** Prepare the shared scan context (the dictionary, the hints); `undefined`
   * when there is nothing to scan against yet (no corpus loaded). */
  prepare: () => Context | undefined | Promise<Context | undefined>;
  /** Scan one document against the prepared context. */
  scan: (document: vscode.TextDocument, context: Context) => Item[];
  /** Render a document's findings as diagnostics. */
  diagnostics: (items: Item[]) => vscode.Diagnostic[];
  /** The overlay's code-action provider, given read access to the last scan. */
  provider: (
    itemsOf: (document: vscode.TextDocument) => Item[],
  ) => vscode.Disposable;
};

export type Overlay<Item> = {
  /** The last scan of a document (for the code-action provider). */
  itemsOf: (document: vscode.TextDocument) => Item[];
  /** Every scanned document's current findings, keyed by path — for
   * cross-document optimistic edits. */
  scanned: ReadonlyMap<string, Item[]>;
  /** Replace a document's findings and re-render them (optimistic edits). */
  publish: (path: string, items: Item[]) => void;
  /** Re-scan every open edition (or clear everything when off). */
  refresh: () => Promise<void>;
  dispose: () => void;
};

export const createOverlay = <Item, Context>(
  context: vscode.ExtensionContext,
  spec: OverlaySpec<Item, Context>,
): Overlay<Item> => {
  const collection = vscode.languages.createDiagnosticCollection(spec.source);

  const engineSpec: OverlayEngineSpec<vscode.TextDocument, Item, Context> = {
    enabled: () =>
      vscode.workspace
        .getConfiguration("compositor")
        .get<boolean>(spec.setting, true),
    isTarget: isMit,
    pathOf: (document) => document.uri.fsPath,
    openDocs: () => [...vscode.workspace.textDocuments],
    prepare: spec.prepare,
    scan: spec.scan,
    render: (path, items) =>
      collection.set(vscode.Uri.file(path), spec.diagnostics(items)),
    clearRender: (path) => collection.delete(vscode.Uri.file(path)),
    clearAllRender: () => collection.clear(),
  };
  const engine = createOverlayEngine(engineSpec);

  context.subscriptions.push(
    collection,
    spec.provider(engine.itemsOf),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration(`compositor.${spec.setting}`)) {
        void engine.refresh();
      }
    }),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor !== undefined) void engine.onDocument(editor.document);
    }),
    vscode.workspace.onDidChangeTextDocument((e) => engine.onEdit(e.document)),
    vscode.workspace.onDidCloseTextDocument((d) => engine.onClose(d)),
    { dispose: engine.dispose },
  );
  void engine.refresh();

  return {
    itemsOf: engine.itemsOf,
    scanned: engine.scanned,
    publish: engine.publish,
    refresh: engine.refresh,
    dispose: () => collection.dispose(),
  };
};
