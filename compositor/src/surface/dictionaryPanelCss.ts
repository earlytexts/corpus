/**
 * The dictionary panel webview's stylesheet, kept apart from the panel's markup
 * and message plumbing (dictionaryPanel.ts) so neither file has ~100 lines of
 * the other's concern in the way. It is inlined into the shell under a CSP nonce
 * (see `panelHtml`), not served as a separate asset, so the strict `style-src
 * 'nonce-…'` stands and the build copies nothing extra. All colours are VSCode
 * theme variables, so the panel tracks the editor's theme.
 */

export const PANEL_CSS = `
* { box-sizing: border-box; }
body {
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size);
  color: var(--vscode-foreground);
  padding: 8px 8px 16px;
}
button {
  font-family: inherit;
  font-size: inherit;
  color: var(--vscode-button-foreground);
  background: var(--vscode-button-background);
  border: none;
  border-radius: 2px;
  padding: 3px 9px;
  cursor: pointer;
}
button:hover { background: var(--vscode-button-hoverBackground); }
button.ghost {
  color: var(--vscode-foreground);
  background: transparent;
  border: 1px solid var(--vscode-panel-border);
}
button.ghost:hover { background: var(--vscode-toolbar-hoverBackground); }
button.ghost.selected {
  color: var(--vscode-button-foreground);
  background: var(--vscode-button-background);
  border-color: transparent;
}
button:disabled { opacity: 0.4; cursor: default; }
input {
  font-family: inherit;
  font-size: inherit;
  color: var(--vscode-input-foreground);
  background: var(--vscode-input-background);
  border: 1px solid var(--vscode-input-border, transparent);
  border-radius: 2px;
  padding: 3px 6px;
}
.tabs { display: flex; gap: 4px; margin-bottom: 8px; }
.tabs button { flex: 1; }
.letters { display: flex; flex-wrap: wrap; gap: 3px; margin-bottom: 8px; }
.letters button { min-width: 24px; padding: 2px 5px; text-transform: uppercase; }
.add { display: flex; gap: 4px; margin-bottom: 8px; }
.add input { flex: 1; min-width: 0; }
.rows { display: flex; flex-direction: column; }
.row {
  padding: 6px 2px;
  border-bottom: 1px solid var(--vscode-panel-border);
}
.head { display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap; }
.surface { font-weight: 600; }
button.link {
  font-weight: 600;
  color: var(--vscode-textLink-foreground);
  background: transparent;
  border: none;
  border-radius: 0;
  padding: 0;
}
button.link:hover { background: transparent; text-decoration: underline; }
.arrow { opacity: 0.6; }
.count-tag {
  font-variant-numeric: tabular-nums;
  opacity: 0.7;
}
.curate { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
.tag {
  font-size: 0.8em;
  opacity: 0.65;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.spacer { flex: 1; }
.forms { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 5px; }
.chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  background: var(--vscode-badge-background);
  color: var(--vscode-badge-foreground);
  border-radius: 10px;
  padding: 1px 4px 1px 9px;
}
.x {
  background: transparent;
  color: inherit;
  border: none;
  border-radius: 8px;
  padding: 0 4px;
  cursor: pointer;
  line-height: 1.4;
}
.x:hover { color: var(--vscode-errorForeground); background: transparent; }
.formadd { display: flex; gap: 4px; margin-top: 5px; }
.pager {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
}
.pager .spacer { flex: 1; }
.empty, .count { opacity: 0.65; padding: 8px 2px; }
`;
