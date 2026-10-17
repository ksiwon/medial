import { defineConfig } from '@playwright/test';

// A real browser against the real server. The mount tests (vitest + jsdom) prove a screen does not throw and keeps
// its rules; they cannot see layout, and they cannot see the server and the screens disagree - a press the server
// refuses, a state the tablet cannot read. This runs both processes and walks the week the way the exhibition does,
// a wall and a tablet, so a change is looked at rather than reasoned about.
//
// Nothing here calls a model or needs a key: the server only reads fixtures/week and local-data/.

const API_PORT = 8021;
const WEB_PORT = 5181;

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'python server/sim_main.py',
      url: `http://127.0.0.1:${API_PORT}/api/sim/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      // Set, and empty: the exhibition server never reads a key; this keeps one out of its environment anyway.
      env: { MEDIAL_SIM_PORT: String(API_PORT), OPENAI_API_KEY: '' },
    },
    {
      command: `npx vite --port ${WEB_PORT} --strictPort`,
      url: `http://localhost:${WEB_PORT}/`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { MEDIAL_SIM_URL: `http://127.0.0.1:${API_PORT}` },
    },
  ],
});
