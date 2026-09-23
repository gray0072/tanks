import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
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
