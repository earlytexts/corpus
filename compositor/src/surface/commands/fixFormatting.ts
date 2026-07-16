/**
 * One-click equivalent of the corpus's `deno task fmt`: apply the Markit
 * formatter to every .mit file under data/, in place. Reports how many files
 * changed; the watcher then revalidates.
 */

import * as vscode from "vscode";
import { format } from "@jsr/earlytexts__markit";
import type { CorpusModel } from "../../corpusModel.ts";
import { nodeCorpusFs } from "@earlytexts/corpus";

export const fixFormatting = (model: CorpusModel): Thenable<void> =>
  vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Formatting corpus",
    },
    async () => {
      let changed = 0;
      let total = 0;
      const walk = async (dir: string): Promise<void> => {
        for (const entry of await nodeCorpusFs.readDir(dir)) {
          const path = `${dir}/${entry.name}`;
          if (entry.isDirectory) await walk(path);
          else if (entry.name.endsWith(".mit")) {
            total++;
            const text = await nodeCorpusFs.readFile(path);
            if (text === null) continue;
            const formatted = format(text);
            if (formatted !== text) {
              await vscode.workspace.fs.writeFile(
                vscode.Uri.file(path),
                new TextEncoder().encode(formatted),
              );
              changed++;
            }
          }
        }
      };
      await walk(`${model.root}/data/authors`);
      await walk(`${model.root}/data/works`);
      void vscode.window.showInformationMessage(
        `Compositor: formatted ${changed} of ${total} files`,
      );
    },
  );
