/**
 * The shared lifecycle behind the two inline-diagnostics overlays
 * (adapters/vscode/commands/dictionaryDiagnostics.ts and .../suggestMarkup.ts)
 * — the vscode-free core of it. Both scan the open editions on demand and
 * squiggle their findings, gated behind a boolean setting and re-run on the
 * same four triggers: the setting flips, the active editor changes, an edit
 * lands (debounced), and the corpus reloads.
 *
 * This engine owns every decision of that machinery — the scanned-map state,
 * the per-document debounce, and the scan/drop/refresh branching — written as
 * an orchestrator over ports that speak the overlay's own vocabulary
 * (`enabled`, `prepare`, `scan`, `render`), never vscode's. A document is
 * opaque (`Doc`): the engine only ever asks a port for its path, so the
 * diagnostic collection, the config gate, the compile-and-scan, and the
 * workspace subscriptions all stay in the adapter, which feeds this the events
 * and executes the effects.
 */

/** How long an edit settles before its document is re-scanned. */
const RESCAN_DEBOUNCE_MS = 300;

/** What an overlay contributes on top of the shared lifecycle, as ports the
 * engine calls. `Doc` is the adapter's document handle (opaque here), `Item` a
 * finding, `Context` the prepared scan input (the dictionary, the hints). */
export type OverlayEngineSpec<Doc, Item, Context> = {
  /** Whether the overlay is switched on (the `compositor.<setting>` boolean). */
  enabled: () => boolean;
  /** Whether this document is one the overlay squiggles (a real `.mit` file). */
  isTarget: (doc: Doc) => boolean;
  /** The document's key — its filesystem path. */
  pathOf: (doc: Doc) => string;
  /** Every currently-open document (the engine filters with `isTarget`). */
  openDocs: () => Doc[];
  /** Prepare the shared scan context (the dictionary, the hints); `undefined`
   * when there is nothing to scan against yet (no corpus loaded). */
  prepare: () => Context | undefined | Promise<Context | undefined>;
  /** Scan one document against the prepared context. */
  scan: (doc: Doc, context: Context) => Item[];
  /** Render a path's findings (set them on the diagnostic collection). */
  render: (path: string, items: Item[]) => void;
  /** Clear one path's rendered findings. */
  clearRender: (path: string) => void;
  /** Clear every rendered finding. */
  clearAllRender: () => void;
};

export type OverlayEngine<Doc, Item> = {
  /** The last scan of a document (for the code-action provider). */
  itemsOf: (doc: Doc) => Item[];
  /** Every scanned document's current findings, keyed by path — for
   * cross-document optimistic edits. */
  scanned: ReadonlyMap<string, Item[]>;
  /** Replace a path's findings and re-render them (optimistic edits). */
  publish: (path: string, items: Item[]) => void;
  /** Re-scan every open edition (or clear everything when off). */
  refresh: () => Promise<void>;
  /** An editor became active, or a debounced edit fired: re-scan it. */
  onDocument: (doc: Doc) => Promise<void>;
  /** An edit landed: schedule a debounced re-scan of the document. */
  onEdit: (doc: Doc) => void;
  /** A document closed: forget its findings. */
  onClose: (doc: Doc) => void;
  /** Cancel any pending debounced re-scans. */
  dispose: () => void;
};

export const createOverlayEngine = <Doc, Item, Context>(
  spec: OverlayEngineSpec<Doc, Item, Context>,
): OverlayEngine<Doc, Item> => {
  /** The last scan of each open document, keyed by path. */
  const scanned = new Map<string, Item[]>();

  /** Record a document's findings and render them to the Problems panel. */
  const publish = (path: string, items: Item[]): void => {
    scanned.set(path, items);
    spec.render(path, items);
  };

  /** Forget a document's findings and clear its squiggles. */
  const drop = (doc: Doc): void => {
    const path = spec.pathOf(doc);
    if (!scanned.has(path)) return;
    scanned.delete(path);
    spec.clearRender(path);
  };

  /** Scan one document and publish its findings — or drop them when the overlay
   * is off, the document is not an edition, or there is nothing to scan yet. */
  const onDocument = async (doc: Doc): Promise<void> => {
    if (!spec.enabled() || !spec.isTarget(doc)) {
      drop(doc);
      return;
    }
    const prepared = await spec.prepare();
    if (prepared === undefined) {
      drop(doc);
      return;
    }
    publish(spec.pathOf(doc), spec.scan(doc, prepared));
  };

  /** Re-scan every open edition (or clear everything when off). */
  const refresh = async (): Promise<void> => {
    if (!spec.enabled()) {
      scanned.clear();
      spec.clearAllRender();
      return;
    }
    const prepared = await spec.prepare();
    if (prepared === undefined) return;
    for (const doc of spec.openDocs()) {
      if (spec.isTarget(doc))
        publish(spec.pathOf(doc), spec.scan(doc, prepared));
    }
  };

  // Re-scan on edits to an open edition, debounced per document.
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const onEdit = (doc: Doc): void => {
    if (!spec.enabled() || !spec.isTarget(doc)) return;
    const key = spec.pathOf(doc);
    clearTimeout(timers.get(key));
    timers.set(
      key,
      setTimeout(() => {
        timers.delete(key);
        void onDocument(doc);
      }, RESCAN_DEBOUNCE_MS),
    );
  };

  return {
    itemsOf: (doc) => scanned.get(spec.pathOf(doc)) ?? [],
    scanned,
    publish,
    refresh,
    onDocument,
    onEdit,
    onClose: drop,
    dispose: () => timers.forEach(clearTimeout),
  };
};
