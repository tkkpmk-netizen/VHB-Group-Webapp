import { defineConfig, devices } from "@playwright/test";

const apiURL = "http://127.0.0.1:8100";
const webURL = "http://127.0.0.1:3100";

export default defineConfig({
  testDir: "./e2e",
  outputDir: "test-results",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI
    ? [["line"], ["html", { open: "never" }]]
    : [["list"]],
  use: {
    baseURL: webURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "commercial-chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
    {
      command:
        "DATABASE_URL=postgresql+asyncpg://vhb:vhb@localhost:5432/vhb_test REDIS_URL=redis://localhost:6379/15 ENVIRONMENT=test CORS_ORIGINS=http://127.0.0.1:3100 uv run uvicorn app.main:app --host 127.0.0.1 --port 8100",
      cwd: "../backend",
      url: `${apiURL}/health/ready`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command:
        "NEXT_PUBLIC_API_URL=http://127.0.0.1:8100 pnpm build && NEXT_PUBLIC_API_URL=http://127.0.0.1:8100 pnpm start --hostname 127.0.0.1 --port 3100",
      cwd: ".",
      url: `${webURL}/login`,
      reuseExistingServer: !process.env.CI,
      timeout: 300_000,
    },
  ],
});
