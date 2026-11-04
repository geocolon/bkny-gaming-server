import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const src = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@bkny/sim": src("../../packages/sim/src/index.ts"),
      "@bkny/netcode": src("../../packages/netcode/src/index.ts"),
    },
  },
  server: { port: 5173 },
});
