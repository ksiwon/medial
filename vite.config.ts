import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

// The simulator's API lives in its own process (server/sim_main.py); proxying
// /api/sim keeps the browser on a single origin.

// The folders and files of this repository that are not the page, as globs anchored at the repository (not "any folder
// of that name": a checkout inside a folder called `docs` or `out` must still serve its own source). Spelled in both cases
// because the hall's machine may be a case-insensitive disk, where `/SERVER/.env` is the same file as `/server/.env`.
const HERE = fileURLToPath(new URL('.', import.meta.url)).split('\\').join('/').replace(/\/$/, '').replace(/[()[\]{}!+@|]/g, '\\$&')
const anchored = (path: string) => `${HERE}/${path}`.replace(/[A-Za-z]/g, (c) => `[${c.toLowerCase()}${c.toUpperCase()}]`)

// Where a request really came from: the socket, never a header the sender chose.
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])

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
    // The dev server serves the project folder, and the hall's network can reach it: what is not the page
    // stays shut (the repository's history, the research material, the server's code, the recorded runs, keys).
    fs: {
      deny: [
        '.env', '.env.*', '*.{crt,pem}', '**/*.sqlite3', '**/*.db', '**/.git/**',
        ...['.git/**', '.claude/**', '.run/**', 'local-data/**', 'server/**', 'scripts/**', 'docs/**', 'out/**', 'fixtures/**', 'e2e/**',
          'brand/**', '*.md'].map(anchored),
      ],
    },
    proxy: {
      '/api/sim': {
        target: process.env.MEDIAL_SIM_URL ?? 'http://127.0.0.1:8020',
        // The API tells the wall's browser (it opened this machine as localhost) from a tablet by the host the
        // page was opened with (X-Forwarded-Host). A sender sets that header and Host as it likes, so the proxy
        // writes it itself: the page's own host for a request from this machine, the sender's address for any other.
        xfwd: true,
        changeOrigin: false,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq, req) => {
            const from = req.socket.remoteAddress ?? ''
            proxyReq.setHeader('x-forwarded-host', LOOPBACK.has(from) ? (req.headers.host ?? from) : from)
          })
        },
      },
    },
  },
})
