import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

// base "./" keeps asset URLs relative so the build works under any reverse-proxy
// prefix (/fpk alias or BASE_PATH) without rebuilding.
export default defineConfig({
  base: "./",
  plugins: [vue()],
  server: {
    host: "0.0.0.0",
  },
  build: {
    outDir: "dist/public",
    emptyOutDir: true,
  },
});
