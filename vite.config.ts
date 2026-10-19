import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";
import { nitro } from "nitro/vite";

// On Vercel, Nitro packages the SSR handler as a serverless function.
// Everywhere else (Docker/Railway/local) keep the plain dist/ output that
// server/server.mjs serves.
const onVercel = !!process.env.VERCEL;

export default defineConfig({
  plugins: [
    tanstackStart(),
    ...(onVercel ? [nitro({ preset: "vercel" })] : []),
    react(),
    tailwindcss(),
    tsConfigPaths(),
  ],
  resolve: {
    dedupe: ["react", "react-dom", "@tanstack/react-router", "@tanstack/react-start"],
  },
  ssr: {
    external: ["bun:sqlite"],
  },
});
