import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/

/**
 * Vite configuration for the React frontend.
 *
 * This file controls how the local development server and production build are
 * configured. In development, API requests under /api are proxied to the local
 * backend so the browser can talk to Express without running into cross-origin
 * issues.
 *
 * @returns {import("vite").UserConfig}
 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3001,
    proxy: {
      /**
       * Proxy rule for backend API requests during local development.
       *
       * Requests such as /api/courses are forwarded to the backend server while
       * preserving the same frontend-facing path.
       */
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
});
