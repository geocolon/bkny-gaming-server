import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const src = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@bkny/sim": src("./packages/sim/src/index.ts"),
      "@bkny/netcode": src("./packages/netcode/src/index.ts"),
    },
  },
  test: { include: ["packages/**/test/*.test.ts", "apps/**/test/*.test.ts"] },
});
