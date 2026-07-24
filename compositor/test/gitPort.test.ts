/**
 * The git port against a real repository in a temporary directory: the half of
 * the contribution flow that fakes cannot vouch for. Everything here is local —
 * the corpus the contributor merges from is a remote-tracking ref moved by
 * hand, exactly as a fetch would move it — so no network is involved, and the
 * two operations that do need one (fetch and push) are the only ones left out.
 *
 * What these tests are really checking is that working files survive: that
 * starting a submission does not disturb them, that a merge leaves them holding
 * the merged text, that a conflict probe changes nothing at all, and that the
 * side the contributor chooses is the side that ends up on disk and in history.
 */

import { afterEach, beforeEach, expect, test } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import git from "isomorphic-git";
import {
  type GitPort,
  type Identity,
  nodeGitPort,
} from "../src/git/gitPort.ts";

const ME: Identity = { name: "Ada", email: "ada@example.com" };
const CORPUS_REF = "refs/remotes/upstream/main";

let dir = "";
let port: GitPort;

/* -------------------------------- fixtures -------------------------------- */

const write = (file: string, text: string): void => {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  fs.writeFileSync(path.join(dir, file), text, "utf8");
};

const read = (file: string): string =>
  fs.readFileSync(path.join(dir, file), "utf8");

const commit = async (message: string): Promise<string> => {
  await port.commitAll(message, ME);
  return git.resolveRef({ fs, dir, ref: "HEAD" });
};

/**
 * Publish a change to "the corpus": commit it on top of the corpus as it
 * currently stands — never on top of the contributor's work, or the two would
 * share a history and could not conflict — point the remote-tracking ref at it,
 * and put the working files back. This is what the contributor's clone looks
 * like the moment after a fetch that brought in somebody else's accepted
 * submission. Assumes their own work is already committed.
 */
const publishToCorpus = async (
  edit: (write: (file: string, text: string) => void) => void,
  message: string,
): Promise<void> => {
  const here = await port.currentBranch();
  const tip = await git.resolveRef({ fs, dir, ref: CORPUS_REF });
  await git.writeRef({
    fs,
    dir,
    ref: "refs/heads/corpus-side",
    value: tip,
    force: true,
  });
  await git.checkout({ fs, dir, ref: "corpus-side", force: true });
  edit(write);
  const oid = await commit(message);
  await git.writeRef({ fs, dir, ref: CORPUS_REF, value: oid, force: true });
  await git.checkout({ fs, dir, ref: here, force: true });
  await git.deleteBranch({ fs, dir, ref: "corpus-side" });
};

/** The commonest case: publish some whole files. */
const publishFiles = (
  files: Record<string, string>,
  message: string,
): Promise<void> =>
  publishToCorpus((write) => {
    for (const [file, text] of Object.entries(files)) write(file, text);
  }, message);

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "compositor-git-"));
  port = nodeGitPort(dir, "unused-token");
  await git.init({ fs, dir, defaultBranch: "main" });
  write("data/x.mit", "A\nB\nC\n");
  write("data/y.mit", "first\n");
  const oid = await commit("The corpus as it stands");
  await git.writeRef({ fs, dir, ref: CORPUS_REF, value: oid, force: true });
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

/* ------------------------------ reading it ------------------------------- */

test("changed files distinguish added, modified and deleted", async () => {
  write("data/x.mit", "A\nEDITED\nC\n");
  write("data/new.mit", "new\n");
  fs.rmSync(path.join(dir, "data/y.mit"));

  expect(await port.changedFiles()).toEqual([
    { path: "data/new.mit", change: "added" },
    { path: "data/x.mit", change: "modified" },
    { path: "data/y.mit", change: "deleted" },
  ]);
});

test("ignored files are not offered as changes", async () => {
  write(".gitignore", "catalogue\n");
  await commit("Ignore the built catalogue");
  write("catalogue/index.json", "{}\n");

  expect(await port.changedFiles()).toEqual([]);
});

test("the committed and corpus versions of a file can both be read", async () => {
  write("data/x.mit", "A\nEDITED\nC\n");
  expect(await port.committedText("data/x.mit")).toBe("A\nB\nC\n");
  expect(await port.corpusText("data/x.mit")).toBe("A\nB\nC\n");
  expect(await port.committedText("data/nowhere.mit")).toBeUndefined();
});

test("the last commit message skips the merges the compositor made", async () => {
  await port.startBranch("submission/2026-07-23-my-work");
  write("data/x.mit", "A\nMINE\nC\n");
  await commit("Corrected the second line");
  await publishFiles({ "data/y.mit": "second\n" }, "Somebody else's work");
  await port.mergeCorpus(ME);

  expect(await port.lastCommitMessage("submission/2026-07-23-my-work")).toBe(
    "Corrected the second line",
  );
});

/* ------------------------------- undoing --------------------------------- */

test("undoing a change puts the file back, and removes one newly added", async () => {
  write("data/x.mit", "A\nEDITED\nC\n");
  write("data/new.mit", "new\n");

  await port.restore("data/x.mit");
  await port.restore("data/new.mit");

  expect(read("data/x.mit")).toBe("A\nB\nC\n");
  expect(fs.existsSync(path.join(dir, "data/new.mit"))).toBe(false);
  expect(await port.changedFiles()).toEqual([]);
});

/* ------------------------------- sending --------------------------------- */

test("starting a submission leaves the contributor's work exactly where it was", async () => {
  write("data/x.mit", "A\nMINE\nC\n");
  await port.startBranch("submission/2026-07-23-my-work");

  expect(await port.currentBranch()).toBe("submission/2026-07-23-my-work");
  expect(read("data/x.mit")).toBe("A\nMINE\nC\n");
  expect(await port.changedFiles()).toEqual([
    { path: "data/x.mit", change: "modified" },
  ]);
});

test("committing takes everything, additions and deletions alike", async () => {
  write("data/x.mit", "A\nMINE\nC\n");
  write("data/new.mit", "new\n");
  fs.rmSync(path.join(dir, "data/y.mit"));
  await port.commitAll("A round of corrections", ME);

  expect(await port.changedFiles()).toEqual([]);
  expect(await port.committedText("data/new.mit")).toBe("new\n");
  expect(await port.committedText("data/y.mit")).toBeUndefined();
});

/* ------------------------------- merging --------------------------------- */

test("a clean merge brings the corpus into the working files", async () => {
  await port.startBranch("submission/2026-07-23-my-work");
  write("data/x.mit", "A\nMINE\nC\n");
  await commit("Corrected the second line");
  await publishFiles(
    { "data/y.mit": "second\n", "data/z.mit": "brand new\n" },
    "Somebody else's accepted work",
  );

  expect(await port.mergeCorpus(ME)).toEqual([]);

  // Their work is on disk, ours is untouched, and nothing is left uncommitted.
  expect(read("data/y.mit")).toBe("second\n");
  expect(read("data/z.mit")).toBe("brand new\n");
  expect(read("data/x.mit")).toBe("A\nMINE\nC\n");
  expect(await port.changedFiles()).toEqual([]);
});

test("a merge with nothing to bring in is a no-op", async () => {
  await port.startBranch("submission/2026-07-23-my-work");
  write("data/x.mit", "A\nMINE\nC\n");
  await commit("Corrected the second line");

  expect(await port.mergeCorpus(ME)).toEqual([]);
  expect(read("data/x.mit")).toBe("A\nMINE\nC\n");
});

test("a conflict is reported without touching anything", async () => {
  await port.startBranch("submission/2026-07-23-my-work");
  write("data/x.mit", "A\nMINE\nC\n");
  const before = await commit("Corrected the second line");
  await publishFiles({ "data/x.mit": "A\nTHEIRS\nC\n" }, "The same line");

  expect(await port.mergeCorpus(ME)).toEqual(["data/x.mit"]);

  // The probe is exactly that: the file, the branch and the history all stand.
  expect(read("data/x.mit")).toBe("A\nMINE\nC\n");
  expect(await git.resolveRef({ fs, dir, ref: "HEAD" })).toBe(before);
  expect(await port.changedFiles()).toEqual([]);
});

test("keeping my version resolves the conflict and records the merge", async () => {
  await port.startBranch("submission/2026-07-23-my-work");
  write("data/x.mit", "A\nMINE\nC\n");
  await commit("Corrected the second line");
  await publishFiles(
    { "data/x.mit": "A\nTHEIRS\nC\n", "data/y.mit": "second\n" },
    "The same line, and another file",
  );
  await port.mergeCorpus(ME);

  await port.mergeCorpus(ME, { "data/x.mit": "mine" });

  expect(read("data/x.mit")).toBe("A\nMINE\nC\n");
  // The rest of their work still arrives: only the conflicted file was chosen.
  expect(read("data/y.mit")).toBe("second\n");
  expect(await port.changedFiles()).toEqual([]);
  const [tip] = await git.log({ fs, dir, depth: 1 });
  expect(tip.commit.parent).toHaveLength(2);
});

test("using the corpus version resolves it the other way", async () => {
  await port.startBranch("submission/2026-07-23-my-work");
  write("data/x.mit", "A\nMINE\nC\n");
  await commit("Corrected the second line");
  await publishFiles({ "data/x.mit": "A\nTHEIRS\nC\n" }, "The same line");
  await port.mergeCorpus(ME);

  await port.mergeCorpus(ME, { "data/x.mit": "corpus" });

  expect(read("data/x.mit")).toBe("A\nTHEIRS\nC\n");
  expect(await port.changedFiles()).toEqual([]);
  expect(await port.committedText("data/x.mit")).toBe("A\nTHEIRS\nC\n");
});

test("a file the corpus deleted can be resolved either way", async () => {
  await port.startBranch("submission/2026-07-23-my-work");
  write("data/y.mit", "mine\n");
  await commit("Revised it");
  // The corpus withdraws the very text the contributor was revising.
  await publishToCorpus(() => {
    fs.rmSync(path.join(dir, "data/y.mit"));
  }, "Withdrew that text");

  const conflicts = await port.mergeCorpus(ME);
  expect(conflicts).toEqual(["data/y.mit"]);

  await port.mergeCorpus(ME, { "data/y.mit": "corpus" });
  expect(fs.existsSync(path.join(dir, "data/y.mit"))).toBe(false);
  expect(await port.changedFiles()).toEqual([]);
});

/* ------------------------ getting the latest corpus ----------------------- */

test("syncing main fast-forwards it onto the corpus", async () => {
  await publishFiles({ "data/y.mit": "second\n" }, "Somebody else's work");
  await port.syncMain();

  expect(await port.currentBranch()).toBe("main");
  expect(read("data/y.mit")).toBe("second\n");
  expect(await port.changedFiles()).toEqual([]);
});

test("a branch can be left behind and removed once its work is done", async () => {
  await port.startBranch("submission/2026-07-23-my-work");
  write("data/x.mit", "A\nMINE\nC\n");
  await commit("Corrected the second line");

  await port.switchTo("main");
  await port.deleteBranch("submission/2026-07-23-my-work");

  expect(await port.currentBranch()).toBe("main");
  expect(read("data/x.mit")).toBe("A\nB\nC\n");
  expect(await port.branches()).toEqual(["main"]);
});
