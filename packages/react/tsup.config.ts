import { defineConfig } from "tsup";
import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  external: ["react", "react-dom"],
  onSuccess: async () => {
    // Copy VS Code theme CSS
    const themeCss = readFileSync(join(__dirname, "src/theme/vscode-theme.css"), "utf-8");
    writeFileSync(join(__dirname, "dist/vscode-theme.css"), themeCss);

    // Create combined styles.css that includes assistant-ui base styles + theme
    const assistantUiStylesPath = require.resolve("@assistant-ui/react/styles/index.css");
    const assistantUiCss = readFileSync(assistantUiStylesPath, "utf-8");
    const combinedCss = `/* assistant-ui base styles */\n${assistantUiCss}\n\n/* vscode-ai-chat theme */\n${themeCss}\n`;
    writeFileSync(join(__dirname, "dist/styles.css"), combinedCss);
  },
});
