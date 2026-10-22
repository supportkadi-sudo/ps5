import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
export default defineConfig({
  plugins: [
    react(),
    {
      name: "club-app-shell",
      generateBundle(_options, bundle) {
        const assets = Object.keys(bundle).filter(
          (name) => name.endsWith(".js") || name.endsWith(".css"),
        );
        const version = createHash("sha256")
          .update(assets.join(","))
          .digest("hex")
          .slice(0, 12);
        const source = readFileSync(
          new URL("./src/app/service-worker.js", import.meta.url),
          "utf8",
        )
          .replace(
            "__PRECACHE__",
            JSON.stringify([
              "/",
              "/icon.svg",
              "/icon-192.png",
              "/icon-512.png",
              "/manifest.webmanifest",
              ...assets.map((x) => "/" + x),
            ]),
          )
          .replace("__VERSION__", JSON.stringify(version));
        this.emitFile({ type: "asset", fileName: "sw.js", source });
      },
    },
  ],
  server: { host: "0.0.0.0" },
});
