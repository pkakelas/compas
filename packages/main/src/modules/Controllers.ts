import type {AppModule} from '../AppModule.js';
import type {ModuleContext} from '../ModuleContext.js';
import {ipcMain, net, session} from 'electron';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {mkdir, readFile, rename, stat, writeFile} from 'node:fs/promises';
import rawIndex from '../data/mixxx-controllers.json' with {type: 'json'};

/**
 * DJ controller mappings, borrowed from Mixxx.
 *
 * Mixxx maintains community mappings for hundreds of controllers (Traktor
 * Kontrol, Pioneer, Hercules, …). Compás ships only a small index of them
 * (scripts/build-controller-index.mjs): which USB ids / names each mapping is
 * for, which files it needs, and every file's SHA-256 at one pinned Mixxx
 * commit. When the DJ asks, this module downloads just the files one controller
 * needs, checks each against its hash, and keeps them in the user-data folder so
 * the controller works offline at the milonga.
 *
 * The files run in a Web Worker in the renderer (see controller-worker.js),
 * never here, and never before their hashes match the index.
 */

type HidDevice = {vendorId: number; productId: number; usagePage?: number; usage?: number; interfaceNumber?: number};
type Mapping = {id: string; name: string; author: string | null; protocol: 'hid' | 'midi'; devices: HidDevice[]; scripts: string[]};
type FileInfo = {sha256: string; size: number};
type Index = {
  source: {project: string; license: string; repo: string; tag: string; commit: string; baseUrl: string};
  requiredScript: string;
  mappings: Mapping[];
  files: Record<string, FileInfo>;
};

const index = rawIndex as Index;
const byId = new Map(index.mappings.map((m) => [m.id, m]));
const knownHid = new Set(
  index.mappings.flatMap((m) => m.devices.map((d) => `${d.vendorId}:${d.productId}`)),
);

const DOWNLOAD_TIMEOUT_MS = 30_000;

/** Every file a mapping needs, in Mixxx's load order: the XML, then the
 *  always-loaded common script, then the mapping's own script files. */
function filesFor(m: Mapping): string[] {
  return [...new Set([m.id, index.requiredScript, ...m.scripts])];
}

const sha256 = (buf: Buffer) => createHash('sha256').update(buf).digest('hex');

export class ControllersModule implements AppModule {
  #dir = '';

  async enable({app}: ModuleContext): Promise<void> {
    // One folder per pinned Mixxx commit: moving to a newer release never mixes
    // its files with the old ones.
    this.#dir = join(app.getPath('userData'), 'controller-mappings', index.source.commit.slice(0, 12));

    ipcMain.handle('controllers:index', () => ({
      source: {project: index.source.project, license: index.source.license, tag: index.source.tag},
      mappings: index.mappings.map(({id, name, protocol, devices}) => ({id, name, protocol, devices})),
    }));
    ipcMain.handle('controllers:installed', () => this.#installed());
    ipcMain.handle('controllers:download', (_e, id: string) => this.#download(String(id)));
    ipcMain.handle('controllers:load', (_e, id: string) => this.#load(String(id)));

    await app.whenReady();
    // Let the renderer open the HID controllers the index knows about — and
    // only those — without a chooser dialog. Chromium already refuses
    // keyboards, mice and security keys on its own.
    session.defaultSession.setDevicePermissionHandler((details) => {
      if (details.deviceType !== 'hid') return false;
      const d = details.device as unknown as {vendorId?: number; productId?: number};
      return knownHid.has(`${d.vendorId}:${d.productId}`);
    });
  }

  async #isCached(name: string): Promise<boolean> {
    const info = index.files[name];
    if (!info) return false;
    try {
      return (await stat(join(this.#dir, name))).size === info.size;
    } catch {
      return false;
    }
  }

  async #installed(): Promise<string[]> {
    const out: string[] = [];
    for (const m of index.mappings) {
      const files = filesFor(m);
      if ((await Promise.all(files.map((f) => this.#isCached(f)))).every(Boolean)) out.push(m.id);
    }
    return out;
  }

  async #download(id: string): Promise<{ok: true} | {ok: false; error: 'unknown' | 'network' | 'integrity'}> {
    const m = byId.get(id);
    if (!m) return {ok: false, error: 'unknown'};
    await mkdir(this.#dir, {recursive: true});
    for (const name of filesFor(m)) {
      const info = index.files[name];
      if (!info) return {ok: false, error: 'unknown'};
      if (await this.#isCached(name)) continue;
      let body: Buffer;
      try {
        const res = await net.fetch(index.source.baseUrl + encodeURIComponent(name), {
          signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
        });
        if (!res.ok) return {ok: false, error: 'network'};
        body = Buffer.from(await res.arrayBuffer());
      } catch {
        return {ok: false, error: 'network'};
      }
      if (body.length !== info.size || sha256(body) !== info.sha256) return {ok: false, error: 'integrity'};
      // Write-then-rename so a half-written file never looks cached.
      const tmp = join(this.#dir, `${name}.part`);
      await writeFile(tmp, body);
      await rename(tmp, join(this.#dir, name));
    }
    return {ok: true};
  }

  /** The mapping's files, re-checked against the index before they are handed
   *  to the renderer to run. Null if anything is missing or was altered. */
  async #load(id: string): Promise<{xml: string; scripts: {name: string; source: string}[]} | null> {
    const m = byId.get(id);
    if (!m) return null;
    const read = async (name: string): Promise<string | null> => {
      const info = index.files[name];
      if (!info) return null;
      try {
        const body = await readFile(join(this.#dir, name));
        return sha256(body) === info.sha256 ? body.toString('utf8') : null;
      } catch {
        return null;
      }
    };
    const xml = await read(m.id);
    if (xml == null) return null;
    const scripts: {name: string; source: string}[] = [];
    for (const name of [index.requiredScript, ...m.scripts.filter((s) => s !== index.requiredScript)]) {
      const source = await read(name);
      if (source == null) return null;
      scripts.push({name, source});
    }
    return {xml, scripts};
  }
}

export function controllersModule(): ControllersModule {
  return new ControllersModule();
}
