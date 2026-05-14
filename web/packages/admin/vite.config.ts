import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  base: "/admin-dashboard/",
  plugins: [react()],
  build: {
    assetsDir: ".",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 3100,
    proxy: {
      "/admin-dashboard/api": {
        target: "http://localhost:7350",
        changeOrigin: true,
        secure: false,
        configure: (proxy) => {
          proxy.on('proxyRes', (proxyRes) => {
            proxyRes.headers['Access-Control-Allow-Origin'] = '*';
            proxyRes.headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS';
            proxyRes.headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization';
          });
        },
        rewrite: (path) => {
          // Special case: /admin-dashboard/api/login -> /v2/rpc/admin_login
          if (path === "/admin-dashboard/api/login") {
            return "/v2/rpc/admin_login?http_key=defaulthttpkey&unwrap=true";
          }
          // /admin-dashboard/api/rpc/xxx -> /v2/rpc/xxx?http_key=defaulthttpkey&unwrap=true
          const rpcMatch = path.match(/^\/admin-dashboard\/api\/(rpc\/)?(.+)$/);
          if (rpcMatch) {
            const rpcId = rpcMatch[2];
            return `/v2/rpc/${rpcId}?http_key=defaulthttpkey&unwrap=true`;
          }
          return path;
        },
      },
    },
  },
});
