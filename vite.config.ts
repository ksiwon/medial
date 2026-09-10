import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The simulator's API lives in its own process (server/sim_main.py); proxying
// /api/sim keeps the browser on a single origin.
export default defineConfig({
  plugins: [react()],
  server: {
    // Honour PORT when the harness assigns one, so two dev servers can run side
    // by side instead of fighting over 5173.
    port: process.env.PORT ? Number(process.env.PORT) : 5173,
    proxy: {
      '/api/sim': {
        target: process.env.MEDIAL_SIM_URL ?? 'http://127.0.0.1:8010',
        changeOrigin: true,
      },
    },
  },
})
