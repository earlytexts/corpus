/**
 * The GitHub operations the contribution workflow needs — the operations that
 * are *not* git: reading the signed-in user, finding or creating their fork of
 * the corpus, and opening and following the pull requests that carry their work
 * back. Declared here as a port the core owns; the REST implementation (and the
 * pure `ensureFork` flow written over it) lives in `adapters/git/github.ts`.
 */

/** The slice of a GitHub repository object we care about. */
export type Repo = {
  readonly full_name: string;
  readonly clone_url: string;
  readonly fork: boolean;
  /** Present when the repo is a fork: the ultimate ancestor. */
  readonly source?: { readonly full_name: string };
};

/** The signed-in user, as git and GitHub each need them. */
export type Viewer = {
  readonly login: string;
  readonly name: string;
  readonly email: string;
};

/** The slice of a pull request the panel reports on. */
export type PullSummary = {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly state: "open" | "closed";
  readonly merged: boolean;
  readonly createdAt: string;
};

/** The GitHub operations the workflow depends on, as a port. */
export type GitHubClient = {
  /** The signed-in user's login, display name and commit email. */
  getViewer: () => Promise<Viewer>;
  /** A repository, or undefined if it does not exist (404). */
  getRepo: (owner: string, repo: string) => Promise<Repo | undefined>;
  /** Kick off a fork of owner/repo into the signed-in user's account. */
  createFork: (owner: string, repo: string) => Promise<void>;
  /** The newest pull request from `head` ("login:branch"), open or closed. */
  findPull: (head: string) => Promise<PullSummary | undefined>;
  createPull: (args: {
    head: string;
    title: string;
    body: string;
  }) => Promise<PullSummary>;
  /** Remove a branch from the user's fork (tidying up after a decision). */
  deleteBranch: (owner: string, branch: string) => Promise<void>;
};
