/**
 * The shared lifecycle behind the two inline-diagnostics overlays
 * (commands/dictionaryDiagnostics.ts and commands/suggestMarkup.ts). Both scan
 * the open editions on demand and squiggle their findings, gated behind a
 * boolean setting and re-run on the same four triggers: the setting flips, the
 * active editor changes, an edit lands (debounced), and the corpus reloads.
 *
 * This module owns that machinery — the scanned-map, the per-document debounce,
 * the config gating, and the workspace subscriptions — so each overlay supplies
 * only what is genuinely its own: how to prepare a scan (the loaded dictionary,
 * or the mined hints), how to scan a document, how to render its findings as
 * diagnostics, and its code-action provider.
 */

import * as vscode from "vscode";

/** Only real `.mit` files on disk carry an overlay's findings. */
const isMit = (document: vscode.TextDocument): boolean =>
  document.uri.scheme === "file" && document.uri.fsPath.endsWith(".mit");

const RESCAN_DEBOUNCE_MS = 300;

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
  publish: (uri: vscode.Uri, items: Item[]) => void;
  /** Re-scan every open edition (or clear everything when off). */
  refresh: () => Promise<void>;
  dispose: () => void;
};

export const createOverlay = <Item, Context>(
  context: vscode.ExtensionContext,
  spec: OverlaySpec<Item, Context>,
): Overlay<Item> => {
  const collection = vscode.languages.createDiagnosticCollection(spec.source);
  /** The last scan of each open document, keyed by path. */
  const scanned = new Map<string, Item[]>();

  const enabled = (): boolean =>
    vscode.workspace
      .getConfiguration("compositor")
      .get<boolean>(spec.setting, true);

  /** Record a document's findings and render them to the Problems panel. */
  const publish = (uri: vscode.Uri, items: Item[]): void => {
    scanned.set(uri.fsPath, items);
    collection.set(uri, spec.diagnostics(items));
  };

  /** Forget a document's findings and clear its squiggles. */
  const drop = (document: vscode.TextDocument): void => {
    if (!scanned.has(document.uri.fsPath)) return;
    scanned.delete(document.uri.fsPath);
    collection.delete(document.uri);
  };

  /** Scan one document and publish its findings — or drop them when the overlay
   * is off, the document is not an edition, or there is nothing to scan yet. */
  const scanDocument = async (document: vscode.TextDocument): Promise<void> => {
    if (!enabled() || !isMit(document)) {
      drop(document);
      return;
    }
    const prepared = await spec.prepare();
    if (prepared === undefined) {
      drop(document);
      return;
    }
    publish(document.uri, spec.scan(document, prepared));
  };

  /** Re-scan every open edition (or clear everything when off). */
  const refresh = async (): Promise<void> => {
    if (!enabled()) {
      scanned.clear();
      collection.clear();
      return;
    }
    const prepared = await spec.prepare();
    if (prepared === undefined) return;
    for (const document of vscode.workspace.textDocuments) {
      if (isMit(document)) publish(document.uri, spec.scan(document, prepared));
    }
  };

  // Re-scan on edits to an open edition, debounced per document.
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const onEdit = (document: vscode.TextDocument): void => {
    if (!enabled() || !isMit(document)) return;
    const key = document.uri.fsPath;
    clearTimeout(timers.get(key));
    timers.set(
      key,
      setTimeout(() => {
        timers.delete(key);
        void scanDocument(document);
      }, RESCAN_DEBOUNCE_MS),
    );
  };

  context.subscriptions.push(
    collection,
    spec.provider((document) => scanned.get(document.uri.fsPath) ?? []),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration(`compositor.${spec.setting}`)) void refresh();
    }),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor !== undefined) void scanDocument(editor.document);
    }),
    vscode.workspace.onDidChangeTextDocument((e) => onEdit(e.document)),
    vscode.workspace.onDidCloseTextDocument(drop),
    { dispose: () => timers.forEach(clearTimeout) },
  );
  void refresh();

  return {
    itemsOf: (document) => scanned.get(document.uri.fsPath) ?? [],
    scanned,
    publish,
    refresh,
    dispose: () => collection.dispose(),
  };
};
