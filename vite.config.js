import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "fs";
import os from "os";
export default defineConfig(({ mode }) => {
  const isHttps = mode === "https";
  return {
    plugins: [react()],
    server: isHttps
      ? {
          host: "0.0.0.0",
          port: 5174,
          strictPort: true,
          allowedHosts: ["dev.entr.co.il"],
          https: {
            cert: fs.readFileSync(`${os.homedir()}/certs/dev.entr.co.il.pem`),
            key: fs.readFileSync(`${os.homedir()}/certs/dev.entr.co.il-key.pem`),
          },
        }
      : {
          host: "localhost",
          port: 5173,
        },
  };
});