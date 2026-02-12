import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true,
      },
    },
  },
  preview: {
    port: 4173,
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/three")) return "three-core";
          if (id.includes("node_modules/zod")) return "schema";
          if (id.includes("node_modules")) return "vendor";
          return undefined;
        },
      },
    },
  },
});
