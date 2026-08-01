/**
 * The token-accounting hover's editor surface: point at a word in a `.mit`
 * document and see the citation lemma the corpus files it under, the normalised
 * form it takes within that lemma's paradigm, and — when the reading is
 * ambiguous — the other lemmas, each a click away from being pinned with
 * `[w:surface=value]` markup. The TypeScript language server's type-on-hover,
 * for the dictionary.
 *
 * All the accounting and Markdown assembly is the pure `buildHover`
 * (core/hoverView.ts); this module is the translation layer — reading the gating
 * setting live, handing the compiled dictionary from the model, mapping the
 * position, wrapping the returned Markdown in a scoped-trusted `MarkdownString`,
 * and applying the pin edit.
 *
 * Like the two squiggle overlays it is gated behind a boolean setting
 * (`compositor.showTokenHover`, default on), the third tick box in the one
 * "Toggle Dictionary Accounting Hints" command — read live on each hover, so
 * flipping it needs no re-registration.
 */

import * as vscode from "vscode";
import type { CorpusModel } from "../../core/model/corpusModel.ts";
import {
  buildHover,
  createCompileMemo,
  createFormsCache,
  PIN_COMMAND,
  type PinArgs,
} from "../../core/hover/view.ts";
import { wordMarkup } from "../../core/hover/pinMarkup.ts";

/** The setting that gates the hover (default on), flipped from the shared
 * "Toggle Dictionary Accounting Hints" command. */
const SETTING = "showTokenHover";

const MIT = { scheme: "file", pattern: "**/*.mit" } as const;

export const registerHover = (
  model: CorpusModel,
  context: vscode.ExtensionContext,
): void => {
  const compile = createCompileMemo();
  const forms = createFormsCache();
  context.subscriptions.push(
    vscode.languages.registerHoverProvider(MIT, {
      provideHover: (document, position) => {
        const config = vscode.workspace.getConfiguration("compositor");
        if (!config.get<boolean>(SETTING, true)) return undefined;
        const dictionary = model.state?.catalogue.dictionary;
        if (dictionary === undefined) return undefined;
        const view = buildHover(
          {
            uri: document.uri.toString(),
            version: document.version,
            text: document.getText(),
            line: position.line,
            character: position.character,
            dictionary,
          },
          compile,
          forms,
        );
        if (view === undefined) return undefined;
        const md = new vscode.MarkdownString(view.markdown);
        // Trusted, but scoped to the one command the pin links fire.
        md.isTrusted = { enabledCommands: [PIN_COMMAND] };
        return new vscode.Hover(md, new vscode.Range(...view.range));
      },
    }),
    vscode.commands.registerCommand(PIN_COMMAND, pinReading),
  );
};

/** Replace a token with `[w:surface=value]`, reading the surface live from the
 * current document (its original spelling and case) so the edit stays valid even
 * if the buffer changed since the hover was shown. Mirrors the suggestion
 * overlay's replace-and-apply. */
const pinReading = async (args: PinArgs): Promise<void> => {
  const uri = vscode.Uri.parse(args.uri);
  const range = new vscode.Range(...args.range);
  const document = await vscode.workspace.openTextDocument(uri);
  const surface = document.getText(range);
  const edit = new vscode.WorkspaceEdit();
  edit.replace(uri, range, wordMarkup(surface, args.value));
  await vscode.workspace.applyEdit(edit);
};
