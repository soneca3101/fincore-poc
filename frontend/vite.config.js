import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(() => {
  const configuredBase = process.env.VITE_BASE_PATH || "";
  const base = configuredBase
    ? configuredBase.replace(/\/?$/, "/")
    : "/";

  return {
    base,
    plugins: [react()],
    server: {
      host: "127.0.0.1",
      port: 5173,
      strictPort: true,
      proxy: {
        "/api": "http://127.0.0.1:8000",
      },
    },
  };
});
