import * as crypto from "node:crypto";

/** Webview URI resolver — matches vscode.Webview.asWebviewUri signature */
export interface WebviewUriResolver {
  asWebviewUri(uri: { fsPath: string }): { toString(): string };
  cspSource: string;
}

/** Generate a cryptographic nonce for CSP */
export function generateNonce(): string {
  return crypto.randomBytes(16).toString("base64");
}

export interface HtmlOptions {
  nonce: string;
  scriptUri: string;
  styleUri: string;
  cspSource: string;
  customCss?: string;
}

/** Generate the webview HTML shell with strict CSP */
export function generateHtml(options: HtmlOptions): string {
  const { nonce, scriptUri, styleUri, cspSource, customCss } = options;

  const customStyleTag = customCss ? `<style nonce="${nonce}">${customCss}</style>` : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src ${cspSource} 'nonce-${nonce}'; font-src ${cspSource}; img-src ${cspSource} data: https:;">
  <link rel="stylesheet" href="${styleUri}">
  ${customStyleTag}
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}
