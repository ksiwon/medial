import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The simulator's API lives in its own process (server/sim_main.py); proxying
// /api/sim keeps the browser on a single origin.
export default defineConfig({
  plugins: [react()],
  server: {
    // The exhibition's tablet reaches this page over the hall's network, so the dev
    // server listens on every interface (MEDIAL_WEB_HOST=127.0.0.1 keeps it local).
    // The API stays on 127.0.0.1: the tablet only ever talks to this server, which
    // proxies /api/sim to it, so the API is never opened to the network.
    host: process.env.MEDIAL_WEB_HOST ?? '0.0.0.0',
    // Honour PORT when the harness assigns one, so two dev servers can run side
    // by side instead of fighting over 5173.
    port: process.env.PORT ? Number(process.env.PORT) : 5173,
    proxy: {
      '/api/sim': {
        target: process.env.MEDIAL_SIM_URL ?? 'http://127.0.0.1:8020',
        // Keep the page's own host name on the way through (X-Forwarded-Host): the API tells the
        // wall's browser (localhost) from a tablet (this machine's network address) by it.
        xfwd: true,
        changeOrigin: false,
      },
    },
  },
})
