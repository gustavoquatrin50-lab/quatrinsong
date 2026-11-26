import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// @ts-expect-error The build helper is also run by scripts/start.sh.
import { buildInfo } from "./scripts/build-info.mjs";

const info = buildInfo();

export default defineConfig({
  base: "./",
  plugins: [
    react(),
    {
      name: "riffsync-version",
      generateBundle() {
        this.emitFile({
          type: "asset",
          fileName: "version.json",
          source: JSON.stringify(info),
        });
      },
    },
  ],
  define: {
    __APP_VERSION__: JSON.stringify(info.version),
    __APP_REVISION__: JSON.stringify(info.revision),
  },
  server: {
    host: "0.0.0.0",
    port: Number(process.env.PORT || 5173),
    allowedHosts: true,
    proxy: { "/api": "http://127.0.0.1:8000" },
  },
  build: { chunkSizeWarningLimit: 1600 },
});
