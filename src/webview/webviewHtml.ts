/**
 * HTML shell for the Commit Composer webviews.
 *
 * Shared by the editor tab and the sidebar so the CSP, nonce handling and
 * bundle URLs can never drift apart.
 */

import * as vscode from "vscode";

/** Generate a random nonce for the webview CSP. */
function createNonce(): string {
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let text = "";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

/**
 * Build the webview HTML that loads the bundled React app.
 *
 * @param webview The webview instance (used to resolve local resource URIs).
 * @param extensionUri Extension root URI.
 * @param options Set `sidebar` to render the compact sidebar layout.
 */
export function buildWebviewHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  options?: { sidebar?: boolean }
): string {
  const assets = ["webview", "dist", "assets"];
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, ...assets, "index.js"));
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, ...assets, "index.css"));
  const nonce = createNonce();
  const rootClass = options?.sidebar ? "sidebar-view" : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy"
          content="default-src 'none';
                   img-src ${webview.cspSource} https: data:;
                   style-src ${webview.cspSource} 'unsafe-inline';
                   script-src 'nonce-${nonce}';
                   font-src ${webview.cspSource};">
    <link rel="stylesheet" href="${styleUri}">
    <title>Commit Composer</title>
</head>
<body>
    <div id="root" class="${rootClass}"></div>
    <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}
