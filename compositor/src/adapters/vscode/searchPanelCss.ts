/**
 * The search panel webview's stylesheet, kept apart from the panel's plumbing
 * (searchPanel.ts) for the same reason the dictionary panel splits its own. It
 * is inlined into the shell under a CSP nonce, and every colour is a VSCode
 * theme variable, so the panel reads as native search furniture in any theme.
 */

export const SEARCH_CSS = `
* { box-sizing: border-box; }
body {
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size);
  color: var(--vscode-foreground);
  padding: 6px 8px 16px;
}
input {
  font-family: inherit;
  font-size: inherit;
  color: var(--vscode-input-foreground);
  background: var(--vscode-input-background);
  border: 1px solid var(--vscode-input-border, transparent);
  border-radius: 2px;
  padding: 3px 6px;
  width: 100%;
  min-width: 0;
}
input:focus {
  outline: 1px solid var(--vscode-focusBorder);
  outline-offset: -1px;
}
input.error {
  border-color: var(--vscode-inputValidation-errorBorder, var(--vscode-errorForeground));
}
button {
  font-family: inherit;
  font-size: inherit;
  color: var(--vscode-foreground);
  background: transparent;
  border: none;
  border-radius: 3px;
  padding: 2px 4px;
  cursor: pointer;
}
button:hover { background: var(--vscode-toolbar-hoverBackground); }
button:disabled { opacity: 0.4; cursor: default; }

/* ------------ the query area: twisty gutter + stacked inputs ------------ */
.query { display: flex; gap: 2px; margin-bottom: 4px; }
.gutter { display: flex; align-items: center; }
.gutter button { padding: 0 2px; align-self: stretch; }
.fields { flex: 1; display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.termrow { position: relative; display: flex; }
.termrow input { padding-right: 78px; }
.toggles {
  position: absolute;
  right: 3px;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  gap: 1px;
}
.toggles button {
  font-family: var(--vscode-editor-font-family, monospace);
  font-size: 0.9em;
  padding: 1px 4px;
}
.toggles button.on {
  background: var(--vscode-inputOption-activeBackground);
  color: var(--vscode-inputOption-activeForeground);
  outline: 1px solid var(--vscode-inputOption-activeBorder, transparent);
}
.replacerow { display: flex; gap: 2px; align-items: center; }
.replacerow input { flex: 1; }

/* ----------------------------- author filters ---------------------------- */
.filterbar { display: flex; justify-content: flex-end; margin: 2px 0; }
.filters { display: flex; flex-direction: column; gap: 4px; margin: 2px 0 6px; }
.filters label {
  font-size: 0.85em;
  opacity: 0.8;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.regex-error { color: var(--vscode-errorForeground); padding: 2px 0 4px; }
.summary { opacity: 0.75; padding: 4px 0 6px; }

/* -------------------------------- results -------------------------------- */
.results { display: flex; flex-direction: column; }
.filehead {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 0;
  cursor: pointer;
  border-radius: 3px;
  min-width: 0;
}
.filehead:hover { background: var(--vscode-list-hoverBackground); }
.filehead .label {
  flex: 1;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.badge {
  background: var(--vscode-badge-background);
  color: var(--vscode-badge-foreground);
  border-radius: 10px;
  padding: 0 6px;
  font-size: 0.85em;
}
.twisty { width: 16px; text-align: center; opacity: 0.8; flex: none; }
.match {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 1px 0 1px 18px;
  cursor: pointer;
  border-radius: 3px;
  min-width: 0;
}
.match:hover { background: var(--vscode-list-hoverBackground); }
.match .preview {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}
.match .hl {
  background: var(--vscode-editor-findMatchHighlightBackground);
  border-radius: 2px;
}
.actions { display: none; flex: none; }
.match:hover .actions, .filehead:hover .actions { display: flex; }
.empty { opacity: 0.65; padding: 8px 2px; }
`;
