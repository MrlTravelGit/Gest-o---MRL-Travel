import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({ plugins: [react()], root: "src/web", publicDir: "../../../../public", build: { outDir: "../../dist", emptyOutDir: true }, server: { port: 7444, proxy: { "/api/": { target: "http://127.0.0.1:7443" }, "/health": { target: "http://127.0.0.1:7443" } } } });
