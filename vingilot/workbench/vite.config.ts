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
  server: {
    port: 5273,
    proxy: {
      // The coordinator bearer token lives only here, in the dev-server
      // process's environment — it is never sent to or held by the browser.
      // The browser only ever talks to same-origin "/coord/...".
      "/coord": {
        target: process.env.COORD_URL ?? "http://127.0.0.1:7117",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/coord/, ""),
        headers: { Authorization: `Bearer ${process.env.COORD_AUTH_TOKEN ?? "vingilot-dev-token"}` },
      },
    },
  },
});
