import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Two kinds of test live here, and neither duplicates a stylesheet.
//
//   *.test.ts   pure selector behaviour, no DOM;
//   *.test.tsx  a screen mounted against fixtures captured from the real server
//               (fixtures/ui/), asserting that it renders and says the true
//               thing about the data - not that a colour is a colour.
//
// The mount tests exist because a screen that throws on real data is invisible
// to `tsc`, and this repository has no other automated way to notice.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
