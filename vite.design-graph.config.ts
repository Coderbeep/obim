import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  cacheDir: resolve("node_modules/.vite-design-graph"),
  root: resolve("src/renderer/src/design-graph"),
  plugins: [react()],
  resolve: {
    alias: {
      "@renderer": resolve("src/renderer/src"),
      "@shared": resolve("src/shared"),
    },
  },
  server: {
    host: "0.0.0.0",
    watch: {
      ignored: ["**/dist/**", "**/out/**"],
      usePolling: true,
    },
  },
});
