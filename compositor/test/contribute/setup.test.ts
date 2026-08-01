/**
 * The onboarding orchestrator `runSetup` over fake ports: destination → auth →
 * viewer → fork → clone → point upstream → offer to open, plus the cancel
 * short-circuit and the failure that is reported rather than thrown (Error and
 * non-Error messages both). `ensureFork`'s own branching is covered in
 * github.test.ts; here it is exercised through the happy path. No network, no
 * real folders, no delays.
 */

import { expect, test } from "vitest";
import {
  runSetup,
  type SetupGit,
  type SetupUI,
} from "../../src/core/contribute/setup.ts";
import {
  type GitHubClient,
  type Repo,
  UPSTREAM_URL,
} from "../../src/core/contribute/github.ts";

const FORK: Repo = {
  full_name: "ada/corpus",
  clone_url: "https://github.com/ada/corpus.git",
  fork: true,
  source: { full_name: "earlytexts/corpus" },
};

const makeGitHub = (repo: Repo | undefined = FORK): GitHubClient => ({
  getViewer: () =>
    Promise.resolve({ login: "ada", name: "Ada", email: "ada@example.com" }),
  getRepo: () => Promise.resolve(repo),
  createFork: () => Promise.resolve(),
  findPull: () => Promise.resolve(undefined),
  createPull: () => Promise.reject(new Error("unused here")),
  deleteBranch: () => Promise.resolve(),
});

const makeGit = (over: { cloneError?: unknown } = {}) => {
  const calls: string[] = [];
  const git: SetupGit = {
    clone: ({ dir, url, onProgress }) => {
      calls.push(`clone:${dir}:${url}`);
      if (over.cloneError !== undefined) return Promise.reject(over.cloneError);
      onProgress("Receiving objects…");
      return Promise.resolve();
    },
    addRemote: (dir, name, url) => {
      calls.push(`addRemote:${dir}:${name}:${url}`);
      return Promise.resolve();
    },
  };
  return { git, calls };
};

const makeUI = (over: { cancel?: boolean; askOpen?: boolean } = {}) => {
  const reports: string[] = [];
  const opened: string[] = [];
  const failures: string[] = [];
  const ui: SetupUI = {
    chooseDestination: () => Promise.resolve(over.cancel ? undefined : "/dest"),
    withProgress: (work) =>
      work((message) => {
        reports.push(message);
      }),
    reportFailure: (message) => {
      failures.push(message);
      return Promise.resolve();
    },
    askToOpen: () => Promise.resolve(over.askOpen ?? true),
    open: (dir) => {
      opened.push(dir);
      return Promise.resolve();
    },
    sleep: () => Promise.resolve(),
  };
  return { ui, reports, opened, failures };
};

const notReached = (what: string) => (): never => {
  throw new Error(`${what} should not be reached`);
};

test("runSetup signs in, ensures a fork, clones, points upstream, and opens", async () => {
  const { git, calls } = makeGit();
  const { ui, opened, reports } = makeUI({ askOpen: true });
  let authenticated = false;

  await runSetup({
    git,
    makeGitHub: () => makeGitHub(),
    authenticate: () => {
      authenticated = true;
      return Promise.resolve("tok");
    },
    ui,
  });

  expect(authenticated).toBe(true);
  expect(calls).toEqual([
    "clone:/dest:https://github.com/ada/corpus.git",
    `addRemote:/dest:upstream:${UPSTREAM_URL}`,
  ]);
  expect(opened).toEqual(["/dest"]);
  expect(reports).toContain("Downloading the corpus…");
});

test("cancelling the destination stops before authenticating or building a client", async () => {
  const { git, calls } = makeGit();
  const { ui, opened } = makeUI({ cancel: true });
  let authenticated = false;

  await runSetup({
    git,
    makeGitHub: notReached("makeGitHub"),
    authenticate: () => {
      authenticated = true;
      return Promise.resolve("tok");
    },
    ui,
  });

  expect(authenticated).toBe(false);
  expect(calls).toEqual([]);
  expect(opened).toEqual([]);
});

test("declining to open leaves the freshly cloned folder unopened", async () => {
  const { git } = makeGit();
  const { ui, opened } = makeUI({ askOpen: false });

  await runSetup({
    git,
    makeGitHub: () => makeGitHub(),
    authenticate: () => Promise.resolve("tok"),
    ui,
  });

  expect(opened).toEqual([]);
});

test("a failure during setup is reported, not thrown (Error message)", async () => {
  const { git } = makeGit({ cloneError: new Error("network down") });
  const { ui, failures, opened } = makeUI();

  await expect(
    runSetup({
      git,
      makeGitHub: () => makeGitHub(),
      authenticate: () => Promise.resolve("tok"),
      ui,
    }),
  ).resolves.toBeUndefined();

  expect(failures).toEqual(["Setting up the corpus failed: network down"]);
  expect(opened).toEqual([]);
});

test("a non-Error failure is stringified in the report", async () => {
  const { git } = makeGit({ cloneError: "boom" });
  const { ui, failures } = makeUI();

  await runSetup({
    git,
    makeGitHub: () => makeGitHub(),
    authenticate: () => Promise.resolve("tok"),
    ui,
  });

  expect(failures).toEqual(["Setting up the corpus failed: boom"]);
});
