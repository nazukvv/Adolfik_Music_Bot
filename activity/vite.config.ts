import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Бекенд Activity живе в процесі бота (aiohttp, WEB_PORT у .env, за замовчуванням 8080).
// У `npm run dev` Vite проксує на нього /api і WebSocket /api/ws.
const backend = `http://127.0.0.1:${process.env.WEB_PORT ?? "8080"}`;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": { target: backend, ws: true },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    chunkSizeWarningLimit: 900,
  },
});
