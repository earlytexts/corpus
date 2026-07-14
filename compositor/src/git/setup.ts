/**
 * "Set up the corpus on this computer" — the onboarding flow that replaces
 * handing the user to `git clone`. It signs them in to GitHub, ensures they
 * have a fork, clones that fork into a folder they choose, points `upstream` at
 * the canonical corpus, and offers to open the result. This is the riskiest
 * slice of the contribution feature (auth + fork + programmatic clone), proven
 * end-to-end here before the rest of the verbs are built on gitPort.
 *
 * The GitHub token comes from VSCode's built-in `github` auth provider, so
 * there are no tokens to paste or store; the same token authenticates both the
 * REST calls and the clone.
 */

import * as vscode from "vscode";
import * as fs from "node:fs";
import { ensureFork, githubClient, UPSTREAM_URL } from "./github.ts";
import { addRemote, cloneRepo } from "./gitPort.ts";

export const runSetup = async (): Promise<void> => {
  const dir = await chooseDestination();
  if (dir === undefined) return;

  const session = await vscode.authentication.getSession("github", ["repo"], {
    createIfNone: true,
  });
  const token = session.accessToken;
  const gh = githubClient(token);

  try {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Setting up the corpus",
        cancellable: false,
      },
      async (progress) => {
        const report = (message: string): void => progress.report({ message });
        const sleep = (ms: number): Promise<void> =>
          new Promise((resolve) => setTimeout(resolve, ms));

        report("Checking your GitHub account…");
        const login = await gh.getViewerLogin();

        report("Finding your copy of the corpus…");
        const cloneUrl = await ensureFork(gh, login, report, sleep);

        report("Downloading the corpus…");
        await cloneRepo({ dir, url: cloneUrl, token, onProgress: report });
        await addRemote(dir, "upstream", UPSTREAM_URL);
      },
    );
  } catch (error) {
    await vscode.window.showErrorMessage(
      `Setting up the corpus failed: ${messageOf(error)}`,
    );
    return;
  }

  const open = await vscode.window.showInformationMessage(
    "The corpus is ready on this computer. Open it now?",
    "Open",
  );
  if (open === "Open") {
    await vscode.commands.executeCommand(
      "vscode.openFolder",
      vscode.Uri.file(dir),
    );
  }
};

/** Pick a parent folder, then the corpus lands in a `corpus` subfolder of it. */
const chooseDestination = async (): Promise<string | undefined> => {
  const picked = await vscode.window.showOpenDialog({
    canSelectFolders: true,
    canSelectFiles: false,
    canSelectMany: false,
    title: "Choose where to set up the corpus",
    openLabel: "Set up here",
  });
  if (picked === undefined || picked.length === 0) return undefined;

  const dir = vscode.Uri.joinPath(picked[0], "corpus").fsPath;
  if (fs.existsSync(dir)) {
    await vscode.window.showErrorMessage(
      `A folder called "corpus" already exists here. Move or remove it, or ` +
        `choose a different location, then try again.`,
    );
    return undefined;
  }
  return dir;
};

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
