import { defineConfig } from "vite";

export default defineConfig({
  // Relative base so the built dist/ loads over file:// inside Electron.
  base: "./",
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/ws": {
        target: "ws://localhost:3000",
        ws: true,
      },
    },
  },
});
