// A fresh database for every e2e run, so the screens are looked at from the
// same starting point each time and never from whatever the last run left.
import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const dir = resolve(import.meta.dirname, '..', '.run', 'e2e');
mkdirSync(dir, { recursive: true });
for (const name of ['simulation.sqlite3', 'simulation.sqlite3-journal']) {
  rmSync(resolve(dir, name), { force: true });
}
