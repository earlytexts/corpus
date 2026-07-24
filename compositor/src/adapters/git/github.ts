/**
 * The GitHub REST calls the contribution workflow needs — the `GitHubClient`
 * implementation the core declares: reading the signed-in user, finding or
 * creating their fork of the corpus, and opening and following the pull
 * requests that carry their work back. Everything here talks to api.github.com
 * over `fetch` with the OAuth token from VSCode's built-in GitHub sign-in; no
 * SDK. The pure `ensureFork` flow written over this port lives in core/setup.ts.
 */

import {
  type GitHubClient,
  type PullSummary,
  type Repo,
  UPSTREAM,
} from "../../core/github.ts";

/** A `GitHubClient` backed by api.github.com and an OAuth token. */
export const githubClient = (token: string): GitHubClient => {
  const request = async (
    method: string,
    path: string,
    body?: unknown,
  ): Promise<Response> => {
    const res = await fetch(`https://api.github.com${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        "GitHub declined the request — your sign-in may have expired or lacks " +
          "the permission to fork. Sign out of GitHub in VSCode and try again.",
      );
    }
    return res;
  };

  const pulls = `/repos/${UPSTREAM.owner}/${UPSTREAM.repo}/pulls`;

  return {
    getViewer: async () => {
      const res = await request("GET", "/user");
      if (!res.ok)
        throw new Error(`Could not read your GitHub account (${res.status}).`);
      const user = (await res.json()) as {
        login: string;
        id: number;
        name: string | null;
        email: string | null;
      };
      return {
        login: user.login,
        name: user.name ?? user.login,
        // GitHub's own no-reply address stands in when the account keeps its
        // email private, so a commit is still attributed to the contributor.
        email:
          user.email ?? `${user.id}+${user.login}@users.noreply.github.com`,
      };
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
    findPull: async (head) => {
      const query = `?state=all&sort=created&direction=desc&head=${encodeURIComponent(head)}`;
      const res = await request("GET", `${pulls}${query}`);
      if (!res.ok)
        throw new Error(`Could not check your submission (${res.status}).`);
      const found = (await res.json()) as PullPayload[];
      return found.length === 0 ? undefined : summarise(found[0]);
    },
    createPull: async ({ head, title, body }) => {
      const res = await request("POST", pulls, {
        head,
        title,
        body,
        base: UPSTREAM_BASE,
        maintainer_can_modify: true,
      });
      if (!res.ok) {
        const detail = (
          (await res.json().catch(() => ({}))) as
            { message?: string } | undefined
        )?.message;
        throw new Error(
          `Could not send your work for review (${res.status}${
            detail === undefined ? "" : `: ${detail}`
          }).`,
        );
      }
      return summarise((await res.json()) as PullPayload);
    },
    deleteBranch: async (owner, branch) => {
      const res = await request(
        "DELETE",
        `/repos/${owner}/${UPSTREAM.repo}/git/refs/heads/${branch}`,
      );
      if (!res.ok && res.status !== 404 && res.status !== 422)
        throw new Error(`Could not tidy up the branch (${res.status}).`);
    },
  };
};

/** The branch submissions are opened against. */
const UPSTREAM_BASE = "main";

/** The fields of GitHub's pull request payload the summary is built from. */
type PullPayload = {
  number: number;
  title: string;
  html_url: string;
  state: "open" | "closed";
  created_at: string;
  merged_at: string | null;
  merged?: boolean;
};

const summarise = (pull: PullPayload): PullSummary => ({
  number: pull.number,
  title: pull.title,
  url: pull.html_url,
  state: pull.state,
  // The list endpoint reports the merge as a date, the single-pull endpoint as
  // a flag; either one settles it.
  merged: pull.merged === true || pull.merged_at !== null,
  createdAt: pull.created_at,
});
