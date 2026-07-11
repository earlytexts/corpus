/**
 * The filesystem ports the corpus reaches the disk through. Kept apart from the
 * catalogue's *data* types (catalogue/types.ts) so that "the shape of the data"
 * and "how we reach the disk" version independently — and so the catalogue types
 * and the dictionary (which both need a port) don't have to import each other.
 * The disk-backed implementation is fs.ts; the tests bring an in-memory one.
 */

/** A directory entry as the corpus walk sees it (Deno.DirEntry-compatible,
 * but runtime-neutral so Node-based consumers can implement the port too). */
export type DirEntry = {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
};

/**
 * The filesystem capability the catalogue scan needs. The corpus file set is
 * discovered by parsing (children references, case-insensitive lookups), so the
 * I/O cannot be hoisted ahead of the walk — it is injected as this port instead.
 * `readFile` and `stat` return null when the path is absent; `readDir` throws
 * (as Deno.readDir does) so a missing corpus directory surfaces.
 */
export interface CorpusFs {
  readFile(path: string): Promise<string | null>;
  readDir(path: string): Promise<DirEntry[]>;
  realPath(path: string): Promise<string>;
  stat(path: string): Promise<{ isFile: boolean } | null>;
}

/** The additional capabilities `writeCatalogue` needs. `mkdir` is recursive;
 * `remove` is recursive and ignores a missing path. */
export interface CorpusFsWrite extends CorpusFs {
  writeFile(path: string, text: string): Promise<void>;
  mkdir(path: string): Promise<void>;
  remove(path: string): Promise<void>;
}
