import { defineConfig } from "vite";

export default defineConfig({
  // GitHub Pages serves this repo from https://gray0072.github.io/tanks/
  base: "/tanks/",
  build: {
    target: "es2020",
    sourcemap: true,
  },
  server: {
    port: 5173,
  },
});
