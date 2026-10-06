import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import { readFileSync, readdirSync } from "fs";
import { extname, join, resolve } from "path";
import type { Plugin, BuildOptions } from "vite";

const PDF_ASSET_DIRECTORIES = ["cmaps", "standard_fonts", "iccs", "wasm"] as const;
const PDF_ASSET_PREFIX = "/pdfjs-assets/";
const PDF_ASSET_ROOT = resolve("node_modules/pdfjs-dist");

export const pdfAssetsPlugins = (): Plugin[] => [
  {
    name: "obim-pdfjs-assets-serve",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(PDF_ASSET_PREFIX, (request, response, next) => {
        const relativePath = decodeURIComponent(request.url ?? "").replace(/^\/+/, "");
        const [directory, ...filenameParts] = relativePath.split("/");
        if (!PDF_ASSET_DIRECTORIES.includes(directory as (typeof PDF_ASSET_DIRECTORIES)[number])) return next();
        const filename = filenameParts.join("/");
        if (!filename || filename.includes("..")) return next();
        try {
          const content = readFileSync(join(PDF_ASSET_ROOT, directory, filename));
          response.statusCode = 200;
          response.setHeader(
            "Content-Type",
            extname(filename) === ".wasm" ? "application/wasm" : "application/octet-stream",
          );
          response.end(content);
        } catch {
          next();
        }
      });
    },
  },
  {
    name: "obim-pdfjs-assets-build",
    apply: "build",
    buildStart() {
      for (const directory of PDF_ASSET_DIRECTORIES) {
        for (const filename of readdirSync(join(PDF_ASSET_ROOT, directory))) {
          this.emitFile({
            type: "asset",
            fileName: `pdfjs-assets/${directory}/${filename}`,
            source: readFileSync(join(PDF_ASSET_ROOT, directory, filename)),
          });
        }
      }
    },
  },
];

const mainBuildOptions: BuildOptions & { externalizeDeps: boolean } = {
  externalizeDeps: true,
  rollupOptions: {
    input: {
      index: resolve("src/main/index.ts"),
    },
  },
};

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: mainBuildOptions,
    resolve: {
      alias: {
        "@shared": resolve("src/shared"),
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        "@shared": resolve("src/shared"),
      },
    },
  },
  renderer: {
    cacheDir: resolve("node_modules/.vite-obim-renderer"),
    optimizeDeps: {
      exclude: ["codemirror-markdown-tables"],
    },
    server: {
      watch: {
        usePolling: true,
        ignored: ["**/dist/**", "**/out/**"],
      },
    },
    resolve: {
      alias: {
        "@renderer": resolve("src/renderer/src"),
        "@shared": resolve("src/shared"),
      },
    },
    plugins: [
      react(),
      ...pdfAssetsPlugins(),
      {
        name: "obim-development-csp",
        apply: "serve",
        transformIndexHtml(html) {
          // Vite refresh and its WebSocket are development-only; packaged HTML stays restrictive.
          return html
            .replace("script-src 'self' 'wasm-unsafe-eval'", "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'")
            .replace(
              "connect-src 'self' media: blob:",
              "connect-src 'self' media: blob: ws://localhost:* ws://127.0.0.1:*",
            );
        },
      },
    ],
  },
});
