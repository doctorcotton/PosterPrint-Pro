import path from "path";
import { fileURLToPath } from "url";
import { defineConfig } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  base: "./",
  root: ".",
  build: {
    outDir: "dist",
    rollupOptions: {
      input: path.resolve(__dirname, "crop.html"),
      output: {
        inlineDynamicImports: true,
      },
    },
  },
  server: {
    port: 5173,
    open: "/crop.html",
    proxy: {
      "/export_prepare": {
        target: "http://127.0.0.1:5000",
        changeOrigin: true,
      },
      "/tile_export_prepare": {
        target: "http://127.0.0.1:5000",
        changeOrigin: true,
      },
      "/download": {
        target: "http://127.0.0.1:5000",
        changeOrigin: true,
      },
    },
  },
});
