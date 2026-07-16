/**
 * The one place isomorphic-git lives. Clone and remote-config are all the spike
 * needs; the rest of the workflow verbs (branch, checkout, commit, push) will
 * join this port later. Keeping git behind this narrow surface is what lets the
 * workflow logic be reasoned about — and eventually tested — without a real
 * repository, and means the extension bundles its own git (no system install
 * required of contributors).
 */

import git from "isomorphic-git";
import http from "isomorphic-git/http/node";
import * as fs from "node:fs";

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
