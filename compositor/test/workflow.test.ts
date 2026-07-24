/**
 * The contribution workflow over fake ports: the state machine that decides
 * what the contributor is shown, the branch names submissions are filed under,
 * and the verbs (send, add to, get the latest, tidy up) — each asserted by the
 * sequence of git and GitHub calls it makes. No repository, no network.
 */

import { expect, test, vi } from "vitest";
import type {
  FileChange,
  GitPort,
  Identity,
  Resolutions,
} from "../src/git/gitPort.ts";
import type { GitHubClient, PullSummary, Repo } from "../src/git/github.ts";
import {
  addToSubmission,
  branchNameFor,
  describeState,
  getLatest,
  sendForReview,
  tidyUp,
} from "../src/git/workflow.ts";

const ME: Identity = { name: "Ada", email: "ada@example.com" };

const CHANGE: FileChange = {
  path: "data/authors/hume.mit",
  change: "modified",
};

const openPull: PullSummary = {
  number: 7,
  title: "Corrected long-s errors",
  url: "https://github.com/earlytexts/corpus/pull/7",
  state: "open",
  merged: false,
  createdAt: "2026-07-20T10:00:00Z",
};

/** A GitPort that records every call and answers from the given fixtures. */
const fakeGit = (
  fixtures: {
    branch?: string;
    changes?: FileChange[];
    branches?: string[];
    conflicts?: string[][];
  } = {},
): GitPort & { calls: string[] } => {
  const conflicts = [...(fixtures.conflicts ?? [])];
  const calls: string[] = [];
  const record =
    <T>(name: string, result: T) =>
    (...args: unknown[]): Promise<T> => {
      calls.push(`${name}(${args.map((a) => JSON.stringify(a)).join(",")})`);
      return Promise.resolve(result);
    };
  return {
    calls,
    currentBranch: record("currentBranch", fixtures.branch ?? "main"),
    branches: record("branches", fixtures.branches ?? ["main"]),
    changedFiles: record("changedFiles", fixtures.changes ?? []),
    committedText: record("committedText", ""),
    corpusText: record("corpusText", ""),
    lastCommitMessage: record("lastCommitMessage", "An earlier submission"),
    restore: record("restore", undefined),
    startBranch: record("startBranch", undefined),
    commitAll: record("commitAll", undefined),
    fetchCorpus: record("fetchCorpus", undefined),
    mergeCorpus: (who: Identity, choices?: Resolutions) => {
      calls.push(`mergeCorpus(${JSON.stringify(choices ?? null)})`);
      return Promise.resolve(conflicts.shift() ?? []);
    },
    push: record("push", undefined),
    switchTo: record("switchTo", undefined),
    syncMain: record("syncMain", undefined),
    deleteBranch: record("deleteBranch", undefined),
  };
};

const fakeHub = (
  fixtures: { pull?: PullSummary } = {},
): GitHubClient & { created: unknown[]; deleted: string[] } => {
  const created: unknown[] = [];
  const deleted: string[] = [];
  return {
    created,
    deleted,
    getViewer: () =>
      Promise.resolve({ login: "ada", name: "Ada", email: ME.email }),
    getRepo: () => Promise.resolve(undefined as Repo | undefined),
    createFork: () => Promise.resolve(),
    findPull: () => Promise.resolve(fixtures.pull),
    createPull: (args) => {
      created.push(args);
      return Promise.resolve({ ...openPull, title: args.title });
    },
    deleteBranch: (owner, branch) => {
      deleted.push(`${owner}/${branch}`);
      return Promise.resolve();
    },
  };
};

/* ---------------------------- the state machine --------------------------- */

test("signed out, the panel offers to sign in but still lists the changes", () => {
  const state = describeState({
    branch: "main",
    changes: [CHANGE],
    signedIn: false,
  });
  expect(state).toEqual({ kind: "signedOut", changes: [CHANGE] });
});

test("on main with nothing changed, there is nothing to send", () => {
  expect(
    describeState({ branch: "main", changes: [], signedIn: true }),
  ).toEqual({ kind: "clean" });
});

test("on main with changes, the work is unsent", () => {
  expect(
    describeState({ branch: "main", changes: [CHANGE], signedIn: true }),
  ).toEqual({ kind: "editing", changes: [CHANGE] });
});

test("an open pull request is a submission under review", () => {
  const state = describeState({
    branch: "submission/2026-07-20-corrected-long-s",
    changes: [CHANGE],
    signedIn: true,
    pull: openPull,
  });
  expect(state).toEqual({
    kind: "sent",
    submission: {
      branch: "submission/2026-07-20-corrected-long-s",
      number: 7,
      title: "Corrected long-s errors",
      url: openPull.url,
      createdAt: openPull.createdAt,
    },
    // Edits made since sending are the "new changes" the panel offers to add.
    changes: [CHANGE],
  });
});

test("a merged pull request is an accepted submission", () => {
  const state = describeState({
    branch: "submission/2026-07-20-x",
    changes: [],
    signedIn: true,
    pull: { ...openPull, state: "closed", merged: true },
  });
  expect(state.kind).toBe("decided");
  expect(state).toMatchObject({ accepted: true });
});

test("a closed but unmerged pull request is a declined submission", () => {
  const state = describeState({
    branch: "submission/2026-07-20-x",
    changes: [],
    signedIn: true,
    pull: { ...openPull, state: "closed", merged: false },
  });
  expect(state.kind).toBe("decided");
  expect(state).toMatchObject({ accepted: false });
});

test("a submission branch with no pull request never finished sending", () => {
  const state = describeState({
    branch: "submission/2026-07-20-x",
    changes: [CHANGE],
    signedIn: true,
    title: "Corrected long-s errors",
  });
  expect(state).toEqual({
    kind: "unfinished",
    branch: "submission/2026-07-20-x",
    title: "Corrected long-s errors",
    changes: [CHANGE],
  });
});

/* ------------------------------ branch names ------------------------------ */

const JULY = new Date("2026-07-23T09:00:00Z");

test("a branch name dates and slugifies the description", () => {
  expect(branchNameFor("Corrected long-s errors", JULY, [])).toBe(
    "submission/2026-07-23-corrected-long-s-errors",
  );
  // Numbers are words like any other; the full description stays on the
  // submission itself, so a name cut short here loses nothing.
  expect(branchNameFor("Fixed THN 1.3.14", JULY, [])).toBe(
    "submission/2026-07-23-fixed-thn-1-3-14",
  );
});

test("a branch name survives punctuation, accents and empty descriptions", () => {
  expect(branchNameFor("  “Hume’s” Essays!  ", JULY, [])).toBe(
    "submission/2026-07-23-hume-s-essays",
  );
  expect(branchNameFor("Éditions de Genève", JULY, [])).toBe(
    "submission/2026-07-23-editions-de-geneve",
  );
  expect(branchNameFor("", JULY, [])).toBe("submission/2026-07-23-changes");
  expect(branchNameFor("...", JULY, [])).toBe("submission/2026-07-23-changes");
});

test("a long description is cut at a word boundary", () => {
  const name = branchNameFor(
    "Corrected the long-s errors throughout the whole of the first volume",
    JULY,
    [],
  );
  expect(name.length).toBeLessThanOrEqual("submission/2026-07-23-".length + 30);
  expect(name.endsWith("-")).toBe(false);
  expect(name).toBe("submission/2026-07-23-corrected-the-long-s-errors");
});

test("a name already taken gains a number rather than colliding", () => {
  const taken = [
    "submission/2026-07-23-fixes",
    "submission/2026-07-23-fixes-2",
  ];
  expect(branchNameFor("Fixes", JULY, taken)).toBe(
    "submission/2026-07-23-fixes-3",
  );
});

/* -------------------------------- sending -------------------------------- */

const sendArgs = (git: GitPort, gh: GitHubClient) => ({
  git,
  gh,
  login: "ada",
  who: ME,
  description: "Corrected long-s errors",
  notes: "Checked against the 1739 printing.",
  now: JULY,
  onProgress: () => {},
  resolveConflicts: () => Promise.resolve(undefined),
});

test("sending from main branches, commits, merges the corpus, pushes and opens a pull request", async () => {
  const git = fakeGit({ changes: [CHANGE] });
  const gh = fakeHub();
  const submission = await sendForReview(sendArgs(git, gh));

  expect(git.calls).toEqual([
    "changedFiles()",
    "branches()",
    'startBranch("submission/2026-07-23-corrected-long-s-errors")',
    'commitAll("Corrected long-s errors",{"name":"Ada","email":"ada@example.com"})',
    // The corpus is fetched only once there is something worth sending.
    "fetchCorpus()",
    "mergeCorpus(null)",
    'push("submission/2026-07-23-corrected-long-s-errors")',
  ]);
  expect(gh.created).toEqual([
    {
      head: "ada:submission/2026-07-23-corrected-long-s-errors",
      title: "Corrected long-s errors",
      body: "Checked against the 1739 printing.",
    },
  ]);
  expect(submission).toMatchObject({
    number: 7,
    branch: "submission/2026-07-23-corrected-long-s-errors",
  });
});

test("finishing an interrupted send reuses the branch it already made", async () => {
  const git = fakeGit({ branch: "submission/2026-07-20-x", changes: [] });
  const gh = fakeHub();
  await sendForReview({
    ...sendArgs(git, gh),
    branch: "submission/2026-07-20-x",
  });

  expect(git.calls).not.toContain(
    'startBranch("submission/2026-07-23-corrected-long-s-errors")',
  );
  expect(git.calls).toContain('push("submission/2026-07-20-x")');
  // Nothing changed on disk, so there is nothing to commit — but the push and
  // the pull request still have to happen.
  expect(git.calls.some((call) => call.startsWith("commitAll"))).toBe(false);
  expect(gh.created).toHaveLength(1);
});

test("a conflicting merge is retried with the contributor's choices", async () => {
  const git = fakeGit({
    changes: [CHANGE],
    conflicts: [["data/authors/hume.mit"], []],
  });
  const gh = fakeHub();
  const resolveConflicts = vi.fn(() =>
    Promise.resolve({ "data/authors/hume.mit": "mine" as const }),
  );
  await sendForReview({ ...sendArgs(git, gh), resolveConflicts });

  expect(resolveConflicts).toHaveBeenCalledWith(["data/authors/hume.mit"]);
  expect(git.calls).toContain('mergeCorpus({"data/authors/hume.mit":"mine"})');
  expect(git.calls).toContain(
    'push("submission/2026-07-23-corrected-long-s-errors")',
  );
});

test("backing out of a conflict sends nothing", async () => {
  const git = fakeGit({
    changes: [CHANGE],
    conflicts: [["data/authors/hume.mit"]],
  });
  const gh = fakeHub();
  const submission = await sendForReview(sendArgs(git, gh));

  expect(submission).toBeUndefined();
  expect(git.calls.some((call) => call.startsWith("push"))).toBe(false);
  expect(gh.created).toHaveLength(0);
});

test("adding to a submission commits and pushes without opening a second one", async () => {
  const git = fakeGit({
    branch: "submission/2026-07-20-x",
    changes: [CHANGE],
  });
  const gh = fakeHub({ pull: openPull });
  await addToSubmission({
    git,
    who: ME,
    branch: "submission/2026-07-20-x",
    description: "Also fixed the running heads",
    onProgress: () => {},
    resolveConflicts: () => Promise.resolve(undefined),
  });

  expect(git.calls).toEqual([
    "changedFiles()",
    'commitAll("Also fixed the running heads",{"name":"Ada","email":"ada@example.com"})',
    "fetchCorpus()",
    "mergeCorpus(null)",
    'push("submission/2026-07-20-x")',
  ]);
  expect(gh.created).toHaveLength(0);
});

/* --------------------------- getting the latest --------------------------- */

test("getting the latest corpus fetches and fast-forwards", async () => {
  const git = fakeGit();
  await getLatest(git, () => {});
  expect(git.calls).toEqual(["fetchCorpus()", "syncMain()"]);
});

/* -------------------------------- tidying -------------------------------- */

test("tidying up after a decision returns to a fresh main and removes the branch", async () => {
  const git = fakeGit({ branch: "submission/2026-07-20-x" });
  const gh = fakeHub();
  await tidyUp({
    git,
    gh,
    login: "ada",
    branch: "submission/2026-07-20-x",
    onProgress: () => {},
  });

  expect(git.calls).toEqual([
    'switchTo("main")',
    "fetchCorpus()",
    "syncMain()",
    'deleteBranch("submission/2026-07-20-x")',
  ]);
  expect(gh.deleted).toEqual(["ada/submission/2026-07-20-x"]);
});

test("tidying up survives GitHub having already removed the branch", async () => {
  const git = fakeGit({ branch: "submission/2026-07-20-x" });
  const gh = {
    ...fakeHub(),
    deleteBranch: () => Promise.reject(new Error("422")),
  };
  await expect(
    tidyUp({
      git,
      gh,
      login: "ada",
      branch: "submission/2026-07-20-x",
      onProgress: () => {},
    }),
  ).resolves.toBeUndefined();
  expect(git.calls).toContain('deleteBranch("submission/2026-07-20-x")');
});
