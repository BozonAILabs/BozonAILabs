import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  use: { baseURL: "http://127.0.0.1:5175", headless: true },
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 5175",
    url: "http://127.0.0.1:5175",
    reuseExistingServer: false,
    env: {
      VITE_SUPABASE_URL: "http://127.0.0.1:56321",
      VITE_SUPABASE_PUBLISHABLE_KEY: "test-public-key",
      VITE_CONVERTER_ENABLED: "true",
    },
  },
  reporter: "list",
});
