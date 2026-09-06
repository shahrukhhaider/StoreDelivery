import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  root: "src/web",
  plugins: [react()],
  build: {
    outDir: path.resolve(__dirname, "dist/web"),
    emptyOutDir: true,
  },
  resolve: {
    extensions: [".ts", ".tsx", ".js", ".jsx", ".json"],
    alias: {
      "@server": path.resolve(__dirname, "src/server"),
      "@engine": path.resolve(__dirname, "src/engine"),
      "@shared": path.resolve(__dirname, "src/shared"),
      "@web": path.resolve(__dirname, "src/web"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
      "/auth": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
      "/billing": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
      "/webhooks": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
      "/internal": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
});
