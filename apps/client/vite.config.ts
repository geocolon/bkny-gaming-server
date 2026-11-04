import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const src = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  // GitHub Pages serves the demo from /<repo>/ instead of the site root.
  base: process.env.BASE_PATH ?? "/",
  resolve: {
    alias: {
      "@bkny/sim": src("../../packages/sim/src/index.ts"),
      "@bkny/netcode": src("../../packages/netcode/src/index.ts"),
    },
  },
  server: { port: 5173 },
});
