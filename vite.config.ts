import { defineConfig } from "vite";
import path from "path";

export default defineConfig({
  root: "src/web",
  build: {
    outDir: path.resolve(__dirname, "dist/web"),
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      "@server": path.resolve(__dirname, "src/server"),
      "@engine": path.resolve(__dirname, "src/engine"),
      "@shared": path.resolve(__dirname, "src/shared"),
      "@web": path.resolve(__dirname, "src/web"),
    },
  },
});
