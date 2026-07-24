/**
 * A bounded, on-demand compile cache: hand it a `.mit` file's data-relative
 * path and it returns the compiled `CorpusFile` (source text + positioned
 * document + derivations), compiling from source on a miss and serving a warm
 * copy on a hit. It is the working set behind the features that need positioned
 * documents on demand — search today, and (as the resident whole-corpus map is
 * retired) everything that reads a single file's bodies — so the extension no
 * longer has to hold every compiled document resident to answer them.
 *
 * Eviction is by **byte budget**, not entry count: edition sizes span ~1000×
 * (a title-page author file against a 250k-token folio), so a count cap would
 * either thrash on the big ones or waste memory on the small ones. The cache
 * tracks the summed source length and evicts least-recently-used entries once
 * it exceeds the budget — but never below a small floor, so one enormous
 * edition can never empty the whole cache. Concurrent requests for the same
 * uncached path share one compile (an in-flight map), so a burst of consumers
 * asking for the same file compiles it once.
 *
 * Vscode-free and fs-agnostic — it takes a `read` function (data-relative path
 * → source text, or null when the file is gone), so it is driven by the
 * corpus's `CorpusFs` in production and a plain map in tests.
 */

import { compileWithPositions } from "@jsr/earlytexts__markit";
import { type CorpusFile, deriveFile } from "@earlytexts/corpus";

/** Read a file's source by its `data/`-relative path; null when it is gone. */
export type FileReader = (path: string) => Promise<string | null>;

export type CompiledFileCache = {
  /** The compiled file, from the cache or compiled on a miss; undefined when
   * the source no longer exists. Refreshes the entry's recency on a hit. */
  get: (path: string) => Promise<CorpusFile | undefined>;
  /** The cached entry without compiling or touching recency, or undefined. */
  peek: (path: string) => CorpusFile | undefined;
  /** Drop a path (a save/delete makes its compile stale); the next `get`
   * recompiles. Also cancels any in-flight compile's caching. */
  invalidate: (path: string) => void;
  /** Empty the cache (a full reload). */
  clear: () => void;
  /** The summed source bytes currently held — for tests and diagnostics. */
  readonly bytes: number;
};

/** ~24 MB of source: comfortably larger than any plausible working set of open
 * and searched editions, small enough that the whole corpus never resides. */
const DEFAULT_BUDGET_BYTES = 24 * 1024 * 1024;

/** Never evict below this many entries, however large they are, so one folio
 * edition over budget cannot flush the rest of the working set. */
const DEFAULT_FLOOR = 4;

export const createCompiledFileCache = (
  read: FileReader,
  options: { budgetBytes?: number; floor?: number } = {},
): CompiledFileCache => {
  const budgetBytes = options.budgetBytes ?? DEFAULT_BUDGET_BYTES;
  const floor = options.floor ?? DEFAULT_FLOOR;
  // Insertion order is recency order (least-recent first); a hit re-inserts.
  const entries = new Map<string, CorpusFile>();
  const pending = new Map<string, Promise<CorpusFile | undefined>>();
  let bytes = 0;

  const touch = (path: string, file: CorpusFile): CorpusFile => {
    entries.delete(path);
    entries.set(path, file);
    return file;
  };

  const admit = (path: string, file: CorpusFile): CorpusFile => {
    entries.set(path, file);
    bytes += file.text.length;
    evict();
    return file;
  };

  const evict = (): void => {
    for (const [path, file] of entries) {
      if (bytes <= budgetBytes || entries.size <= floor) break;
      entries.delete(path);
      bytes -= file.text.length;
    }
  };

  const compile = async (path: string): Promise<CorpusFile | undefined> => {
    const text = await read(path);
    if (text === null) return undefined;
    const { document: doc, errors } = compileWithPositions(text);
    return { path, text, doc, errors, derived: deriveFile(text, doc) };
  };

  return {
    get: (path) => {
      const hit = entries.get(path);
      if (hit !== undefined) return Promise.resolve(touch(path, hit));
      const inflight = pending.get(path);
      if (inflight !== undefined) return inflight;
      // Capture this compile's own promise so its continuation can tell whether
      // it is still the current in-flight one: an invalidate() (or a newer
      // compile after it) replaces the pending entry, and a superseded compile
      // must neither admit its stale result nor evict its successor's entry.
      const promise = compile(path).then((file) => {
        if (pending.get(path) === promise) {
          if (file !== undefined) admit(path, file);
          pending.delete(path);
        }
        return file;
      });
      pending.set(path, promise);
      return promise;
    },
    peek: (path) => entries.get(path),
    invalidate: (path) => {
      const file = entries.get(path);
      if (file !== undefined) {
        entries.delete(path);
        bytes -= file.text.length;
      }
      pending.delete(path); // an in-flight compile won't be admitted
    },
    clear: () => {
      entries.clear();
      pending.clear();
      bytes = 0;
    },
    get bytes() {
      return bytes;
    },
  };
};
