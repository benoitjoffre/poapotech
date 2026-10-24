import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@poapo/types": fileURLToPath(new URL("../poapo-types/src/index.ts", import.meta.url)) },
  },
  server: {
    port: 5174,
    proxy: {
      "/api": "http://localhost:5050",
    },
  },
});
