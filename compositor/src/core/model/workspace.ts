/**
 * The two workspace-level decisions the composition root used to make inline:
 * which open folder is the corpus, and what the tree view should say for the
 * model's current phase. Both are pure — one over the `CorpusFs` port and a
 * plain list of folder paths, the other over the model's status alone — so the
 * extension.ts residue is left wiring only (reading the config, mapping vscode
 * workspace folders to paths, injecting `nodeCorpusFs`).
 */

import type { CorpusFs } from "@earlytexts/corpus";
import type { CorpusModel } from "./corpusModel.ts";

/** The first folder that looks like the corpus (has data/authors), honouring a
 * workspace-relative `corpusRoot` prefix (empty for the folder itself). The
 * result is canonicalised (realPath), so the model's precompiled-document keys
 * line up with the paths buildCatalogue resolves internally. */
export const findCorpusRoot = async (
  fs: CorpusFs,
  folders: readonly string[],
  configured: string,
): Promise<string | undefined> => {
  const prefix = configured.replace(/\/$/, "");
  for (const folder of folders) {
    const root = prefix === "" ? folder : `${folder}/${prefix}`;
    const authors = await fs.stat(`${root}/data/authors`);
    if (authors !== null && !authors.isFile) {
      return await fs.realPath(root);
    }
  }
  return undefined;
};

/** The tree view's status message for the model's current phase, or undefined
 * to fall back to the view's welcome content (package.json viewsWelcome). With
 * no model there is no corpus attached, so the welcome content ("No corpus
 * found…") is exactly right. Otherwise the model's own `status` decides — never
 * the raw `loading`/`state` pair, which reads the pre-first-load window as a
 * failure. */
export const viewMessage = (
  model: CorpusModel | undefined,
): string | undefined => {
  if (model === undefined) return undefined;
  switch (model.status) {
    case "loading":
      return "Loading the corpus…";
    case "failed":
      return "The corpus failed to load.";
    case "ready":
      return undefined;
  }
};
