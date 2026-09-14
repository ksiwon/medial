import { defineConfig } from '@playwright/test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Real browser, real server, synthetic village.
//
// The mount tests (vitest + jsdom) prove a screen does not throw and does not
// print an internal name where a sentence belongs. They cannot see layout, and
// they cannot see the API and the screen disagree. This runs both processes
// and drives a headless Chromium through the same three screens a researcher
// uses, so a change can be looked at rather than reasoned about.
//
// Everything points away from the researcher's data: the API is given its own
// database under .run/ and the SYNTHETIC village and personas, so the run
// never writes into local-data/runs and a screenshot never carries a real
// place name. .run/ is gitignored; nothing here is committed.

const API_PORT = 8011;
const WEB_PORT = 5174;
const ROOT = dirname(fileURLToPath(import.meta.url));
const RUN_DIR = resolve(ROOT, '.run', 'e2e');

export default defineConfig({
  testDir: 'e2e',
  outputDir: resolve(RUN_DIR, 'results'),
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    viewport: { width: 1440, height: 900 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'node e2e/reset-db.mjs && python server/sim_main.py',
      url: `http://127.0.0.1:${API_PORT}/api/sim/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        MEDIAL_SIM_PORT: String(API_PORT),
        MEDIAL_SIM_DB: resolve(RUN_DIR, 'simulation.sqlite3'),
        MEDIAL_VILLAGE_PATH: resolve(ROOT, 'fixtures', 'synthetic', 'village.synthetic.json'),
        MEDIAL_PERSONA_PATH: resolve(ROOT, 'fixtures', 'synthetic', 'personas.synthetic.json'),
      },
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
