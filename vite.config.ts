import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@lib": path.resolve(__dirname, "lib"),
      "@renderer": path.resolve(__dirname, "src/renderer/src"),
      "@shared": path.resolve(__dirname, "src/shared"),
      "@": path.resolve(__dirname, "src/renderer/src"),
      "@extensions": path.resolve(__dirname, "src/renderer/src/cm-extensions"),
      "@store": path.resolve(__dirname, "src/renderer/src/store"),
      "@components": path.resolve(__dirname, "src/renderer/src/components"),
      "@hooks": path.resolve(__dirname, "src/renderer/src/hooks"),
      "@utils": path.resolve(__dirname, "lib/utils"),
      "@services": path.resolve(__dirname, "src/renderer/src/services"),
    },
  },
  css: {
    preprocessorOptions: {
      scss: {
        api: "modern-compiler", // or "modern"
      },
    },
  },
});
