import { sites } from "@openai/sites-vite-plugin";
import { defineConfig } from "vite";

export default defineConfig(({ isSsrBuild }) => ({
  plugins: [sites()],
  // Captured application HTML is evidence, not a frontend source or dependency entry.
  server: { watch: { ignored: ['**/.reprocheck/**', '**/.venv/**', '**/__pycache__/**'] } },
  optimizeDeps: { entries: ['index.html'] },
  build: isSsrBuild
    ? { rollupOptions: { output: { entryFileNames: "index.js" } } }
    : undefined,
}));
