/**
 * The shared webview shell for the docked panels (dictionary, search): a strict
 * CSP (nonce for the one script and the one inline stylesheet, nothing else),
 * the panel's styles, and its bundled front-end from dist/.
 */

import * as vscode from "vscode";

export const panelHtml = (
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  css: string,
  scriptFile: string,
): string => {
  const nonce = makeNonce();
  const script = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "dist", scriptFile),
  );
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';"
    />
    <style nonce="${nonce}">${css}</style>
  </head>
  <body>
    <script nonce="${nonce}" src="${script}"></script>
  </body>
</html>`;
};

/** A random script/style nonce (the extension host has global crypto only from
 * node 20, so a plain random string keeps the engines floor at 1.85). */
const makeNonce = (): string => {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let text = "";
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
};
