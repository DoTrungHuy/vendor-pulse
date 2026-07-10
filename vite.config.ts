import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const configuredBase = process.env.VITE_BASE_PATH?.trim();
const base = configuredBase ? `/${configuredBase.replace(/^\/+|\/+$/g, "")}/` : "/";

export default defineConfig({
  base,
  plugins: [react()],
});
