import { defineConfig } from '@playwright/test';
import base from './playwright.config';

// The same synthetic server and throwaway database as the checking run; only
// the file being run is different. Captures land in
// docs/research/screenshots/2026-09-15-ui/ (see e2e/shots.spec.ts).
export default defineConfig({
  ...base,
  testIgnore: [],
  testMatch: ['**/shots.spec.ts'],
});
