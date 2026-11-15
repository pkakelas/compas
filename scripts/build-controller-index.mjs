// build-controller-index.mjs — build the small index Compás ships so it can
// recognise a DJ controller and download only that controller's Mixxx mapping.
//
//   node scripts/build-controller-index.mjs
//
// Output : packages/main/src/data/mixxx-controllers.json
//
// Mixxx (https://mixxx.org, GPL-2.0-or-later) maintains community mappings for
// hundreds of controllers in res/controllers. Compás does not bundle them: the
// app downloads the files one controller needs, on request, from GitHub. This
// script pins one Mixxx release by *commit* (a tag can move) and records the
// SHA-256 of every file a mapping needs, so the app refuses anything that does
// not match byte for byte before it runs a line of it.
//
// To move to a newer Mixxx release, change MIXXX_TAG and re-run. Check that the
// shim (packages/renderer/entries/controller-worker.js) still covers the
// mappings' API before shipping.

import {writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const MIXXX_TAG = '2.5.6';
const REPO = 'mixxxdj/mixxx';
const DIR = 'res/controllers';
// Mixxx loads this before every mapping's own scripts.
const REQUIRED_SCRIPT = 'common-controller-scripts.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'packages', 'main', 'src', 'data', 'mixxx-controllers.json');

function resolveCommit(tag) {
  const out = execFileSync('git', ['ls-remote', `https://github.com/${REPO}`, `refs/tags/${tag}`, `refs/tags/${tag}^{}`], {encoding: 'utf8'});
  const lines = out.trim().split('\n').map((l) => l.split('\t'));
  // An annotated tag lists the tag object and the commit it points at (^{}).
  const peeled = lines.find(([, ref]) => ref.endsWith('^{}')) || lines[0];
  if (!peeled || !/^[0-9a-f]{40}$/.test(peeled[0])) throw new Error(`Could not resolve ${tag}`);
  return peeled[0];
}

async function getJson(url) {
  const res = await fetch(url, {headers: {'User-Agent': 'compas-build-script', Accept: 'application/vnd.github+json'}});
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json();
}

const rawUrl = (commit, name) => `https://raw.githubusercontent.com/${REPO}/${commit}/${DIR}/${encodeURIComponent(name)}`;

async function getText(commit, name) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(rawUrl(commit, name));
    if (res.ok) return Buffer.from(await res.arrayBuffer());
    if (attempt >= 2) throw new Error(`${name}: ${res.status}`);
  }
}

async function pool(items, size, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({length: size}, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]); }
  }));
  return out;
}

const decodeXml = (s) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const attr = (tag, name) => {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i'));
  return m ? decodeXml(m[2] ?? m[3]) : null;
};
const textOf = (xml, el) => {
  const m = xml.match(new RegExp(`<${el}>([\\s\\S]*?)</${el}>`, 'i'));
  return m ? decodeXml(m[1].trim()) : null;
};
const hex = (v) => (v == null || v === '' ? null : Number.parseInt(v, 16));

function parseMapping(file, xml) {
  const info = (xml.match(/<info>([\s\S]*?)<\/info>/i) || [])[1] || '';
  const name = textOf(info, 'name') || file.replace(/\.(midi|hid)\.xml$/, '');
  const author = textOf(info, 'author');
  const protocol = file.endsWith('.hid.xml') ? 'hid' : 'midi';
  const devices = [...info.matchAll(/<product\b[^>]*>/gi)].map(([tag]) => ({
    protocol: (attr(tag, 'protocol') || protocol).toLowerCase(),
    vendorId: hex(attr(tag, 'vendor_id')),
    productId: hex(attr(tag, 'product_id')),
    usagePage: hex(attr(tag, 'usage_page')),
    usage: hex(attr(tag, 'usage')),
    interfaceNumber: hex(attr(tag, 'interface_number')),
  })).filter((d) => d.protocol === protocol && (protocol !== 'hid' || (d.vendorId != null && d.productId != null)))
    .map((d) => Object.fromEntries(Object.entries(d).filter(([k, v]) => v != null && k !== 'protocol')));
  // Mixxx reads only the first <controller> block.
  const controller = (xml.match(/<controller\b[\s\S]*?<\/controller>/i) || [''])[0];
  const scriptfiles = (controller.match(/<scriptfiles>([\s\S]*?)<\/scriptfiles>/i) || [])[1] || '';
  const scripts = [...scriptfiles.matchAll(/<file\b[^>]*>/gi)].map(([tag]) => attr(tag, 'filename')).filter(Boolean);
  return {id: file, name, author, protocol, devices, scripts};
}

async function main() {
  const commit = resolveCommit(MIXXX_TAG);
  console.log(`Mixxx ${MIXXX_TAG} → ${commit}`);
  const tree = await getJson(`https://api.github.com/repos/${REPO}/git/trees/${commit}?recursive=1`);
  if (tree.truncated) throw new Error('GitHub tree listing was truncated');
  const prefix = `${DIR}/`;
  const available = new Set(tree.tree
    .filter((e) => e.type === 'blob' && e.path.startsWith(prefix) && !e.path.slice(prefix.length).includes('/'))
    .map((e) => e.path.slice(prefix.length)));

  // USB bulk mappings (the S4 MK3 screens) need raw USB access Compás doesn't have.
  const xmlFiles = [...available].filter((f) => /\.(midi|hid)\.xml$/.test(f)).sort();
  const xmlBodies = await pool(xmlFiles, 12, (f) => getText(commit, f));

  const mappings = [];
  const needed = new Set([REQUIRED_SCRIPT]);
  xmlFiles.forEach((file, i) => {
    const m = parseMapping(file, xmlBodies[i].toString('utf8'));
    const missing = m.scripts.filter((s) => !available.has(s) || !/\.js$/.test(s));
    if (missing.length) { console.warn(`skip ${file}: needs ${missing.join(', ')}`); return; }
    if (m.protocol === 'hid' && !m.devices.length) { console.warn(`skip ${file}: no USB ids`); return; }
    m.scripts.forEach((s) => needed.add(s));
    mappings.push(m);
  });

  const files = {};
  xmlFiles.forEach((file, i) => {
    if (!mappings.some((m) => m.id === file)) return;
    files[file] = {sha256: createHash('sha256').update(xmlBodies[i]).digest('hex'), size: xmlBodies[i].length};
  });
  const scriptNames = [...needed].sort();
  const scriptBodies = await pool(scriptNames, 12, (f) => getText(commit, f));
  scriptNames.forEach((name, i) => {
    files[name] = {sha256: createHash('sha256').update(scriptBodies[i]).digest('hex'), size: scriptBodies[i].length};
  });

  const index = {
    source: {
      project: 'Mixxx',
      license: 'GPL-2.0-or-later',
      repo: REPO,
      tag: MIXXX_TAG,
      commit,
      baseUrl: `https://raw.githubusercontent.com/${REPO}/${commit}/${DIR}/`,
    },
    requiredScript: REQUIRED_SCRIPT,
    mappings,
    files: Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b))),
  };
  writeFileSync(OUT, JSON.stringify(index, null, 1) + '\n');
  const hid = mappings.filter((m) => m.protocol === 'hid').length;
  console.log(`${mappings.length} mappings (${hid} HID, ${mappings.length - hid} MIDI), ${Object.keys(files).length} files → ${OUT}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
