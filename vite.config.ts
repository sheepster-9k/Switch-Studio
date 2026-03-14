import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  root: "src/web",
  base: "./",
  build: {
    outDir: "../../dist/web",
    emptyOutDir: true
  },
  server: {
    host: "0.0.0.0",
    port: 5175,
    proxy: {
      "/api": "http://localhost:8878"
    }
  }
});
