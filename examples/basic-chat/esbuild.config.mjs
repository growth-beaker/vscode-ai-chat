import * as esbuild from "esbuild";

const isWatch = process.argv.includes("--watch");

// Shared options
const shared = {
  bundle: true,
  sourcemap: true,
  minify: !isWatch,
  logLevel: "info",
};

// Build 1: Extension host (Node.js, CJS for VS Code)
const extensionBuild = esbuild.build({
  ...shared,
  entryPoints: ["src/extension.ts"],
  outfile: "dist/extension.js",
  format: "cjs",
  platform: "node",
  external: ["vscode"],
});

// Build 2: Webview (Browser, IIFE for injection)
// CSS imports from JS (assistant-ui styles) get bundled into dist/webview.css automatically
const webviewBuild = esbuild.build({
  ...shared,
  entryPoints: ["src/webview/index.tsx"],
  outfile: "dist/webview.js",
  format: "iife",
  platform: "browser",
  define: {
    "process.env.NODE_ENV": '"production"',
  },
});

// Build 3: VS Code theme CSS (appended to the webview CSS)
const cssBuild = esbuild.build({
  ...shared,
  entryPoints: ["src/webview/styles.css"],
  outfile: "dist/vscode-theme.css",
  minify: !isWatch,
});

await Promise.all([extensionBuild, webviewBuild, cssBuild]);

// Merge the assistant-ui CSS (from webview.js build) and the VS Code theme CSS
import { readFileSync, writeFileSync, existsSync } from "fs";
const auiCss = existsSync("dist/webview.css") ? readFileSync("dist/webview.css", "utf-8") : "";
const themeCss = readFileSync("dist/vscode-theme.css", "utf-8");
writeFileSync("dist/webview.css", auiCss + "\n" + themeCss);
