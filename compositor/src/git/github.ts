/**
 * The GitHub REST calls the contribution workflow needs — the operations that
 * are *not* git: reading the signed-in user, and finding or creating the user's
 * fork of the corpus. Everything here talks to api.github.com over `fetch`
 * with the OAuth token from VSCode's built-in GitHub sign-in; no SDK.
 *
 * `ensureFork` is the pure branch of the flow (fork exists → use it; missing →
 * create and poll; name collision → refuse), written over the small
 * `GitHubClient` port so it can be tested without a network.
 */

/** The canonical corpus every contributor forks from. */
export const UPSTREAM = { owner: "earlytexts", repo: "corpus" } as const;

export const UPSTREAM_URL = `https://github.com/${UPSTREAM.owner}/${UPSTREAM.repo}.git`;

/** The slice of a GitHub repository object we care about. */
export type Repo = {
  readonly full_name: string;
  readonly clone_url: string;
  readonly fork: boolean;
  /** Present when the repo is a fork: the ultimate ancestor. */
  readonly source?: { readonly full_name: string };
};

/** The GitHub operations the workflow depends on, as a port. */
export type GitHubClient = {
  /** The signed-in user's login (e.g. "ada-lovelace"). */
  getViewerLogin: () => Promise<string>;
  /** A repository, or undefined if it does not exist (404). */
  getRepo: (owner: string, repo: string) => Promise<Repo | undefined>;
  /** Kick off a fork of owner/repo into the signed-in user's account. */
  createFork: (owner: string, repo: string) => Promise<void>;
};

/**
 * Resolve the user's fork of the corpus to a clone URL, creating it if needed.
 * GitHub creates forks asynchronously, so a fresh fork is polled until it
 * materialises. `sleep` is injected so tests can run without real delays.
 */
export const ensureFork = async (
  gh: GitHubClient,
  login: string,
  report: (message: string) => void,
  sleep: (ms: number) => Promise<void>,
): Promise<string> => {
  const existing = await gh.getRepo(login, UPSTREAM.repo);
  if (existing !== undefined) {
    const ancestor = `${UPSTREAM.owner}/${UPSTREAM.repo}`;
    if (!existing.fork || existing.source?.full_name !== ancestor) {
      throw new Error(
        `You already have a repository called "${UPSTREAM.repo}" that is not ` +
          `a fork of ${ancestor}. Rename or remove it on GitHub, then try again.`,
      );
    }
    return existing.clone_url;
  }

  report("Creating your copy of the corpus on GitHub…");
  await gh.createFork(UPSTREAM.owner, UPSTREAM.repo);
  for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt++) {
    await sleep(POLL_INTERVAL_MS);
    const repo = await gh.getRepo(login, UPSTREAM.repo);
    if (repo !== undefined) return repo.clone_url;
  }
  throw new Error(
    "GitHub is taking longer than expected to create your copy of the corpus. " +
      "Wait a moment and try setting up again.",
  );
};

const POLL_ATTEMPTS = 30;
const POLL_INTERVAL_MS = 2000;

/** A `GitHubClient` backed by api.github.com and an OAuth token. */
export const githubClient = (token: string): GitHubClient => {
  const request = async (method: string, path: string): Promise<Response> => {
    const res = await fetch(`https://api.github.com${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        "GitHub declined the request — your sign-in may have expired or lacks " +
          "the permission to fork. Sign out of GitHub in VSCode and try again.",
      );
    }
    return res;
  };

  return {
    getViewerLogin: async () => {
      const res = await request("GET", "/user");
      if (!res.ok)
        throw new Error(`Could not read your GitHub account (${res.status}).`);
      return ((await res.json()) as { login: string }).login;
    },
    getRepo: async (owner, repo) => {
      const res = await request("GET", `/repos/${owner}/${repo}`);
      if (res.status === 404) return undefined;
      if (!res.ok)
        throw new Error(`Could not read ${owner}/${repo} (${res.status}).`);
      return (await res.json()) as Repo;
    },
    createFork: async (owner, repo) => {
      const res = await request("POST", `/repos/${owner}/${repo}/forks`);
      // 202 Accepted is the expected success (the fork is queued).
      if (!res.ok)
        throw new Error(`Could not fork ${owner}/${repo} (${res.status}).`);
    },
  };
};
