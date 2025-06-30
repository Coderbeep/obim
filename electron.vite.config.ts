import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import { resolve } from "path";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        "@/lib": resolve("src/main/lib"),
        "@shared": resolve("src/shared"),
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    assetsInclude: "src/renderer/assets/**",
    resolve: {
      alias: {
        "@renderer": resolve("src/renderer/src"),
        "@shared": resolve("src/shared"),
        "@hooks": resolve("src/renderer/src/hooks"),
        "@components": resolve("src/renderer/src/components"),
        "@extensions": resolve("src/renderer/src/extensions"),
        "@store": resolve("src/renderer/src/store"),
        "@utils": resolve("src/renderer/src/utils"),
        "@services": resolve("src/renderer/src/services"),
        "@lib": resolve("src/renderer/src/components/lib")
      },
    },
    plugins: [react()],
  },
});
