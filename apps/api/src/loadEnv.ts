// loadEnv.ts — load the SINGLE canonical root .env, shared by this TS API AND the
// Python scan scripts (which load <repo-root>/.env via `--env .env`). So there is one
// .env file to edit for both sides. Imported FIRST in index.ts as a side-effect so
// process.env is populated before any other module reads it (ESM evaluates imports in
// order, so a plain dotenv.config() call placed after the other imports would be too late).
import { config as loadDotenv } from 'dotenv';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Walk up from this file until the workspace root (where pnpm-workspace.yaml lives),
// then load <root>/.env. Robust to running from src (tsx dev) or dist (built) or any cwd.
let dir = path.dirname(fileURLToPath(import.meta.url));
for (let i = 0; i < 8 && !existsSync(path.join(dir, 'pnpm-workspace.yaml')); i++) {
  dir = path.dirname(dir);
}
loadDotenv({ path: path.join(dir, '.env') });
