import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  workers: 1,
  use: { baseURL: "http://127.0.0.1:3101", trace: "on-first-retry" },
  webServer: {
    command: "pnpm dev --port 3101",
    url: "http://127.0.0.1:3101",
    reuseExistingServer: false,
    env: {
      DATABASE_URL: "data/e2e/telmi.db",
      DATA_DIR: "data/e2e",
      APP_ENCRYPTION_KEY:
        "1111111111111111111111111111111111111111111111111111111111111111",
      COOKIE_SECURE: "false",
    },
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["iPhone 13"] } },
  ],
});
