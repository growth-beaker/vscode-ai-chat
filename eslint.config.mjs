import js from "@eslint/js";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";

export default [
  js.configs.recommended,
  {
    files: ["packages/*/src/**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
      globals: {
        console: "readonly",
        window: "readonly",
        document: "readonly",
        MessageEvent: "readonly",
        crypto: "readonly",
        AbortController: "readonly",
        AbortSignal: "readonly",
        Promise: "readonly",
        Set: "readonly",
        Array: "readonly",
        Record: "readonly",
        Date: "readonly",
        Error: "readonly",
        TextDecoder: "readonly",
        require: "readonly",
        process: "readonly",
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
    },
    rules: {
      // Use TypeScript-aware no-unused-vars instead of base rule
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // Allow TypeScript-handled redeclarations
      "no-redeclare": "off",
      // Prefer const
      "prefer-const": "error",
      // No console in library code (warn only)
      "no-console": "warn",
      // No eval
      "no-eval": "error",
    },
  },
  {
    // Test files — relaxed rules
    files: ["packages/*/src/**/__tests__/**/*.{ts,tsx}"],
    rules: {
      "no-console": "off",
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
  {
    ignores: ["**/dist/**", "**/node_modules/**", "examples/**"],
  },
];
