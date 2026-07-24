/**
 * The contribution workflow: what a contributor's working copy is *doing*, and
 * the four things they can ask of it — send this work for review, add more to
 * what was sent, get the latest corpus, tidy up after a decision.
 *
 * This module is the translation layer. Beneath it sit two ports (git and
 * GitHub) that know nothing of contributions; above it sits a panel that shows
 * no branches, commits, pushes or pull requests. One unit of work is in flight
 * at a time and it is called a submission: one branch, one pull request, one
 * lifecycle the panel can state in a sentence. Everything here is written over
 * the ports, so the whole flow is testable without a repository or a network.
 */

import type { FileChange, GitPort, Identity, Resolutions } from "./gitPort.ts";
import { MAIN } from "./gitPort.ts";
import type { GitHubClient, PullSummary } from "./github.ts";

/** Work that has been sent to the Centre: one branch, one pull request. */
export type Submission = {
  readonly branch: string;
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly createdAt: string;
};

/** Where the contributor stands. The panel renders exactly one of these. */
export type WorkState =
  /** Not signed in to GitHub, so nothing can be sent or checked yet. */
  | { kind: "signedOut"; changes: FileChange[] }
  /** Nothing changed, nothing outstanding. */
  | { kind: "clean" }
  /** Work in progress, not yet sent. */
  | { kind: "editing"; changes: FileChange[] }
  /** A send that stopped part-way (the connection dropped, say). */
  | { kind: "unfinished"; branch: string; title: string; changes: FileChange[] }
  /** Sent and awaiting review; `changes` are edits made since. */
  | { kind: "sent"; submission: Submission; changes: FileChange[] }
  /** The editors have accepted or declined it; `changes` are edits made since,
   * which belong to a new submission rather than the settled one. */
  | {
      kind: "decided";
      submission: Submission;
      accepted: boolean;
      changes: FileChange[];
    };

/** Branches the compositor makes are all under one prefix, so a working copy
 * can be read at a glance: on `main` you are editing, anywhere else you have
 * something in flight. */
export const BRANCH_PREFIX = "submission/";

export const isSubmissionBranch = (branch: string): boolean =>
  branch.startsWith(BRANCH_PREFIX);

/**
 * Read the working copy's situation from three facts: which branch it is on,
 * what has changed, and what GitHub says about the submission (if it can be
 * asked). Pure — every judgment the panel makes is decided here.
 */
export const describeState = (input: {
  branch: string;
  changes: FileChange[];
  signedIn: boolean;
  pull?: PullSummary;
  /** The message of the last ordinary commit, naming an unfinished send. */
  title?: string;
}): WorkState => {
  const { branch, changes, signedIn, pull } = input;
  if (!signedIn) return { kind: "signedOut", changes };
  if (!isSubmissionBranch(branch)) {
    return changes.length === 0
      ? { kind: "clean" }
      : { kind: "editing", changes };
  }
  if (pull === undefined) {
    return {
      kind: "unfinished",
      branch,
      title: input.title ?? "Your unsent work",
      changes,
    };
  }
  const submission = asSubmission(branch, pull);
  if (pull.state === "open") return { kind: "sent", submission, changes };
  return { kind: "decided", submission, accepted: pull.merged, changes };
};

/** How the contributor is asked to choose between two versions of a file. */
export type ConflictResolver = (
  paths: string[],
) => Promise<Resolutions | undefined>;

export type SendOptions = {
  git: GitPort;
  gh: GitHubClient;
  login: string;
  who: Identity;
  description: string;
  notes: string;
  now: Date;
  /** An unfinished submission's branch, to be finished rather than replaced. */
  branch?: string;
  onProgress: (message: string) => void;
  resolveConflicts: ConflictResolver;
};

/**
 * Send everything the contributor has changed to the Centre for review, as one
 * described commit on a branch of its own, brought up to date with the corpus
 * and opened as a pull request. Resolves with the submission, or with undefined
 * if the contributor backed out of a conflict — in which case their work is
 * still committed on the branch and the panel offers to finish the send.
 */
export const sendForReview = async ({
  git,
  gh,
  login,
  who,
  description,
  notes,
  now,
  branch,
  onProgress,
  resolveConflicts,
}: SendOptions): Promise<Submission | undefined> => {
  const changes = await git.changedFiles();
  let target = branch;
  if (target === undefined) {
    onProgress("Setting your work aside…");
    target = branchNameFor(description, now, await git.branches());
    await git.startBranch(target);
  }
  if (changes.length > 0) {
    onProgress("Saving your changes…");
    await git.commitAll(description, who);
  }

  if (!(await bringInTheCorpus(git, who, onProgress, resolveConflicts))) {
    return undefined;
  }

  onProgress("Sending your work…");
  await git.push(target);
  const pull = await gh.createPull({
    head: `${login}:${target}`,
    title: description,
    body: notes,
  });
  return asSubmission(target, pull);
};

export type AddOptions = {
  git: GitPort;
  who: Identity;
  branch: string;
  description: string;
  onProgress: (message: string) => void;
  resolveConflicts: ConflictResolver;
};

/** Add further changes to a submission already under review: the same branch,
 * so the editors see them in the conversation they are already having. */
export const addToSubmission = async ({
  git,
  who,
  branch,
  description,
  onProgress,
  resolveConflicts,
}: AddOptions): Promise<boolean> => {
  const changes = await git.changedFiles();
  if (changes.length > 0) {
    onProgress("Saving your changes…");
    await git.commitAll(description, who);
  }
  if (!(await bringInTheCorpus(git, who, onProgress, resolveConflicts))) {
    return false;
  }
  onProgress("Sending your work…");
  await git.push(branch);
  return true;
};

/** Take everything the Centre has published since this copy was made. Only
 * offered with no changes outstanding, so nothing of the contributor's can be
 * caught up in it. */
export const getLatest = async (
  git: GitPort,
  onProgress: (message: string) => void,
): Promise<void> => {
  onProgress("Fetching the latest corpus…");
  await git.fetchCorpus();
  onProgress("Updating your copy…");
  await git.syncMain();
};

/** Put the working copy back to a fresh main once a submission is settled, and
 * drop the branch it lived on here and on GitHub. */
export const tidyUp = async ({
  git,
  gh,
  login,
  branch,
  onProgress,
}: {
  git: GitPort;
  gh: GitHubClient;
  login: string;
  branch: string;
  onProgress: (message: string) => void;
}): Promise<void> => {
  onProgress("Updating your copy of the corpus…");
  await git.switchTo(MAIN);
  await git.fetchCorpus();
  await git.syncMain();
  await git.deleteBranch(branch);
  // GitHub deletes the branch itself when the repository is set to, so a
  // failure here is housekeeping that is already done.
  await gh.deleteBranch(login, branch).catch(() => {});
};

/**
 * A branch name for a submission: the date it was sent and a few words of the
 * contributor's own description, which is all that makes these legible in a
 * list of pull requests. Never collides with a name already used.
 */
export const branchNameFor = (
  description: string,
  now: Date,
  taken: string[],
): string => {
  const base = `${BRANCH_PREFIX}${now.toISOString().slice(0, 10)}-${slugify(description)}`;
  if (!taken.includes(base)) return base;
  for (let n = 2; ; n++) {
    if (!taken.includes(`${base}-${n}`)) return `${base}-${n}`;
  }
};

/** Merge in the fetched corpus, asking the contributor about any file that
 * changed on both sides. False if they backed out. */
const bringInTheCorpus = async (
  git: GitPort,
  who: Identity,
  onProgress: (message: string) => void,
  resolveConflicts: ConflictResolver,
): Promise<boolean> => {
  onProgress("Checking for changes to the corpus…");
  await git.fetchCorpus();
  const conflicts = await git.mergeCorpus(who);
  if (conflicts.length === 0) return true;
  const choices = await resolveConflicts(conflicts);
  if (choices === undefined) return false;
  onProgress("Bringing in the latest corpus…");
  await git.mergeCorpus(who, choices);
  return true;
};

const asSubmission = (branch: string, pull: PullSummary): Submission => ({
  branch,
  number: pull.number,
  title: pull.title,
  url: pull.url,
  createdAt: pull.createdAt,
});

/** Words only, hyphen-joined, cut at a word boundary — a description reads as
 * a branch name without ever being one the contributor has to type. */
const slugify = (description: string): string => {
  const words = description
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // drop accents
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word !== "");
  const kept: string[] = [];
  let length = 0;
  for (const word of words) {
    const cost = kept.length === 0 ? word.length : word.length + 1;
    if (length + cost > MAX_SLUG) break;
    kept.push(word);
    length += cost;
  }
  return kept.length === 0 ? "changes" : kept.join("-");
};

const MAX_SLUG = 30;
