/**
 * The one command that toggles the two inline overlays — the dictionary
 * accounting squiggles (warnings on unaccounted words) and the markup
 * suggestions (hints on likely people, places, organisations, citations, and
 * foreign text). Each overlay is driven by its own boolean setting and reacts
 * to it on its own (commands/dictionaryDiagnostics.ts,
 * commands/suggestMarkup.ts); this command only presents the two as tick boxes
 * and writes the chosen state back, so a contributor turns them on and off from
 * one place. Esc leaves both as they were.
 */

import * as vscode from "vscode";

const UNACCOUNTED = "flagUnaccountedWords";
const MARKUP = "suggestMarkup";

type Overlay = { setting: string; label: string; detail: string };

const OVERLAYS: Overlay[] = [
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
];

export const configureDiagnostics = async (): Promise<void> => {
  const config = vscode.workspace.getConfiguration("compositor");
  const items = OVERLAYS.map((overlay) => ({
    label: overlay.label,
    detail: overlay.detail,
    picked: config.get<boolean>(overlay.setting, false),
    overlay,
  }));
  const picked = await vscode.window.showQuickPick(items, {
    title: "Inline diagnostics",
    placeHolder: "Choose what to squiggle in open editions (Esc to keep as-is)",
    canPickMany: true,
  });
  if (picked === undefined) return; // cancelled: leave both settings as they were
  const on = new Set(picked.map((item) => item.overlay.setting));
  for (const overlay of OVERLAYS) {
    await config.update(
      overlay.setting,
      on.has(overlay.setting),
      vscode.ConfigurationTarget.Workspace,
    );
  }
};
