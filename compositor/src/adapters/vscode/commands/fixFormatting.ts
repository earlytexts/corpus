/**
 * The editor surface of the format sweep: a progress notification while
 * core/fixFormatting.ts rewrites every changed `.mit` under `data/`, then a
 * summary of how many files changed. The watcher revalidates on its own.
 */

import * as vscode from "vscode";
import { nodeCorpusFs } from "@earlytexts/corpus";
import type { CorpusModel } from "../../../core/model/corpusModel.ts";
import { formatCorpus } from "../../../core/authoring/fixFormatting.ts";

export const fixFormatting = (model: CorpusModel): Thenable<void> =>
  vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Formatting corpus",
    },
    async () => {
      const { changed, total } = await formatCorpus(nodeCorpusFs, model.root);
      void vscode.window.showInformationMessage(
        `Compositor: formatted ${changed} of ${total} files`,
      );
    },
  );
