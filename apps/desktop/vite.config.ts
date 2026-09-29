import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const here = dirname(fileURLToPath(import.meta.url));
const nm = resolve(here, "node_modules");

export default defineConfig({
  root: resolve(here, "..", "..", "UI"),
  plugins: [react()],
  clearScreen: false,
  resolve: {
    alias: [
      { find: /^react$/, replacement: resolve(nm, "react") },
      { find: /^react\/jsx-runtime$/, replacement: resolve(nm, "react", "jsx-runtime.js") },
      { find: /^react\/jsx-dev-runtime$/, replacement: resolve(nm, "react", "jsx-dev-runtime.js") },
      { find: /^react-dom$/, replacement: resolve(nm, "react-dom") },
      { find: /^react-dom\/client$/, replacement: resolve(nm, "react-dom", "client.js") },
      { find: /^@tauri-apps\/api$/, replacement: resolve(nm, "@tauri-apps", "api") },
      { find: /^@tauri-apps\/api\/core$/, replacement: resolve(nm, "@tauri-apps", "api", "core.js") },
    ],
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    target: "chrome110",
    outDir: resolve(here, "dist"),
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      external: ["@tauri-apps/api/core", "@tauri-apps/api"],
    },
  },
});