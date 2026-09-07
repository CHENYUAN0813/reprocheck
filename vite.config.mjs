import { sites } from "@openai/sites-vite-plugin";
import { defineConfig } from "vite";

export default defineConfig(({ isSsrBuild }) => ({
  plugins: [sites()],
  build: isSsrBuild
    ? { rollupOptions: { output: { entryFileNames: "index.js" } } }
    : undefined,
}));
