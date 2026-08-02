import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const here = path.dirname(fileURLToPath(import.meta.url));
// The whole mechanism of ADR-001 decision 7: upstream slices are imported in
// place, resolving exactly as they do inside the desktop app. Never copy or
// move the files this points at.
const desktopSrc = path.resolve(here, "../../desktop/src");

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": desktopSrc,
    },
    // Belt-and-braces on top of exact version pinning: even if resolution ever
    // walks to two node_modules, collapse react to one copy. Two React
    // instances make every hook in a mounted upstream component throw.
    dedupe: ["react", "react-dom"],
  },
  server: { port: 5273 },
});
