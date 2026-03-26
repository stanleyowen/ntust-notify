import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
/**
 * Vite development and build configuration for the React frontend.
 *
 * In local development, /api requests are proxied to the backend server so the
 * frontend can call the Express API without browser CORS issues.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3001,
    proxy: {
      /**
       * Proxy API calls to the local backend during development.
       */
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
});
