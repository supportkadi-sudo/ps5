import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e-history",
  workers: 1,
  use: { baseURL: "http://127.0.0.1:4175", screenshot: "only-on-failure" },
  webServer: {
    command: "VITE_API_MODE=http npm run dev -- --host 127.0.0.1 --port 4175",
    url: "http://127.0.0.1:4175",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
});
