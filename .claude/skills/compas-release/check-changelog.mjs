// Checks the in-app changelog (packages/renderer/js/whats-new.jsx) before a
// release commit:
//   - the CHANGELOG array parses,
//   - versions are newest first, with no duplicates,
//   - the newest entry is the version in package.json (unless --allow-none,
//     for a quiet release with no notes),
//   - every item is a non-empty string or {title, text?, icon?} with a known icon.
//
//   node .claude/skills/compas-release/check-changelog.mjs [repoRoot] [--allow-none]
import {readFileSync} from 'node:fs';
import {join, resolve} from 'node:path';

const args = process.argv.slice(2);
const allowNone = args.includes('--allow-none');
const root = resolve(args.find(a => !a.startsWith('--')) ?? '.');

const src = readFileSync(join(root, 'packages/renderer/js/whats-new.jsx'), 'utf8');
const start = src.indexOf('const CHANGELOG = [');
const end = src.indexOf('\n];', start);
if (start < 0 || end < 0) fail('could not find `const CHANGELOG = [ … ];` in whats-new.jsx');

let changelog;
try {
  changelog = new Function(`return ${src.slice(start + 'const CHANGELOG = '.length, end + 3)}`)();
} catch (e) {
  fail(`CHANGELOG does not parse: ${e.message}`);
}

const icons = new Set(
  [...readFileSync(join(root, 'packages/renderer/js/shared.jsx'), 'utf8')
    .slice(0, 20000).matchAll(/^ {2}(\w+)\s*:\s*\(p\)\s*=>/gm)].map(m => m[1]),
);
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const cmp = (a, b) => {
  const pa = a.split('-')[0].split('.').map(Number);
  const pb = b.split('-')[0].split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
};

const errors = [];
changelog.forEach((entry, i) => {
  if (!entry || typeof entry.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(entry.version)) {
    errors.push(`entry ${i}: version must look like "0.1.22"`);
    return;
  }
  if (i > 0 && cmp(changelog[i - 1].version, entry.version) <= 0) {
    errors.push(`entry ${i} (${entry.version}): versions must be newest first, no duplicates`);
  }
  if (!Array.isArray(entry.items) || !entry.items.length) errors.push(`${entry.version}: items must be a non-empty array`);
  for (const item of entry.items ?? []) {
    if (typeof item === 'string') {
      if (!item.trim()) errors.push(`${entry.version}: empty item`);
      continue;
    }
    if (!item || typeof item.title !== 'string' || !item.title.trim()) errors.push(`${entry.version}: item without a title`);
    if (item && item.text != null && typeof item.text !== 'string') errors.push(`${entry.version}: "${item.title}" text must be a string`);
    if (item && item.icon != null && !icons.has(item.icon)) errors.push(`${entry.version}: "${item.title}" has unknown icon "${item.icon}"`);
  }
});

const newest = changelog[0]?.version;
if (newest && cmp(newest, version) > 0) errors.push(`newest entry ${newest} is ahead of package.json ${version}`);
if (!allowNone && newest !== version) errors.push(`no entry for ${version} (package.json) — pass --allow-none for a release with no notes`);

if (errors.length) fail(errors.join('\n'));
console.log(`changelog ok — ${changelog.length} version(s), newest ${newest ?? 'none'}, package.json ${version}`);

function fail(msg) {
  console.error(`changelog check failed:\n${msg}`);
  process.exit(1);
}
