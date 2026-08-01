/**
 * "Set up the corpus on this computer" — the onboarding flow that replaces
 * handing the user to `git clone`. It signs them in to GitHub, ensures they have
 * a fork, clones that fork into a folder they choose, points `upstream` at the
 * canonical corpus, and offers to open the result. This is the riskiest slice of
 * the contribution feature (auth + fork + programmatic clone), so it is written
 * as an orchestrator over narrow, domain-spoken ports — `git` (clone, add a
 * remote), `makeGitHub` (a REST client from a token), `authenticate` (a GitHub
 * token), and `ui` (choose a folder, show progress, ask to open) — leaving the
 * adapter (adapters/git/setup.ts) to translate each into vscode.
 *
 * `ensureFork` is the pure branch of that flow (fork exists → use it; missing →
 * create and poll; name collision → refuse), written over the small
 * `GitHubClient` port so it can be tested without a network.
 */

import { type GitHubClient, UPSTREAM, UPSTREAM_URL } from "./github.ts";

/** The git operations onboarding needs, as a port. */
export type SetupGit = {
  clone: (opts: {
    dir: string;
    url: string;
    token: string;
    onProgress: (message: string) => void;
  }) => Promise<void>;
  addRemote: (dir: string, name: string, url: string) => Promise<void>;
};

/** The user-facing steps, spoken in the flow's own terms so the port stays a
 * domain surface rather than a thin veneer over quick-picks. */
export type SetupUI = {
  /** Choose the destination folder, or undefined to cancel. */
  chooseDestination: () => Promise<string | undefined>;
  /** Run the clone under a progress indicator, reporting each step's message. */
  withProgress: <T>(
    work: (report: (message: string) => void) => Promise<T>,
  ) => Promise<T>;
  /** Tell the user setup failed, with a ready-made message. */
  reportFailure: (message: string) => Promise<void>;
  /** Ask whether to open the freshly set-up corpus now. */
  askToOpen: () => Promise<boolean>;
  /** Open the corpus folder. */
  open: (dir: string) => Promise<void>;
  /** Sleep, injected so the fork poll runs without real delays in tests. */
  sleep: (ms: number) => Promise<void>;
};

export type SetupDeps = {
  git: SetupGit;
  makeGitHub: (token: string) => GitHubClient;
  /** Obtain a GitHub access token (the same token authenticates REST + clone). */
  authenticate: () => Promise<string>;
  ui: SetupUI;
};

export const runSetup = async (deps: SetupDeps): Promise<void> => {
  const dir = await deps.ui.chooseDestination();
  if (dir === undefined) return;

  const token = await deps.authenticate();
  const gh = deps.makeGitHub(token);

  try {
    await deps.ui.withProgress(async (report) => {
      report("Checking your GitHub account…");
      const { login } = await gh.getViewer();

      report("Finding your copy of the corpus…");
      const cloneUrl = await ensureFork(gh, login, report, deps.ui.sleep);

      report("Downloading the corpus…");
      await deps.git.clone({ dir, url: cloneUrl, token, onProgress: report });
      await deps.git.addRemote(dir, "upstream", UPSTREAM_URL);
    });
  } catch (error) {
    await deps.ui.reportFailure(
      `Setting up the corpus failed: ${messageOf(error)}`,
    );
    return;
  }

  if (await deps.ui.askToOpen()) await deps.ui.open(dir);
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

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
