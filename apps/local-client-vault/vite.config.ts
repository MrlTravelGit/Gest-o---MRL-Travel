import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({ plugins: [react()], root: "src/web", build: { outDir: "../../dist", emptyOutDir: true }, server: { port: 7444, proxy: { "/api/": { target: "https://127.0.0.1:7443", secure: false }, "/health": { target: "https://127.0.0.1:7443", secure: false } } } });
