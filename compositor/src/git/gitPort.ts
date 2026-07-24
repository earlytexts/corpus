/**
 * The one place isomorphic-git lives. Cloning and remote-config serve the
 * onboarding flow (setup.ts); the rest — what changed, branch, commit, merge,
 * push — serve the contribution flow (workflow.ts) through the `GitPort` type
 * below. Keeping git behind this narrow surface is what lets the workflow logic
 * be reasoned about and tested without a real repository, and means the
 * extension bundles its own git (no system install required of contributors).
 *
 * Nothing here knows the vocabulary the contributor sees: this module speaks
 * git, workflow.ts speaks submissions, and the panel speaks English.
 */

import git from "isomorphic-git";
import http from "isomorphic-git/http/node";
import * as fs from "node:fs";
import * as path from "node:path";
import { UPSTREAM_URL } from "./github.ts";

/** The branch the corpus lives on, here and on GitHub. */
export const MAIN = "main";

/** The remote pointing at the canonical corpus (the fork is `origin`). */
const UPSTREAM_REMOTE = "upstream";

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

export type CloneOptions = {
  /** Destination directory (created by the clone). */
  dir: string;
  /** The HTTPS clone URL of the user's fork. */
  url: string;
  /** OAuth token, sent as the git password for HTTPS. */
  token: string;
  onProgress?: (message: string) => void;
};

/** Full clone of the user's fork, authenticated with the OAuth token. */
export const cloneRepo = async ({
  dir,
  url,
  token,
  onProgress,
}: CloneOptions): Promise<void> => {
  await git.clone({
    fs,
    http,
    dir,
    url,
    // Full history and all branches: contributors switch between and build on
    // existing work, so a shallow/single-branch clone would be a dead end.
    singleBranch: false,
    onAuth: () => ({ username: "x-access-token", password: token }),
    onMessage: onProgress,
  });
};

/** Record an additional remote (used to point `upstream` at the corpus). */
export const addRemote = async (
  dir: string,
  remote: string,
  url: string,
): Promise<void> => {
  await git.addRemote({ fs, dir, remote, url });
};

/** The repository containing `start`, found by walking up to a `.git`, or
 * undefined if the corpus was copied rather than cloned. */
export const findRepoRoot = (start: string): string | undefined => {
  let dir = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(dir, ".git"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
};

/** A `GitPort` backed by isomorphic-git against a real clone. */
export const nodeGitPort = (dir: string, token: string): GitPort => {
  const onAuth = (): { username: string; password: string } => ({
    username: "x-access-token",
    password: token,
  });

  const currentBranch = async (): Promise<string> =>
    (await git.currentBranch({ fs, dir, fullname: false })) ?? MAIN;

  /** A file's content at a ref, or undefined if the ref has no such file. */
  const textAt = async (
    ref: string,
    filepath: string,
  ): Promise<string | undefined> => {
    try {
      const oid = await git.resolveRef({ fs, dir, ref });
      const { blob } = await git.readBlob({ fs, dir, oid, filepath });
      return new TextDecoder().decode(blob);
    } catch {
      return undefined; // not there: newly added here, or not yet published
    }
  };

  const committedText = (filepath: string): Promise<string | undefined> =>
    textAt("HEAD", filepath);

  /** Stage every difference between the last commit and the working files,
   * additions and deletions alike. */
  const stageEverything = async (): Promise<void> => {
    for (const change of await changedFiles()) {
      if (change.change === "deleted") {
        await git.remove({ fs, dir, filepath: change.path });
      } else {
        await git.add({ fs, dir, filepath: change.path });
      }
    }
  };

  const changedFiles = async (): Promise<FileChange[]> => {
    const rows = await git.statusMatrix({ fs, dir });
    const out: FileChange[] = [];
    for (const [filepath, head, workdir] of rows) {
      if (head === 1 && workdir === 1) continue; // untouched
      if (head === 0 && workdir === 0) continue; // staged-then-removed: nothing
      out.push({
        path: filepath,
        change: head === 0 ? "added" : workdir === 0 ? "deleted" : "modified",
      });
    }
    return out.sort((a, b) => a.path.localeCompare(b.path));
  };

  /** Write one side of a conflicted file into the working tree — or remove it,
   * when the chosen side deleted it — and stage the result. */
  const takeSide = async (filepath: string, from: string): Promise<void> => {
    let text: string | undefined;
    try {
      const { blob } = await git.readBlob({ fs, dir, oid: from, filepath });
      text = new TextDecoder().decode(blob);
    } catch {
      text = undefined;
    }
    const full = path.join(dir, filepath);
    if (text === undefined) {
      await fs.promises.rm(full, { force: true });
      await git.remove({ fs, dir, filepath });
      return;
    }
    await fs.promises.mkdir(path.dirname(full), { recursive: true });
    await fs.promises.writeFile(full, text, "utf8");
    // Explicitly staged (not left to stageEverything): a file resolved back to
    // exactly what we already had shows up as no change, yet git still holds it
    // unmerged — and an unmerged path refuses to commit.
    await git.add({ fs, dir, filepath });
  };

  const mergeCorpus = async (
    who: Identity,
    choices?: Resolutions,
  ): Promise<string[]> => {
    const ours = await currentBranch();
    const ourOid = await git.resolveRef({ fs, dir, ref: ours });
    const theirOid = await git.resolveRef({
      fs,
      dir,
      ref: `${UPSTREAM_REMOTE}/${MAIN}`,
    });
    if (ourOid === theirOid) return [];

    if (choices === undefined) {
      try {
        await git.merge({
          fs,
          dir,
          ours,
          theirs: `${UPSTREAM_REMOTE}/${MAIN}`,
          author: who,
          message: MERGE_MESSAGE,
          // A probe: on conflict nothing is written, so backing out costs
          // nothing and the contributor is asked before anything moves.
          abortOnConflict: true,
        });
      } catch (error) {
        const conflicts = conflictPaths(error);
        if (conflicts !== undefined) return conflicts;
        throw error;
      }
      await git.checkout({ fs, dir, ref: ours });
      return [];
    }

    // The second pass writes the merged tree — clean files merged, conflicted
    // ones full of markers — into the working files, then throws. Replacing the
    // conflicted ones with the chosen side leaves the working tree holding
    // exactly the merge the contributor asked for, which is what gets committed
    // (with both parents, so this reads as an ordinary merge to git).
    try {
      await git.merge({
        fs,
        dir,
        ours,
        theirs: `${UPSTREAM_REMOTE}/${MAIN}`,
        author: who,
        message: MERGE_MESSAGE,
        abortOnConflict: false,
      });
    } catch (error) {
      if (conflictPaths(error) === undefined) throw error;
    }
    for (const [filepath, side] of Object.entries(choices)) {
      await takeSide(filepath, side === "corpus" ? theirOid : ourOid);
    }
    await stageEverything();
    await git.commit({
      fs,
      dir,
      message: MERGE_MESSAGE,
      author: who,
      parent: [ourOid, theirOid],
    });
    await git.checkout({ fs, dir, ref: ours, force: true });
    return [];
  };

  return {
    currentBranch,
    committedText,
    changedFiles,
    mergeCorpus,
    corpusText: (filepath) => textAt(`${UPSTREAM_REMOTE}/${MAIN}`, filepath),
    branches: () => git.listBranches({ fs, dir }),
    lastCommitMessage: async (branch) => {
      // Follows first parents rather than reading a log: after a merge the log
      // interleaves both sides in date order, and somebody else's accepted work
      // can easily be the newest thing on it. Every merge made here lists our
      // side first, so the first-parent trail leads back through the
      // contributor's own work, stepping over the merges themselves.
      let oid = await git.resolveRef({ fs, dir, ref: branch });
      for (let step = 0; step < FIRST_PARENT_LIMIT; step++) {
        const { commit } = await git.readCommit({ fs, dir, oid });
        if (commit.parent.length <= 1) return commit.message.trim();
        oid = commit.parent[0];
      }
      return undefined;
    },
    restore: async (filepath) => {
      if ((await committedText(filepath)) === undefined) {
        await fs.promises.rm(path.join(dir, filepath), { force: true });
        return;
      }
      await git.checkout({
        fs,
        dir,
        ref: await currentBranch(),
        filepaths: [filepath],
        force: true,
      });
    },
    startBranch: async (name) => {
      // checkout: true moves HEAD only — the working files, which are the
      // contributor's unsaved work, are left untouched.
      await git.branch({ fs, dir, ref: name, checkout: true });
    },
    commitAll: async (message, who) => {
      await stageEverything();
      await git.commit({ fs, dir, message, author: who });
    },
    fetchCorpus: async () => {
      // Self-healing: a clone made before the upstream remote existed (or one
      // made by hand) still works.
      await git.addRemote({
        fs,
        dir,
        remote: UPSTREAM_REMOTE,
        url: UPSTREAM_URL,
        force: true,
      });
      await git.fetch({
        fs,
        http,
        dir,
        remote: UPSTREAM_REMOTE,
        ref: MAIN,
        singleBranch: true,
        tags: false,
        onAuth,
      });
    },
    push: async (branch) => {
      const result = await git.push({
        fs,
        http,
        dir,
        remote: "origin",
        ref: branch,
        remoteRef: branch,
        onAuth,
      });
      if (result.error) throw new Error(result.error);
    },
    switchTo: async (branch) => {
      await git.checkout({ fs, dir, ref: branch });
    },
    syncMain: async () => {
      await git.merge({
        fs,
        dir,
        ours: MAIN,
        theirs: `${UPSTREAM_REMOTE}/${MAIN}`,
        // Nothing is ever committed to main locally, so anything but a
        // fast-forward means the copy has been edited outside the compositor.
        fastForwardOnly: true,
      });
      await git.checkout({ fs, dir, ref: MAIN });
    },
    deleteBranch: async (name) => {
      await git.deleteBranch({ fs, dir, ref: name });
    },
  };
};

const MERGE_MESSAGE = "Brought in the latest corpus";

/** How far back to look for the contributor's own last message before giving
 * up — a submission is one commit and a merge or two, never fifty. */
const FIRST_PARENT_LIMIT = 50;

/** The conflicting paths if this is a merge conflict, undefined otherwise. */
const conflictPaths = (error: unknown): string[] | undefined => {
  const data = (error as { code?: string; data?: { filepaths?: string[] } })
    ?.data;
  return (error as { code?: string })?.code === "MergeConflictError"
    ? (data?.filepaths ?? [])
    : undefined;
};
