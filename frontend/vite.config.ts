import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { shellVersion } from "./tooling/precache";
export default defineConfig({
  plugins: [
    react(),
    {
      name: "club-app-shell",
      writeBundle(options, bundle) {
        const dir = options.dir!;
        const urls = [
          "/",
          "/manifest.webmanifest",
          "/icon.svg",
          "/icon-192.png",
          "/icon-512.png",
          ...Object.keys(bundle)
            .filter((name) => /\.(js|css)$/.test(name))
            .map((name) => "/" + name),
        ];
        const resources = urls.map((url) => ({
          url,
          content: readFileSync(
            resolve(dir, url === "/" ? "index.html" : url.slice(1)),
          ),
        }));
        const source = readFileSync(
          new URL("./src/app/service-worker.js", import.meta.url),
          "utf8",
        )
          .replace("__PRECACHE__", JSON.stringify(urls))
          .replace("__VERSION__", JSON.stringify(shellVersion(resources)));
        writeFileSync(resolve(dir, "sw.js"), source);
      },
    },
  ],
  server: { host: "0.0.0.0" },
});
