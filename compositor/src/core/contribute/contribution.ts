/**
 * The Contribute panel's core: reading the working copy's situation into the
 * scene the webview renders, and labelling the changed files the way the corpus
 * browser would. The judgments themselves are workflow.ts's (`describeState` and
 * friends); this module is the orchestrator that gathers the three facts they
 * need — the branch and changes from git, the submission from GitHub — over the
 * ports, plus the two situations the workflow has no opinion about (still
 * reading, not a clone at all). vscode-free: the panel surface supplies the
 * session, the port factories, and the catalogue, and does the rendering.
 */

import type { Catalogue } from "@earlytexts/corpus";
import type { FileChange, GitPort } from "./gitPort.ts";
import type { GitHubClient, Viewer } from "./github.ts";
import {
  describeState,
  isSubmissionBranch,
  type Submission,
  type WorkState,
} from "./workflow.ts";
import { scopedEditions } from "../search/panel.ts";

/** One changed file as the panel shows it: the catalogue's label for it where
 * the corpus knows one, the path itself where it does not. */
export type ChangeRow = {
  path: string;
  label: string;
  change: FileChange["change"];
};

/** What the webview renders. The first two are situations the workflow has no
 * opinion about: still reading, and not a copy of the corpus at all. The rest
 * are `WorkState` with each changed file labelled and the raw paths dropped. */
export type Scene =
  | { kind: "loading" }
  | { kind: "noRepo" }
  | { kind: "signedOut"; files: ChangeRow[] }
  | { kind: "clean" }
  | { kind: "editing"; files: ChangeRow[] }
  | { kind: "unfinished"; title: string; files: ChangeRow[] }
  | { kind: "sent"; submission: Submission; files: ChangeRow[] }
  | {
      kind: "decided";
      submission: Submission;
      accepted: boolean;
      files: ChangeRow[];
    };

/** The ports and facts `readScene` reads the situation from. `session` reads a
 * cached GitHub session without prompting (undefined when signed out); `gitAt`
 * and `githubAt` bind the ports to the repo root and the token. */
export type SceneSources = {
  root: string | undefined;
  catalogue: Catalogue | undefined;
  session: () => Promise<{ token: string } | undefined>;
  gitAt: (root: string, token: string) => GitPort;
  githubAt: (token: string) => GitHubClient;
};

/**
 * Read the working copy and decide what the panel shows. Reads the branch and
 * changes through git; when signed in, asks GitHub about the submission and
 * hands all three to `describeState`. Returns the scene and — when signed in —
 * the viewer, which names the fork a submission is pushed to and authors its
 * commits, so the panel caches it for the actions that follow.
 */
export const readScene = async ({
  root,
  catalogue,
  session,
  gitAt,
  githubAt,
}: SceneSources): Promise<{ scene: Scene; viewer?: Viewer }> => {
  if (root === undefined) return { scene: { kind: "noRepo" } };
  const auth = await session();
  const git = gitAt(root, auth?.token ?? "");
  const branch = await git.currentBranch();
  const changes = await git.changedFiles();
  if (auth === undefined) {
    return {
      scene: {
        kind: "signedOut",
        files: labelChanges(changes, catalogue, root),
      },
    };
  }
  const gh = githubAt(auth.token);
  const viewer = await gh.getViewer();
  const submitted = isSubmissionBranch(branch);
  const pull = submitted
    ? await gh.findPull(`${viewer.login}:${branch}`)
    : undefined;
  const state = describeState({
    branch,
    changes,
    signedIn: true,
    pull,
    // Naming an interrupted send after the work it carries is the only way the
    // contributor can tell what it is they are being asked to finish.
    title:
      submitted && pull === undefined
        ? await git.lastCommitMessage(branch)
        : undefined,
  });
  return { scene: sceneFrom(state, catalogue, root), viewer };
};

/** The same state the workflow decided, with each changed file labelled — and
 * the raw paths dropped, since the panel renders only the labels. */
export const sceneFrom = (
  state: WorkState,
  catalogue: Catalogue | undefined,
  root: string,
): Scene => {
  if (state.kind === "clean") return state;
  const { changes, ...rest } = state;
  return { ...rest, files: labelChanges(changes, catalogue, root) };
};

/** Label each changed file the way the corpus browser would: the catalogue
 * edition's label where the path is one, the root-relative path otherwise. */
export const labelChanges = (
  changes: FileChange[],
  catalogue: Catalogue | undefined,
  root: string,
): ChangeRow[] => {
  const labels = new Map<string, string>();
  if (catalogue !== undefined) {
    for (const edition of scopedEditions(catalogue, [], [])) {
      if (edition.path.startsWith(`${root}/`)) {
        labels.set(edition.path.slice(root.length + 1), edition.label);
      }
    }
  }
  return changes.map(({ path, change }) => ({
    path,
    label: labels.get(path) ?? path,
    change,
  }));
};
