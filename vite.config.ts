import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  publicDir: "build",
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "auto",
      includeAssets: [
        "icon.ico",
        "icon.png",
        "icons/icon-16x16.png",
        "icons/icon-32x32.png",
        "icons/apple-touch-icon-180x180.png",
        "icons/icon-192x192.png",
        "icons/icon-512x512.png",
        "icons/icon-maskable-512x512.png",
      ],
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "google-fonts-cache",
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      manifest: {
        name: "JoyaControl Pro - Sistema de Joyería",
        short_name: "JoyaControl",
        description: "Sistema de gestión integral para joyerías. Inventario, ventas, compras y reportes. 100% local.",
        theme_color: "#e5a40a",
        background_color: "#111318",
        display: "standalone",
        orientation: "any",
        scope: "/",
        start_url: "/",
        lang: "es",
        categories: ["business", "finance"],
        icons: [
          { src: "/icons/icon-192x192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/icons/icon-512x512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "/icons/icon-maskable-512x512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ["react", "react-dom", "react-router-dom"],
          ui: ["@radix-ui/react-dialog", "@radix-ui/react-select", "@radix-ui/react-toast"],
          db: ["dexie"],
          charts: ["recharts"],
        },
      },
    },
  },
});
