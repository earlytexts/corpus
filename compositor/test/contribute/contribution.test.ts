/**
 * The Contribute panel's core over fake ports: labelling changed files the way
 * the corpus browser would, mapping each workflow state to a rendered scene, and
 * the `readScene` orchestrator that gathers the branch, changes and submission
 * (signed out short-circuits before GitHub; signed in feeds `describeState`). No
 * VSCode, no repository, no network.
 */

import { expect, test } from "vitest";
import { buildCatalogue, type Catalogue } from "@earlytexts/corpus";
import { CORPUS_ROOT, corpus, memoryCorpus } from "@earlytexts/corpus/test";
import type { FileChange, GitPort } from "../../src/core/contribute/gitPort.ts";
import type {
  GitHubClient,
  PullSummary,
  Repo,
  Viewer,
} from "../../src/core/contribute/github.ts";
import type { WorkState } from "../../src/core/contribute/workflow.ts";
import {
  labelChanges,
  readScene,
  sceneFrom,
} from "../../src/core/contribute/contribution.ts";

/* ------------------------------- fixtures -------------------------------- */

/** One author, one work, one edition — enough to give a changed file a label. */
const buildCat = async (): Promise<Catalogue> => {
  const files = corpus()
    .author("hume", { forename: "David", surname: "Hume" })
    .work("hume", "enquiry", {
      title: "An Enquiry",
      breadcrumb: "Enquiry",
      canonical: "1748",
    })
    .edition(
      "hume",
      "enquiry",
      "1748",
      {
        imported: false,
        title: "An Enquiry",
        breadcrumb: "Enquiry",
        published: [1748],
      },
      "{#1}\nText.",
    )
    .build();
  const { catalogue } = await buildCatalogue(memoryCorpus(files), CORPUS_ROOT);
  return catalogue;
};

const EDITION_REL = "data/works/hume/enquiry/1748.mit";
const EDITION_LABEL = "Hume · Enquiry · 1748";

const VIEWER: Viewer = { login: "ada", name: "Ada", email: "ada@example.com" };

const openPull: PullSummary = {
  number: 7,
  title: "Corrected long-s errors",
  url: "https://github.com/earlytexts/corpus/pull/7",
  state: "open",
  merged: false,
  createdAt: "2026-07-20T10:00:00Z",
};

const fakeGit = (
  over: {
    branch?: string;
    changes?: FileChange[];
    lastCommitMessage?: string;
  } = {},
): GitPort => ({
  currentBranch: () => Promise.resolve(over.branch ?? "main"),
  branches: () => Promise.resolve(["main"]),
  changedFiles: () => Promise.resolve(over.changes ?? []),
  committedText: () => Promise.resolve(undefined),
  corpusText: () => Promise.resolve(undefined),
  lastCommitMessage: () =>
    Promise.resolve(over.lastCommitMessage ?? "An earlier submission"),
  restore: () => Promise.resolve(),
  startBranch: () => Promise.resolve(),
  commitAll: () => Promise.resolve(),
  fetchCorpus: () => Promise.resolve(),
  mergeCorpus: () => Promise.resolve([]),
  push: () => Promise.resolve(),
  switchTo: () => Promise.resolve(),
  syncMain: () => Promise.resolve(),
  deleteBranch: () => Promise.resolve(),
});

const fakeHub = (over: { pull?: PullSummary } = {}): GitHubClient => ({
  getViewer: () => Promise.resolve(VIEWER),
  getRepo: () => Promise.resolve(undefined as Repo | undefined),
  createFork: () => Promise.resolve(),
  findPull: () => Promise.resolve(over.pull),
  createPull: () => Promise.reject(new Error("unused here")),
  deleteBranch: () => Promise.resolve(),
});

const notNeeded = (what: string) => (): never => {
  throw new Error(`${what} should not be reached`);
};

/* ------------------------------ labelChanges ----------------------------- */

test("labelChanges uses the catalogue label for a known edition, the path otherwise", async () => {
  const cat = await buildCat();
  const changes: FileChange[] = [
    { path: EDITION_REL, change: "modified" },
    { path: "data/authors/hume.mit", change: "added" },
    { path: "README.md", change: "deleted" },
  ];
  expect(labelChanges(changes, cat, CORPUS_ROOT)).toEqual([
    { path: EDITION_REL, label: EDITION_LABEL, change: "modified" },
    {
      path: "data/authors/hume.mit",
      label: "data/authors/hume.mit",
      change: "added",
    },
    { path: "README.md", label: "README.md", change: "deleted" },
  ]);
});

test("labelChanges falls back to raw paths with no catalogue", () => {
  const changes: FileChange[] = [{ path: EDITION_REL, change: "modified" }];
  expect(labelChanges(changes, undefined, CORPUS_ROOT)).toEqual([
    { path: EDITION_REL, label: EDITION_REL, change: "modified" },
  ]);
});

test("labelChanges ignores editions that live outside the given root", async () => {
  const cat = await buildCat();
  const changes: FileChange[] = [{ path: EDITION_REL, change: "modified" }];
  expect(labelChanges(changes, cat, "/somewhere/else")).toEqual([
    { path: EDITION_REL, label: EDITION_REL, change: "modified" },
  ]);
});

/* -------------------------------- sceneFrom ------------------------------- */

test("sceneFrom passes a clean state through untouched", async () => {
  const cat = await buildCat();
  expect(sceneFrom({ kind: "clean" }, cat, CORPUS_ROOT)).toEqual({
    kind: "clean",
  });
});

test("sceneFrom labels the changed files of every non-clean state and drops the raw paths", async () => {
  const cat = await buildCat();
  const editing: WorkState = {
    kind: "editing",
    changes: [{ path: EDITION_REL, change: "modified" }],
  };
  expect(sceneFrom(editing, cat, CORPUS_ROOT)).toEqual({
    kind: "editing",
    files: [{ path: EDITION_REL, label: EDITION_LABEL, change: "modified" }],
  });
});

/* -------------------------------- readScene ------------------------------- */

test("no repository open is the noRepo scene, before any port is built", async () => {
  const { scene, viewer } = await readScene({
    root: undefined,
    catalogue: undefined,
    session: () => Promise.resolve(undefined),
    gitAt: notNeeded("git"),
    githubAt: notNeeded("github"),
  });
  expect(scene).toEqual({ kind: "noRepo" });
  expect(viewer).toBeUndefined();
});

test("signed out lists the changes and never touches GitHub, binding git to an empty token", async () => {
  const cat = await buildCat();
  let boundToken: string | undefined;
  const { scene, viewer } = await readScene({
    root: CORPUS_ROOT,
    catalogue: cat,
    session: () => Promise.resolve(undefined),
    gitAt: (_root, token) => {
      boundToken = token;
      return fakeGit({ changes: [{ path: EDITION_REL, change: "modified" }] });
    },
    githubAt: notNeeded("github"),
  });
  expect(boundToken).toBe("");
  expect(scene).toEqual({
    kind: "signedOut",
    files: [{ path: EDITION_REL, label: EDITION_LABEL, change: "modified" }],
  });
  expect(viewer).toBeUndefined();
});

test("signed in on main with nothing changed is clean, and returns the viewer", async () => {
  const { scene, viewer } = await readScene({
    root: CORPUS_ROOT,
    catalogue: undefined,
    session: () => Promise.resolve({ token: "tok" }),
    gitAt: () => fakeGit({ branch: "main", changes: [] }),
    githubAt: () => fakeHub(),
  });
  expect(scene).toEqual({ kind: "clean" });
  expect(viewer).toEqual(VIEWER);
});

test("signed in on main with changes is editing, binding git to the real token", async () => {
  const cat = await buildCat();
  let boundToken: string | undefined;
  const { scene } = await readScene({
    root: CORPUS_ROOT,
    catalogue: cat,
    session: () => Promise.resolve({ token: "tok-123" }),
    gitAt: (_root, token) => {
      boundToken = token;
      return fakeGit({
        branch: "main",
        changes: [{ path: EDITION_REL, change: "modified" }],
      });
    },
    githubAt: () => fakeHub(),
  });
  expect(boundToken).toBe("tok-123");
  expect(scene).toEqual({
    kind: "editing",
    files: [{ path: EDITION_REL, label: EDITION_LABEL, change: "modified" }],
  });
});

test("a submission branch with an open pull request is a sent submission", async () => {
  const { scene } = await readScene({
    root: CORPUS_ROOT,
    catalogue: undefined,
    session: () => Promise.resolve({ token: "tok" }),
    gitAt: () => fakeGit({ branch: "submission/2026-07-20-x", changes: [] }),
    githubAt: () => fakeHub({ pull: openPull }),
  });
  expect(scene).toMatchObject({
    kind: "sent",
    submission: { number: 7, branch: "submission/2026-07-20-x" },
  });
});

test("a submission branch with a merged pull request is a decided submission", async () => {
  const { scene } = await readScene({
    root: CORPUS_ROOT,
    catalogue: undefined,
    session: () => Promise.resolve({ token: "tok" }),
    gitAt: () => fakeGit({ branch: "submission/2026-07-20-x", changes: [] }),
    githubAt: () =>
      fakeHub({ pull: { ...openPull, state: "closed", merged: true } }),
  });
  expect(scene).toMatchObject({ kind: "decided", accepted: true });
});

test("a submission branch with no pull request is unfinished, titled by its last commit", async () => {
  const { scene } = await readScene({
    root: CORPUS_ROOT,
    catalogue: undefined,
    session: () => Promise.resolve({ token: "tok" }),
    gitAt: () =>
      fakeGit({
        branch: "submission/2026-07-20-x",
        changes: [],
        lastCommitMessage: "Corrected long-s errors",
      }),
    githubAt: () => fakeHub({ pull: undefined }),
  });
  expect(scene).toMatchObject({
    kind: "unfinished",
    title: "Corrected long-s errors",
  });
});
