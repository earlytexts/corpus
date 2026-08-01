/**
 * The vscode adapter for the onboarding flow (core/setup.ts): it translates the
 * flow's ports into VSCode — the folder dialog, the progress notification, the
 * built-in `github` sign-in (so there are no tokens to paste or store; the same
 * token authenticates both the REST calls and the clone), the REST client, and
 * the bundled-git clone. Every decision lives in core; this file is wiring.
 */

import * as vscode from "vscode";
import * as fs from "node:fs";
import { runSetup as runSetupCore } from "../../core/contribute/setup.ts";
import { githubClient } from "./github.ts";
import { addRemote, cloneRepo } from "./gitPort.ts";

export const runSetup = (): Promise<void> =>
  runSetupCore({
    git: { clone: cloneRepo, addRemote },
    makeGitHub: githubClient,
    authenticate: async () => {
      const session = await vscode.authentication.getSession(
        "github",
        ["repo"],
        {
          createIfNone: true,
        },
      );
      return session.accessToken;
    },
    ui: {
      chooseDestination,
      withProgress: async (work) =>
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: "Setting up the corpus",
            cancellable: false,
          },
          (progress) => work((message) => progress.report({ message })),
        ),
      reportFailure: async (message) => {
        await vscode.window.showErrorMessage(message);
      },
      askToOpen: async () =>
        (await vscode.window.showInformationMessage(
          "The corpus is ready on this computer. Open it now?",
          "Open",
        )) === "Open",
      open: async (dir) => {
        await vscode.commands.executeCommand(
          "vscode.openFolder",
          vscode.Uri.file(dir),
        );
      },
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    },
  });

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
