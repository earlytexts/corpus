/**
 * The Contribute panel webview's stylesheet, kept apart from the panel's
 * plumbing (contributionPanel.ts) for the same reason the other panels split
 * theirs. It is inlined into the shell under a CSP nonce, and every colour is a
 * VSCode theme variable, so the panel reads as native furniture in any theme.
 *
 * One departure from the search panel: the buttons here are real buttons rather
 * than toolbar glyphs. Sending work to the Centre is a deliberate act, and it
 * should look like one.
 */

export const CONTRIBUTE_CSS = `
* { box-sizing: border-box; }
body {
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size);
  color: var(--vscode-foreground);
  padding: 8px 10px 16px;
}
body.busy { opacity: 0.7; }

.note { opacity: 0.8; line-height: 1.45; margin: 4px 0 10px; }
.heading:not(:empty) {
  font-weight: 600;
  margin: 10px 0 4px;
}
.error:not(:empty) {
  color: var(--vscode-inputValidation-errorForeground, var(--vscode-errorForeground));
  background: var(--vscode-inputValidation-errorBackground);
  border: 1px solid var(--vscode-inputValidation-errorBorder, var(--vscode-errorForeground));
  border-radius: 3px;
  padding: 6px 8px;
  margin-bottom: 8px;
  line-height: 1.4;
}
.warning:not(:empty) {
  background: var(--vscode-inputValidation-warningBackground);
  border: 1px solid var(--vscode-inputValidation-warningBorder, var(--vscode-editorWarning-foreground));
  border-radius: 3px;
  padding: 6px 8px;
  margin-bottom: 8px;
  line-height: 1.4;
}
.busy:not(:empty) {
  opacity: 0.85;
  font-style: italic;
  padding: 2px 0 6px;
}

/* --------------------------- the changed files --------------------------- */
.files { display: flex; flex-direction: column; }
.file {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 4px;
  border-radius: 3px;
  cursor: pointer;
  min-width: 0;
}
.file:hover { background: var(--vscode-list-hoverBackground); }
.file .label {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.mark { flex: none; width: 1em; text-align: center; opacity: 0.9; }
.mark.added { color: var(--vscode-gitDecoration-addedResourceForeground, inherit); }
.mark.modified { color: var(--vscode-gitDecoration-modifiedResourceForeground, inherit); }
.mark.deleted { color: var(--vscode-gitDecoration-deletedResourceForeground, inherit); }
.actions { display: none; flex: none; }
.file:hover .actions { display: flex; }
.actions button {
  background: transparent;
  border: none;
  color: var(--vscode-foreground);
  border-radius: 3px;
  padding: 1px 4px;
  cursor: pointer;
}
.actions button:hover { background: var(--vscode-toolbar-hoverBackground); }

/* ------------------------------- the form -------------------------------- */
.form { display: flex; flex-direction: column; gap: 8px; margin-top: 12px; }
label {
  display: flex;
  flex-direction: column;
  gap: 3px;
  font-size: 0.9em;
  opacity: 0.9;
}
input, textarea {
  font-family: inherit;
  font-size: var(--vscode-font-size);
  color: var(--vscode-input-foreground);
  background: var(--vscode-input-background);
  border: 1px solid var(--vscode-input-border, transparent);
  border-radius: 2px;
  padding: 4px 6px;
  width: 100%;
  min-width: 0;
  resize: vertical;
}
input:focus, textarea:focus {
  outline: 1px solid var(--vscode-focusBorder);
  outline-offset: -1px;
}
input::placeholder, textarea::placeholder { opacity: 0.6; }

/* ------------------------------- the buttons ------------------------------ */
button.primary, button.secondary {
  font-family: inherit;
  font-size: var(--vscode-font-size);
  border: 1px solid transparent;
  border-radius: 2px;
  padding: 5px 12px;
  cursor: pointer;
  width: 100%;
}
button.primary {
  color: var(--vscode-button-foreground);
  background: var(--vscode-button-background);
}
button.primary:hover:not(:disabled) { background: var(--vscode-button-hoverBackground); }
button.secondary {
  color: var(--vscode-button-secondaryForeground);
  background: var(--vscode-button-secondaryBackground);
  margin-top: 8px;
}
button.secondary:hover:not(:disabled) { background: var(--vscode-button-secondaryHoverBackground); }
button.primary:disabled, button.secondary:disabled { opacity: 0.4; cursor: default; }
button.link {
  font-family: inherit;
  font-size: inherit;
  color: var(--vscode-textLink-foreground);
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  text-align: left;
}
button.link:hover { color: var(--vscode-textLink-activeForeground); text-decoration: underline; }

/* ---------------------------- the submission ----------------------------- */
.card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  background: var(--vscode-editorWidget-background, transparent);
  border: 1px solid var(--vscode-widget-border, var(--vscode-editorWidget-border, transparent));
  border-radius: 4px;
  padding: 8px 10px;
  margin-bottom: 8px;
}
.card-title { font-weight: 600; line-height: 1.35; }
.card-status { opacity: 0.75; font-size: 0.9em; }
`;
