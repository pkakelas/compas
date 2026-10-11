// db-push.mjs — apply supabase/migrations to the staging or production Community
// backend with the Supabase CLI.
//
//   pnpm db:push:staging [-- --dry-run]
//   pnpm db:push:production [-- --dry-run]
//
// The target project is read from the same file the app is built with
// (packages/main/.env.development → staging, .env.production → production), so
// the database and the app can never point at different projects. You need to
// be logged in (`pnpm exec supabase login`); the CLI asks for the database
// password, or reads it from SUPABASE_DB_PASSWORD.
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const ENV_FILES = {staging: '.env.development', production: '.env.production'};

const [target, ...extra] = process.argv.slice(2);
const envFile = ENV_FILES[target];
if (!envFile) {
  console.error('Usage: node scripts/db-push.mjs <staging|production> [supabase db push flags]');
  process.exit(2);
}

const envPath = fileURLToPath(new URL(`../packages/main/${envFile}`, import.meta.url));
const line = readFileSync(envPath, 'utf8')
  .split(/\r?\n/)
  .find(l => l.startsWith('VITE_SUPABASE_URL='));
const url = (line ?? '').slice('VITE_SUPABASE_URL='.length).trim();
const ref = /^https:\/\/([a-z0-9]{20})\.supabase\.co\/?$/.exec(url)?.[1];
if (!ref) {
  console.error(`Set VITE_SUPABASE_URL in packages/main/${envFile} to the ${target} project URL first`);
  console.error('(it looks like https://<20 letters>.supabase.co).');
  process.exit(2);
}

console.log(`Pushing migrations to ${target} (${ref})…`);
const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const result = spawnSync('supabase', ['db', 'push', '--project-ref', ref, ...extra], {
  cwd: repoRoot,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
process.exit(result.status ?? 1);
