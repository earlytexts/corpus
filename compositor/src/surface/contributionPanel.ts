/**
 * The Contribute panel: the whole business of getting a contributor's work back
 * to the Centre, in a docked webview that never says branch, commit, push or
 * pull request. It shows one thing at a time — what you have changed, what you
 * have sent, what the editors decided — and offers only the action that makes
 * sense there. The vocabulary is fixed: your changes, send for review, your
 * submission, get the latest corpus.
 *
 * This module is the wiring: it reads the working copy through the git port,
 * asks GitHub about the submission, hands both to workflow.ts to be judged, and
 * posts the resulting scene to the webview. The judgments live in workflow.ts;
 * the rendering lives in webview/contribute.ts; what is left here is VSCode —
 * sign-in, progress, dialogs, diffs, and refreshing at the right moments.
 *
 * Sign-in is silent where it can be: the panel reads a cached GitHub session
 * without prompting, and only asks the contributor to sign in when they press
 * something that needs it.
 */

import * as vscode from "vscode";
import {
  type FileChange,
  findRepoRoot,
  type GitPort,
  nodeGitPort,
  type Resolutions,
} from "../git/gitPort.ts";
import { type GitHubClient, githubClient, type Viewer } from "../git/github.ts";
import {
  addToSubmission,
  type ConflictResolver,
  describeState,
  getLatest,
  isSubmissionBranch,
  sendForReview,
  type Submission,
  tidyUp,
  type WorkState,
} from "../git/workflow.ts";
import { panelHtml } from "./panelShell.ts";
import { CONTRIBUTE_CSS } from "./contributionPanelCss.ts";
import { scopedEditions } from "../lib/searchPanel.ts";
import type { CorpusModel } from "../corpusModel.ts";

const VIEW_ID = "compositor.contributionPanel";

/** The scheme the panel's diffs read their historical sides from. */
export const GIT_SCHEME = "compositor-git";

/** One changed file as the panel shows it: the catalogue's label for it where
 * the corpus knows one, the path itself where it does not. */
type ChangeRow = {
  path: string;
  label: string;
  change: FileChange["change"];
};

/** What the webview renders. The first two are situations the workflow has no
 * opinion about: still reading, and not a copy of the corpus at all. */
type Scene =
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

type Incoming =
  | { type: "ready" }
  | { type: "refresh" }
  | { type: "setup" }
  | { type: "signIn" }
  | { type: "open"; path: string }
  | { type: "compare"; path: string }
  | { type: "discard"; path: string }
  | { type: "send"; description: string; notes: string }
  | { type: "addTo"; description: string }
  | { type: "openSubmission"; url: string }
  | { type: "getLatest" }
  | { type: "tidyUp" };

export type ContributionPanel = {
  /** The corpus reloaded (a save, a scaffold, a merge): re-read the changes. */
  onCorpusChanged: () => void;
  /** Read the working copy again, and ask GitHub what it makes of it. */
  refresh: () => void;
  /** Serves the historical sides of the panel's diffs. */
  contentProvider: vscode.TextDocumentContentProvider;
};

export const createContributionPanel = (
  getModel: () => CorpusModel | undefined,
  context: vscode.ExtensionContext,
  /** Files changed underfoot (a merge, a discard): recompile the corpus. */
  onFilesChanged: () => void,
): ContributionPanel => {
  let view: vscode.WebviewView | undefined;
  let scene: Scene = { kind: "loading" };
  let busy: string | undefined;
  let error: string | undefined;
  /** The signed-in user, cached for as long as the panel lives: it names the
   * fork the submission is pushed to and authors the commits. */
  let viewer: Viewer | undefined;
  let reading = false;
  let again = false;

  const post = (): void => {
    void view?.webview.postMessage({ type: "view", scene, busy, error });
  };

  /* ------------------------------ reading ------------------------------- */

  /** Re-read the working copy and decide what the panel shows. Never runs
   * twice at once: a request arriving mid-read queues exactly one more pass. */
  const refresh = async (): Promise<void> => {
    if (reading) {
      again = true;
      return;
    }
    reading = true;
    try {
      scene = await readScene();
      error = undefined;
    } catch (problem) {
      error = messageOf(problem);
    } finally {
      reading = false;
      post();
    }
    if (again) {
      again = false;
      await refresh();
    }
  };

  const readScene = async (): Promise<Scene> => {
    const root = repoRoot();
    if (root === undefined) return { kind: "noRepo" };

    const session = await vscode.authentication.getSession("github", ["repo"], {
      createIfNone: false,
    });
    const git = nodeGitPort(root, session?.accessToken ?? "");
    const branch = await git.currentBranch();
    const changes = await git.changedFiles();
    if (session === undefined) {
      return { kind: "signedOut", files: rows(changes, root) };
    }

    const gh = githubClient(session.accessToken);
    viewer = await gh.getViewer();
    const submitted = isSubmissionBranch(branch);
    const pull = submitted
      ? await gh.findPull(`${viewer.login}:${branch}`)
      : undefined;
    return asScene(
      describeState({
        branch,
        changes,
        signedIn: true,
        pull,
        // Naming an interrupted send after the work it carries is the only way
        // the contributor can tell what it is they are being asked to finish.
        title:
          submitted && pull === undefined
            ? await git.lastCommitMessage(branch)
            : undefined,
      }),
      root,
    );
  };

  /** The same state the workflow decided, with each changed file labelled —
   * and the raw paths dropped, since the panel renders only the labels. */
  const asScene = (state: WorkState, root: string): Scene => {
    if (state.kind === "clean") return state;
    const { changes, ...rest } = state;
    return { ...rest, files: rows(changes, root) };
  };

  /** The repository holding the corpus: the model's root when one is attached,
   * otherwise the workspace folder, walked up to the enclosing clone. */
  const repoRoot = (): string | undefined => {
    const start =
      getModel()?.root ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    return start === undefined ? undefined : findRepoRoot(start);
  };

  /** Label each changed file the way the corpus browser would. */
  const rows = (changes: FileChange[], root: string): ChangeRow[] => {
    const catalogue = getModel()?.state?.catalogue;
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

  /* ------------------------------ actions ------------------------------- */

  type Session = { git: GitPort; gh: GitHubClient; who: Viewer };

  /** Run one of the verbs that reach GitHub: sign in first, then hand the
   * action a token-bearing port and who is signed in. */
  const run = async (
    title: string,
    action: (it: Session, report: (message: string) => void) => Promise<void>,
  ): Promise<void> => {
    const session = await vscode.authentication.getSession("github", ["repo"], {
      createIfNone: true,
    });
    if (session === undefined) return; // sign-in dismissed
    const gh = githubClient(session.accessToken);
    viewer = viewer ?? (await gh.getViewer());
    const who = viewer;
    await runLocally(
      title,
      (git, report) => action({ git, gh, who }, report),
      session.accessToken,
    );
  };

  /** Do something to the working copy: report progress into both the panel and
   * a notification, then re-read — and turn any failure into a sentence rather
   * than a stack trace. Signs nobody in: on its own, this touches only this
   * machine. */
  const runLocally = async (
    title: string,
    action: (git: GitPort, report: (message: string) => void) => Promise<void>,
    token = "",
  ): Promise<void> => {
    const root = repoRoot();
    if (root === undefined) return;
    try {
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title },
        async (progress) => {
          await action(nodeGitPort(root, token), (message) => {
            busy = message;
            post();
            progress.report({ message });
          });
        },
      );
      error = undefined;
    } catch (problem) {
      error = messageOf(problem);
    } finally {
      busy = undefined;
      onFilesChanged();
      await refresh();
    }
  };

  const send = (description: string, notes: string): Promise<void> =>
    run("Sending your work for review", async (it, report) => {
      const submission = await sendForReview({
        git: it.git,
        gh: it.gh,
        login: it.who.login,
        who: { name: it.who.name, email: it.who.email },
        description,
        notes,
        now: new Date(),
        // Only an interrupted send continues where it left off; anything else
        // — including new work after a decision — starts a submission of its
        // own, since a settled one can no longer be added to.
        branch:
          scene.kind === "unfinished"
            ? await it.git.currentBranch()
            : undefined,
        onProgress: report,
        resolveConflicts,
      });
      if (submission === undefined) return; // backed out of a conflict
      const open = await vscode.window.showInformationMessage(
        "Your work has been sent to the Early Text Centre. The editors will " +
          "reply on GitHub, and this panel will tell you when they have.",
        "See it on GitHub",
      );
      if (open !== undefined) await openUrl(submission.url);
    });

  const addTo = (description: string): Promise<void> =>
    run("Adding to your submission", async (it, report) => {
      const added = await addToSubmission({
        git: it.git,
        who: { name: it.who.name, email: it.who.email },
        branch: await it.git.currentBranch(),
        description,
        onProgress: report,
        resolveConflicts,
      });
      if (added) {
        void vscode.window.showInformationMessage(
          "Your latest changes have been added to your submission.",
        );
      }
    });

  /** Ask about each file that changed here and in the corpus at once. Backing
   * out of any one of them abandons the whole merge, changing nothing. */
  const resolveConflicts: ConflictResolver = async (paths) => {
    const choices: Record<string, "mine" | "corpus"> = {};
    for (const path of paths) {
      const choice = await askAboutFile(path);
      if (choice === undefined) return undefined;
      choices[path] = choice;
    }
    return choices satisfies Resolutions;
  };

  const askAboutFile = async (
    path: string,
  ): Promise<"mine" | "corpus" | undefined> => {
    const MINE = "Keep my version";
    const CORPUS = "Use the corpus version";
    const LOOK = "Show me the difference";
    for (;;) {
      const answer = await vscode.window.showWarningMessage(
        `“${labelFor(path)}” was changed in the corpus while you were ` +
          `working on it. Which version should be kept?`,
        { modal: true },
        MINE,
        CORPUS,
        LOOK,
      );
      if (answer === MINE) return "mine";
      if (answer === CORPUS) return "corpus";
      if (answer === undefined) return undefined;
      await vscode.commands.executeCommand(
        "vscode.diff",
        gitUri("corpus", path),
        gitUri("committed", path),
        `${basename(path)}: the corpus ↔ your version`,
      );
    }
  };

  const discard = async (path: string): Promise<void> => {
    const DISCARD = "Discard";
    const answer = await vscode.window.showWarningMessage(
      `Throw away your changes to “${labelFor(path)}”? This cannot be undone.`,
      { modal: true },
      DISCARD,
    );
    if (answer !== DISCARD) return;
    // Undoing is nobody's business but this machine's, so it never asks the
    // contributor to sign in.
    await runLocally("Discarding your changes", (git) => git.restore(path));
  };

  const compare = async (path: string): Promise<void> => {
    const root = repoRoot();
    if (root === undefined) return;
    await vscode.commands.executeCommand(
      "vscode.diff",
      gitUri("committed", path),
      vscode.Uri.file(`${root}/${path}`),
      `${basename(path)}: before ↔ your changes`,
    );
  };

  /** The catalogue label the panel is showing for a path, for dialogs to use
   * the same words the contributor is looking at. */
  const labelFor = (path: string): string =>
    ("files" in scene ? scene.files : []).find((row) => row.path === path)
      ?.label ?? path;

  /* ------------------------------ the view ------------------------------ */

  const onMessage = (message: Incoming): void => {
    switch (message.type) {
      case "ready":
        post();
        void refresh();
        return;
      case "refresh":
        void refresh();
        return;
      case "setup":
        void vscode.commands.executeCommand("compositor.setup");
        return;
      case "signIn":
        void vscode.authentication
          .getSession("github", ["repo"], { createIfNone: true })
          .then(() => refresh());
        return;
      case "open": {
        const root = repoRoot();
        if (root !== undefined) {
          void vscode.window.showTextDocument(
            vscode.Uri.file(`${root}/${message.path}`),
          );
        }
        return;
      }
      case "compare":
        void compare(message.path);
        return;
      case "discard":
        void discard(message.path);
        return;
      case "send":
        void send(message.description, message.notes);
        return;
      case "addTo":
        void addTo(message.description);
        return;
      case "openSubmission":
        void openUrl(message.url);
        return;
      case "getLatest":
        void run("Getting the latest corpus", (it, report) =>
          getLatest(it.git, report),
        );
        return;
      case "tidyUp":
        void run("Tidying up", async (it, report) =>
          tidyUp({
            git: it.git,
            gh: it.gh,
            login: it.who.login,
            branch: await it.git.currentBranch(),
            onProgress: report,
          }),
        );
        return;
    }
  };

  const provider: vscode.WebviewViewProvider = {
    resolveWebviewView: (webviewView) => {
      view = webviewView;
      webviewView.webview.options = {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "dist")],
      };
      webviewView.webview.onDidReceiveMessage(onMessage);
      webviewView.webview.html = panelHtml(
        webviewView.webview,
        context.extensionUri,
        CONTRIBUTE_CSS,
        "contributeview.js",
      );
      // Coming back to the panel is exactly when a contributor wants to know
      // whether the editors have replied, so a visible panel is a fresh one.
      webviewView.onDidChangeVisibility(() => {
        if (webviewView.visible) void refresh();
      });
      webviewView.onDidDispose(() => {
        if (view === webviewView) view = undefined;
      });
    },
  };

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(VIEW_ID, provider),
  );

  return {
    onCorpusChanged: () => void refresh(),
    refresh: () => void refresh(),
    // "committed" is a file as it was before the current round of changes;
    // "corpus" is the Centre's published version. Both are read straight out of
    // the repository, so no token and no network are involved.
    contentProvider: {
      provideTextDocumentContent: async (uri) => {
        const root = repoRoot();
        if (root === undefined) return "";
        const git = nodeGitPort(root, "");
        const path = uri.path.replace(/^\//, "");
        const text =
          uri.authority === "corpus"
            ? await git.corpusText(path)
            : await git.committedText(path);
        return text ?? "";
      },
    },
  };
};

const gitUri = (side: "committed" | "corpus", path: string): vscode.Uri =>
  vscode.Uri.parse(`${GIT_SCHEME}://${side}/${path}`);

const openUrl = async (url: string): Promise<void> => {
  await vscode.env.openExternal(vscode.Uri.parse(url));
};

const basename = (path: string): string =>
  path.slice(path.lastIndexOf("/") + 1);

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
