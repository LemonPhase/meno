import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    // The server interface is exercised in-process; the scripted model and
    // the Firestore emulator (via `npm test`) make every flow deterministic.
    env: {
      MENO_MODEL: "scripted",
      GCP_PROJECT_ID: "meno-test",
    },
    include: ["tests/**/*.test.ts"],
    testTimeout: 15000,
    // All tests share the emulator's single demo-user Graph; parallel test
    // files would clobber each other's state.
    fileParallelism: false,
  },
});
