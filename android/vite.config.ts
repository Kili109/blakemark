import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  base: "/",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      {
        find: "@/lib/market/board.functions",
        replacement: fileURLToPath(new URL("./client-board.ts", import.meta.url)),
      },
      {
        find: "@",
        replacement: fileURLToPath(new URL("../src", import.meta.url)),
      },
    ],
  },
  build: {
    outDir: fileURLToPath(new URL("./www", import.meta.url)),
    emptyOutDir: true,
    assetsDir: "assets",
    chunkSizeWarningLimit: 2000,
  },
});
