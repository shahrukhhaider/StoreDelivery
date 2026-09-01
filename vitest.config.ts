import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["src/engine/**", "src/server/**", "src/shared/**"],
    },
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
