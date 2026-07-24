/**
 * The git operations the contribution workflow depends on, declared as a port
 * the core owns. workflow.ts is written entirely over this surface; the
 * isomorphic-git implementation lives in `adapters/git/gitPort.ts` and imports
 * these types. Keeping git behind this narrow surface is what lets the workflow
 * logic be reasoned about and tested without a real repository.
 *
 * Nothing here knows the vocabulary the contributor sees: the port speaks git,
 * workflow.ts speaks submissions, and the panel speaks English.
 */

/** The branch the corpus lives on, here and on GitHub. */
export const MAIN = "main";

/** A file the contributor has touched since the last commit. */
export type FileChange = {
  /** Repository-relative, POSIX-separated. */
  readonly path: string;
  readonly change: "added" | "modified" | "deleted";
};

/** Who to record as the author of a commit. */
export type Identity = { readonly name: string; readonly email: string };

/** Which side to keep for each file two people changed at once. */
export type Resolutions = Readonly<Record<string, "mine" | "corpus">>;

/** The git operations the contribution workflow depends on, as a port. */
export type GitPort = {
  currentBranch: () => Promise<string>;
  branches: () => Promise<string[]>;
  /** Everything different from the last commit, ignored files excluded. */
  changedFiles: () => Promise<FileChange[]>;
  /** A file as it was at the last commit, or undefined if it is new. */
  committedText: (filepath: string) => Promise<string | undefined>;
  /** A file as the Centre currently publishes it (needs a fetch first). */
  corpusText: (filepath: string) => Promise<string | undefined>;
  /** The message of the newest ordinary (non-merge) commit on a branch. */
  lastCommitMessage: (branch: string) => Promise<string | undefined>;
  /** Throw away one file's changes, deleting it if it is newly added. */
  restore: (filepath: string) => Promise<void>;
  /** Start a branch at the current commit and move onto it, leaving the
   * working files exactly as they are. */
  startBranch: (name: string) => Promise<void>;
  commitAll: (message: string, who: Identity) => Promise<void>;
  /** Bring `upstream/main` up to date locally (the only network read). */
  fetchCorpus: () => Promise<void>;
  /**
   * Merge the fetched corpus into the current branch. Called with no choices
   * it is a probe: it either merges or, when the same files changed on both
   * sides, returns their paths having touched nothing. Called again with a
   * choice per path it completes the merge, keeping the chosen side.
   */
  mergeCorpus: (who: Identity, choices?: Resolutions) => Promise<string[]>;
  push: (branch: string) => Promise<void>;
  switchTo: (branch: string) => Promise<void>;
  /** Fast-forward `main` to the fetched corpus and put the files on it. */
  syncMain: () => Promise<void>;
  deleteBranch: (name: string) => Promise<void>;
};
