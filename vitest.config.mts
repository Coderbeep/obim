import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@renderer": resolve("src/renderer/src"),
      "@shared": resolve("src/shared"),
    },
  },
  test: {
    environment: "node",
    environmentOptions: {
      jsdom: { url: "http://localhost/" },
    },
    setupFiles: ["tests/setup.ts"],
    projects: [
      {
        extends: true,
        test: { name: "node", environment: "node", include: ["tests/**/*.test.{ts,tsx}"] },
      },
      {
        extends: true,
        test: { name: "renderer", environment: "jsdom", include: ["tests/**/*.vitest.{ts,tsx}"] },
      },
    ],
    server: {
      deps: {
        inline: ["@pierre/icons", "codemirror-markdown-tables", "@mobily/ts-belt"],
      },
    },
    clearMocks: true,
    coverage: {
      provider: "v8",
      include: [
        "src/renderer/src/features/editor/extensions/**/*.{ts,tsx}",
        "src/renderer/src/features/files/explorer/**/*.{ts,tsx}",
      ],
      reporter: ["text", "json-summary", "html"],
      reportsDirectory: "coverage/renderer",
      thresholds: {
        branches: 95,
        functions: 95,
        lines: 98,
        statements: 98,
      },
    },
  },
});
