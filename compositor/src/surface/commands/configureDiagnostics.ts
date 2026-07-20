/**
 * The one command that toggles the three inline aids — the dictionary
 * accounting squiggles (warnings on unaccounted words), the markup suggestions
 * (hints on likely people, places, organisations, citations, and foreign text),
 * and the token-accounting hover (the lemma-and-forms tooltip). Each is driven
 * by its own boolean setting and reacts to it on its own
 * (commands/dictionaryDiagnostics.ts, commands/suggestMarkup.ts, hover.ts); this
 * command only presents the three as tick boxes and writes the chosen state
 * back, so a contributor turns them on and off from one place. Esc leaves all
 * three as they were.
 */

import * as vscode from "vscode";

const UNACCOUNTED = "flagUnaccountedWords";
const MARKUP = "suggestMarkup";
const HOVER = "showTokenHover";

type Toggle = { setting: string; label: string; detail: string };

const TOGGLES: Toggle[] = [
  {
    setting: UNACCOUNTED,
    label: "Flag unaccounted words",
    detail: "Squiggle words the dictionary does not yet account for (warnings)",
  },
  {
    setting: MARKUP,
    label: "Suggest markup",
    detail:
      "Flag likely people, places, organisations, citations, and foreign " +
      "text (hints)",
  },
  {
    setting: HOVER,
    label: "Show token hovers",
    detail:
      "Show how each accounted word is filed — its lemma and forms — when " +
      "you point at it",
  },
];

export const configureDiagnostics = async (): Promise<void> => {
  const config = vscode.workspace.getConfiguration("compositor");
  const items = TOGGLES.map((toggle) => ({
    label: toggle.label,
    detail: toggle.detail,
    picked: config.get<boolean>(toggle.setting, false),
    toggle,
  }));
  const picked = await vscode.window.showQuickPick(items, {
    title: "Inline diagnostics",
    placeHolder: "Choose what to show in open editions (Esc to keep as-is)",
    canPickMany: true,
  });
  if (picked === undefined) return; // cancelled: leave all settings as they were
  const on = new Set(picked.map((item) => item.toggle.setting));
  for (const toggle of TOGGLES) {
    await config.update(
      toggle.setting,
      on.has(toggle.setting),
      vscode.ConfigurationTarget.Workspace,
    );
  }
};
