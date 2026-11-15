// DJ controllers in Compás, using Mixxx's community mappings.
//
// This module owns the hardware side: it finds connected controllers (WebHID
// and Web MIDI), matches them against the index of Mixxx mappings the main
// process ships, downloads a mapping when the DJ asks, and runs each connected
// controller's mapping in its own Web Worker (controller-worker.js), which
// impersonates Mixxx's scripting API.
//
// What a Mixxx control *means* in Compás (deck 1 = the floor, deck 2 = the
// headphone pre-listen, …) is not decided here: the player attaches itself as
// the "host" (see useControllerHost in app-player.jsx) with the list of
// controls it understands, a read() of their current values and an apply()
// for changes coming from the hardware.
//
// Exposed as window.compasControllers for the classic-script design files.
import workerSource from "./controller-worker.js?raw";

const SEEN_KEY = "compas.controllers.seen"; // devices already offered once
const MIDI_CHOICE_KEY = "compas.controllers.midiChoice"; // port name → mapping id ("" = none)
const START_TIMEOUT_MS = 10000;
const WORKER_HOLD_MS = 300; // a control the hardware just moved isn't overwritten by Compás for this long

const readJson = (key, fallback) => {
  try { const v = JSON.parse(localStorage.getItem(key)); return v ?? fallback; } catch (_e) { return fallback; }
};
const writeJson = (key, v) => { try { localStorage.setItem(key, JSON.stringify(v)); } catch (_e) { /* full / unavailable */ } };

/* ------------------------------------------------------------- matching */

const STOP_TOKENS = new Set(["midi", "port", "in", "out", "input", "output", "usb", "audio", "device", "controller", "dj", "the", "native", "instruments", "ni"]);
const tokens = (s) => String(s || "")
  .normalize("NFKD").replace(/[̀-ͯ]/g, "")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, " ")
  .split(" ")
  .filter((t) => t && !STOP_TOKENS.has(t));

// Best MIDI mapping for a port name, or null. Every model token of the
// mapping's name (x1, sb2, 400, mk3…) must appear in the port name, and at
// least one plain word (brand or product) too, so "IAC Driver Bus 1" doesn't
// match "Arturia KeyLab Mk 1".
function matchMidi(portName, mappings) {
  const port = new Set();
  for (const t of tokens(portName)) {
    port.add(t);
    t.split(/(?<=\d)(?=[a-z])|(?<=[a-z])(?=\d)/).forEach((p) => port.add(p)); // nanokontrol2 → nanokontrol, 2
  }
  let best = null;
  for (const m of mappings) {
    if (m.protocol !== "midi") continue;
    // The display name and the file name are spelled differently often enough
    // ("Korg nanoKONTROL2" / "Korg nanoKONTROL 2") that each gets its own try.
    for (const label of [m.name, m.id.replace(/\.midi\.xml$/, "")]) {
      const want = [...new Set(tokens(label))];
      const models = want.filter((t) => /\d/.test(t));
      const words = want.filter((t) => !/\d/.test(t));
      if (models.some((t) => !port.has(t))) continue;
      const hitWords = words.filter((t) => port.has(t)).length;
      if (!hitWords || hitWords + models.length < 2) continue;
      const score = hitWords * 10 + models.length * 15 - (words.length - hitWords); // a matched model number beats a word
      if (!best || score > best.score) best = {m, score};
    }
  }
  return best ? best.m : null;
}

const collectionsOf = (dev) => {
  const out = [];
  const walk = (list) => (list || []).forEach((c) => { out.push(c); walk(c.children); });
  walk(dev.collections);
  return out;
};

// Among the HID interfaces of one physical device, the one a mapping talks to.
function pickHidInterface(devs, spec) {
  const score = (d) => {
    const cols = collectionsOf(d);
    if (spec.usagePage && cols.some((c) => c.usagePage === spec.usagePage && (spec.usage == null || c.usage === spec.usage))) return 3;
    if (spec.usagePage && cols.some((c) => c.usagePage === spec.usagePage)) return 2;
    if (cols.some((c) => c.usagePage >= 0xff00)) return 1;
    return 0;
  };
  return devs.slice().sort((a, b) => score(b) - score(a))[0];
}

/* ------------------------------------------------------- mapping parsing */

const num = (s, fallback) => {
  if (s == null || String(s).trim() === "") return fallback;
  const t = String(s).trim();
  const n = /^-?0x/i.test(t) ? parseInt(t, 16) : Number(t);
  return Number.isFinite(n) ? n : fallback;
};
const childText = (el, name) => {
  const c = Array.from(el.children).find((x) => x.tagName.toLowerCase() === name.toLowerCase());
  return c ? c.textContent.trim() : null;
};

function parseMapping(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("The mapping file is not valid XML");
  const root = doc.documentElement;
  const controller = root.querySelector("controller");

  const prefixes = controller
    ? Array.from(controller.querySelectorAll("scriptfiles > file")).map((f) => f.getAttribute("functionprefix") || "").filter(Boolean)
    : [];

  const settings = {};
  for (const opt of root.querySelectorAll("settings option")) {
    const name = opt.getAttribute("variable");
    if (!name) continue;
    const type = (opt.getAttribute("type") || "").toLowerCase();
    const def = opt.getAttribute("default");
    if (type === "boolean") settings[name] = def === "true";
    else if (type === "integer" || type === "real" || type === "number") settings[name] = num(def, num(opt.getAttribute("min"), 0));
    else if (type === "enum") {
      const values = Array.from(opt.querySelectorAll("value"));
      const chosen = values.find((v) => v.getAttribute("default") === "true") || values[0];
      settings[name] = chosen ? chosen.textContent.trim() : undefined;
    } else if (def != null) settings[name] = def;
  }

  const controls = [];
  const outputs = [];
  if (controller) {
    for (const c of controller.querySelectorAll("controls > control")) {
      const optsEl = Array.from(c.children).find((x) => x.tagName.toLowerCase() === "options");
      controls.push({
        group: childText(c, "group") || "",
        key: childText(c, "key") || "",
        status: num(childText(c, "status"), 0),
        midino: num(childText(c, "midino"), 0),
        options: optsEl ? Array.from(optsEl.children).map((o) => o.tagName) : [],
      });
    }
    for (const o of controller.querySelectorAll("outputs > output")) {
      outputs.push({
        group: childText(o, "group") || "",
        key: childText(o, "key") || "",
        status: num(childText(o, "status"), 0),
        midino: num(childText(o, "midino"), 0),
        on: num(childText(o, "on"), 0x7f),
        off: num(childText(o, "off"), 0x00),
        min: num(childText(o, "minimum"), 0),
        max: num(childText(o, "maximum"), 1),
      });
    }
  }
  return {prefixes, settings, midi: {controls, outputs}};
}

/* ---------------------------------------------------------- the runtime */

class ControllerRuntime {
  constructor() {
    this.supported = !!(navigator.hid || navigator.requestMIDIAccess);
    this.index = null; // {source, mappings}
    this.installed = new Set();
    this.devices = new Map(); // key → device record
    this.sessions = new Map(); // key → Session
    this.status = new Map(); // key → {status, error}
    this.offer = null; // key of a newly plugged controller to offer setting up
    this.listeners = new Set();
    this.host = null;
    this.midiAccess = null;
    this.snapshot = this.#buildSnapshot();
    this.ready = this.supported ? this.#init().catch((e) => console.warn("[controllers] init failed", e)) : Promise.resolve();
  }

  /* ---- subscription (React's useSyncExternalStore) ---- */
  subscribe = (fn) => { this.listeners.add(fn); return () => this.listeners.delete(fn); };
  getSnapshot = () => this.snapshot;
  #emit() {
    this.snapshot = this.#buildSnapshot();
    this.listeners.forEach((fn) => { try { fn(); } catch (_e) { /* listener bug */ } });
  }
  #buildSnapshot() {
    const mappings = this.index ? this.index.mappings : [];
    const byId = new Map(mappings.map((m) => [m.id, m]));
    const devices = [...this.devices.values()].map((d) => {
      const m = d.mappingId ? byId.get(d.mappingId) : null;
      const st = this.status.get(d.key) || {status: "idle"};
      return {
        key: d.key, label: d.label, protocol: d.protocol,
        mapping: m ? {id: m.id, name: m.name} : null,
        manual: !!d.manual,
        installed: !!m && this.installed.has(m.id),
        status: st.status, error: st.error || null,
      };
    });
    return {
      supported: this.supported,
      loaded: !!this.index,
      source: this.index ? this.index.source : null,
      midiMappings: mappings.filter((m) => m.protocol === "midi").map((m) => ({id: m.id, name: m.name})),
      devices,
      offer: this.offer && devices.find((d) => d.key === this.offer) || null,
    };
  }
  #setStatus(key, status, error) {
    this.status.set(key, {status, error: error || null});
    this.#emit();
  }

  /* ---- discovery ---- */
  async #init() {
    this.index = await window.compas.controllers.index();
    this.installed = new Set(await window.compas.controllers.installed());
    if (navigator.hid) {
      navigator.hid.addEventListener("connect", () => this.#refresh());
      navigator.hid.addEventListener("disconnect", () => this.#refresh());
    }
    if (navigator.requestMIDIAccess) {
      try {
        this.midiAccess = await navigator.requestMIDIAccess({sysex: true});
      } catch (_e) {
        try { this.midiAccess = await navigator.requestMIDIAccess(); } catch (_e2) { this.midiAccess = null; }
      }
      if (this.midiAccess) this.midiAccess.onstatechange = () => this.#refreshSoon();
    }
    await this.#refresh();
  }

  #refreshTimer = null;
  #refreshSoon() {
    // A MIDI device announces each port separately; settle first.
    clearTimeout(this.#refreshTimer);
    this.#refreshTimer = setTimeout(() => this.#refresh(), 250);
  }

  async #scan() {
    const found = new Map();
    const mappings = this.index ? this.index.mappings : [];
    if (navigator.hid) {
      let hidDevices = [];
      try { hidDevices = await navigator.hid.getDevices(); } catch (_e) { hidDevices = []; }
      const groups = new Map();
      for (const d of hidDevices) {
        const k = `hid:${d.vendorId}:${d.productId}`;
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(d);
      }
      for (const [key, devs] of groups) {
        const {vendorId, productId} = devs[0];
        const m = mappings.find((x) => x.protocol === "hid" && x.devices.some((s) => s.vendorId === vendorId && s.productId === productId));
        if (!m) continue;
        const spec = m.devices.find((s) => s.vendorId === vendorId && s.productId === productId);
        const hid = pickHidInterface(devs, spec);
        found.set(key, {key, protocol: "hid", label: devs[0].productName || m.name, mappingId: m.id, hid});
      }
    }
    if (this.midiAccess) {
      const choices = readJson(MIDI_CHOICE_KEY, {});
      const outputs = [...this.midiAccess.outputs.values()].filter((o) => o.state !== "disconnected");
      for (const input of this.midiAccess.inputs.values()) {
        if (input.state === "disconnected") continue;
        const key = `midi:${input.name}`;
        if (found.has(key)) continue; // a device with two same-named inputs
        const manual = Object.prototype.hasOwnProperty.call(choices, input.name);
        const auto = matchMidi(input.name, mappings);
        const mappingId = manual ? (choices[input.name] || null) : (auto ? auto.id : null);
        const norm = tokens(input.name).join(" ");
        const output = outputs.find((o) => o.name === input.name) || outputs.find((o) => tokens(o.name).join(" ") === norm) || null;
        found.set(key, {key, protocol: "midi", label: input.name, mappingId, manual, midiIn: input, midiOut: output});
      }
    }
    return found;
  }

  async #refresh() {
    if (!this.index) return;
    const found = await this.#scan();
    // Gone, or now pointing at a different mapping/interface: stop.
    for (const [key, s] of this.sessions) {
      const d = found.get(key);
      if (!d || d.mappingId !== s.mappingId || (d.hid && d.hid !== s.device.hid) || (d.midiIn && d.midiIn !== s.device.midiIn)) {
        await this.stop(key);
      }
    }
    const seen = new Set(readJson(SEEN_KEY, []));
    let newlySeen = null;
    this.devices = found;
    for (const d of found.values()) {
      if (!d.mappingId) continue;
      if (this.installed.has(d.mappingId)) {
        if (!this.sessions.has(d.key)) this.start(d.key);
      } else if (!seen.has(d.key)) {
        seen.add(d.key);
        newlySeen = newlySeen || d.key;
      }
    }
    if (newlySeen) {
      writeJson(SEEN_KEY, [...seen]);
      if (!this.offer) this.offer = newlySeen;
    }
    if (this.offer && !found.has(this.offer)) this.offer = null;
    this.#emit();
  }

  /* ---- actions for the UI ---- */

  /** Rescan, download every recognised controller's mapping that is missing,
   *  and start them all. Resolves {found, failed} (counts). */
  detectAndInstall = async () => {
    await this.ready;
    await this.#refresh();
    let found = 0, failed = 0;
    for (const d of [...this.devices.values()]) {
      if (!d.mappingId) continue;
      found++;
      const ok = await this.install(d.key);
      if (!ok) failed++;
    }
    return {found, failed};
  };

  /** Download (if needed) and start one controller. Resolves true on success. */
  install = async (key) => {
    const d = this.devices.get(key);
    if (!d || !d.mappingId) return false;
    if (!this.installed.has(d.mappingId)) {
      this.#setStatus(key, "downloading");
      let res;
      try { res = await window.compas.controllers.download(d.mappingId); } catch (_e) { res = {ok: false, error: "network"}; }
      if (!res || !res.ok) { this.#setStatus(key, "error", (res && res.error) || "network"); return false; }
      this.installed.add(d.mappingId);
    }
    if (this.sessions.has(key)) await this.stop(key);
    const ok = await this.start(key);
    // The first-plug offer stays up on failure so it can say what went wrong.
    if (ok && this.offer === key) { this.offer = null; this.#emit(); }
    return ok;
  };

  dismissOffer = () => { this.offer = null; this.#emit(); };

  /** Choose the mapping for a MIDI port by hand (null = none). */
  setMidiMapping = async (key, mappingId) => {
    const d = this.devices.get(key);
    if (!d || d.protocol !== "midi") return;
    const choices = readJson(MIDI_CHOICE_KEY, {});
    choices[d.label] = mappingId || "";
    writeJson(MIDI_CHOICE_KEY, choices);
    await this.stop(key);
    await this.#refresh();
    if (mappingId) await this.install(key);
  };

  start = async (key) => {
    const d = this.devices.get(key);
    if (!d || !d.mappingId || this.sessions.has(key)) return false;
    const session = new Session(this, d);
    this.sessions.set(key, session);
    this.#setStatus(key, "starting");
    try {
      await session.start();
      this.#setStatus(key, "running");
      return true;
    } catch (e) {
      // Stopped while starting (unplugged, or the DJ changed the mapping):
      // whatever replaced this session is left alone.
      const gone = session.disposed;
      session.dispose();
      if (gone) return false;
      console.warn(`[controllers] ${d.label}:`, e);
      if (this.sessions.get(key) === session) this.sessions.delete(key);
      this.#setStatus(key, "error", e && e.code ? e.code : "start");
      return false;
    }
  };

  stop = async (key) => {
    const s = this.sessions.get(key);
    if (!s) return;
    this.sessions.delete(key);
    await s.stop();
    this.status.delete(key);
    this.#emit();
  };

  /* ---- host (the player) ---- */

  /** The player registers what it controls. `keys`: {"[Group],key": 'value'|'param'};
   *  `read()`: [[group, key, v]] for every control it reports (keys plus
   *  read-only ones like track_loaded); `apply(changes)`: hardware moved these. */
  attachHost = (host) => {
    this.host = host;
    this.hostChanged();
    return () => { if (this.host === host) this.host = null; };
  };

  #hostPushTimer = null;
  /** The player's state changed: tell every running mapping (next frame). */
  hostChanged = () => {
    if (this.#hostPushTimer) return;
    this.#hostPushTimer = setTimeout(() => {
      this.#hostPushTimer = null;
      if (!this.host) return;
      let state;
      try { state = this.host.read(); } catch (_e) { return; }
      for (const s of this.sessions.values()) s.pushHost(state);
    }, 16);
  };

  hostKeys() { return this.host ? this.host.keys : {}; }
  hostState() { try { return this.host ? this.host.read() : []; } catch (_e) { return []; } }

  #applyQueue = new Map();
  #applyTimer = null;
  /** Hardware changes from a mapping, applied to the player at most once a frame. */
  fromHardware(changes) {
    for (const [g, k, v] of changes) this.#applyQueue.set(`${g},${k}`, [g, k, v]);
    if (this.#applyTimer) return;
    this.#applyTimer = setTimeout(() => {
      this.#applyTimer = null;
      const batch = [...this.#applyQueue.values()];
      this.#applyQueue.clear();
      if (this.host && batch.length) { try { this.host.apply(batch); } catch (e) { console.warn("[controllers] apply", e); } }
      // Re-sync shortly after, so a change the player refused (a locked set,
      // nothing loaded) doesn't leave the controller's lights out of step.
      setTimeout(() => { for (const s of this.sessions.values()) s.resync = true; this.hostChanged(); }, WORKER_HOLD_MS + 50);
    }, 16);
  }
}

/* ------------------------------------------------------------- a session */

class StartError extends Error {
  constructor(code, message) { super(message || code); this.code = code; }
}

class Session {
  constructor(runtime, device) {
    this.rt = runtime;
    this.device = device;
    this.mappingId = device.mappingId;
    this.worker = null;
    this.touched = new Map(); // "[G],k" → time the hardware last changed it
    this.lastPushed = new Map();
    this.resync = true;
    this.disposers = [];
    this.hidQueue = new Map(); // newest pending report per id
    this.hidFifo = []; // reports that must all go out, in order
    this.hidPumping = false;
    this.disposed = false;
  }

  // stop() can arrive while start() is still waiting (the controller was
  // unplugged mid-start): give up rather than start a worker nobody stops.
  #alive() { if (this.disposed) throw new StartError("gone"); }

  async start() {
    const files = await window.compas.controllers.load(this.mappingId);
    this.#alive();
    if (!files) throw new StartError("missing");
    const parsed = parseMapping(files.xml);
    const d = this.device;

    let featureReports = {};
    let inputReportSizes = {};
    let featureReportSizes = {};
    if (d.protocol === "hid") {
      try {
        if (!d.hid.opened) await d.hid.open();
      } catch (e) {
        throw new StartError("open", e && e.message);
      }
      if (this.disposed) { try { await d.hid.close(); } catch (_e) { /* gone */ } this.#alive(); }
      this.disposers.push(() => { try { d.hid.close(); } catch (_e) { /* already closed */ } });
      const bytesOf = (r) => Math.ceil((r.items || []).reduce((n, it) => n + (it.reportSize || 0) * (it.reportCount || 0), 0) / 8);
      for (const c of collectionsOf(d.hid)) {
        for (const r of c.inputReports || []) inputReportSizes[r.reportId] = Math.max(inputReportSizes[r.reportId] || 0, bytesOf(r));
        for (const r of c.featureReports || []) featureReportSizes[r.reportId] = Math.max(featureReportSizes[r.reportId] || 0, bytesOf(r));
      }
      // Mixxx scripts read some feature reports synchronously (calibration
      // data); WebHID can only read them asynchronously, so fetch ahead.
      const ids = new Set();
      for (const s of files.scripts) {
        for (const m of s.source.matchAll(/getFeatureReport\(\s*(0x[0-9a-f]+|\d+)\s*\)/gi)) ids.add(Number(m[1]));
      }
      for (const id of ids) {
        try {
          const dv = await d.hid.receiveFeatureReport(id);
          let bytes = new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength);
          if (id !== 0 && bytes[0] === id) bytes = bytes.subarray(1);
          featureReports[id] = Array.from(bytes);
        } catch (_e) { /* not supported by this device; the script gets zeros */ }
      }
    }
    this.#alive();

    const url = URL.createObjectURL(new Blob([workerSource], {type: "text/javascript"}));
    this.worker = new Worker(url, {name: `controller ${d.label}`});
    URL.revokeObjectURL(url);

    const started = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new StartError("start", "The mapping did not start in time")), START_TIMEOUT_MS);
      this.onStarted = () => { clearTimeout(timer); resolve(); };
      this.onFailed = (msg) => { clearTimeout(timer); reject(new StartError("script", msg)); };
    });
    this.worker.onmessage = (e) => this.#onWorker(e.data || {});
    this.worker.onerror = (e) => {
      console.warn(`[controllers] ${d.label}: ${e.message}`);
      if (this.onFailed) this.onFailed(e.message);
    };

    // Device input → worker.
    if (d.protocol === "hid") {
      const onReport = (e) => {
        const bytes = new Uint8Array(e.data.byteLength);
        bytes.set(new Uint8Array(e.data.buffer, e.data.byteOffset, e.data.byteLength));
        this.worker.postMessage({type: "hid", reportId: e.reportId, data: bytes}, [bytes.buffer]);
      };
      d.hid.addEventListener("inputreport", onReport);
      this.disposers.push(() => d.hid.removeEventListener("inputreport", onReport));
    } else {
      const onMidi = (e) => this.worker.postMessage({type: "midi", data: Array.from(e.data)});
      d.midiIn.addEventListener("midimessage", onMidi);
      this.disposers.push(() => d.midiIn.removeEventListener("midimessage", onMidi));
      try { await d.midiIn.open(); } catch (_e) { /* opens implicitly */ }
      if (d.midiOut) { try { await d.midiOut.open(); } catch (_e) { /* output optional */ } }
      this.#alive();
    }

    const keys = this.rt.hostKeys();
    const state = this.rt.hostState();
    state.forEach(([g, k, v]) => this.lastPushed.set(`${g},${k}`, v));
    this.worker.postMessage({
      type: "start",
      name: d.label,
      protocol: d.protocol,
      scripts: files.scripts,
      prefixes: parsed.prefixes,
      settings: parsed.settings,
      midi: d.protocol === "midi" ? parsed.midi : null,
      host: {keys, state},
      inputReportSizes,
      featureReportSizes,
      featureReports,
    });
    await started;
    // The mapping only reports to Compás once it has settled (the worker's
    // HOST_ARM_DELAY_MS); then re-send Compás' state in full, so nothing its
    // init did to a fader or button in the meantime is left out of step.
    setTimeout(() => { this.resync = true; this.rt.hostChanged(); }, 600);
  }

  #onWorker(msg) {
    switch (msg.type) {
      case "started": if (this.onStarted) this.onStarted(); break;
      case "failed": if (this.onFailed) this.onFailed(msg.message); break;
      case "stopped": if (this.onStopped) this.onStopped(); break;
      case "log":
        if (msg.level === "error" || msg.level === "warn") console.warn(`[controller ${this.device.label}] ${msg.message}`);
        break;
      case "host": {
        const now = performance.now();
        for (const [g, k, v] of msg.changes || []) { this.touched.set(`${g},${k}`, now); this.lastPushed.set(`${g},${k}`, v); }
        this.rt.fromHardware(msg.changes || []);
        break;
      }
      case "hidOut":
        this.#queueHid(msg.reportId, msg.data, msg.feature, msg.fifo);
        break;
      case "midiOut":
        if (this.device.midiOut) { try { this.device.midiOut.send(msg.data); } catch (_e) { /* bad message from the mapping */ } }
        break;
      default:
        break;
    }
  }

  // HID writes are async and a mapping can produce them faster than the
  // device takes them. As in Mixxx, ordinary output reports keep only the
  // newest pending one per id; FIFO ones (feature reports, and those a mapping
  // asks not to skip) all go out, in order, first.
  #queueHid(reportId, data, feature, fifo) {
    const r = {reportId, data, feature};
    if (fifo) { if (this.hidFifo.length < 512) this.hidFifo.push(r); }
    else this.hidQueue.set(reportId, r);
    if (this.hidPumping) return;
    this.hidPumping = true;
    (async () => {
      const dev = this.device.hid;
      while ((this.hidFifo.length || this.hidQueue.size) && dev && dev.opened) {
        let r;
        if (this.hidFifo.length) r = this.hidFifo.shift();
        else { const [k, v] = this.hidQueue.entries().next().value; this.hidQueue.delete(k); r = v; }
        try {
          if (r.feature) await dev.sendFeatureReport(r.reportId, r.data);
          else await dev.sendReport(r.reportId, r.data);
        } catch (_e) { /* the device went away or refused one report */ }
      }
      this.hidPumping = false;
    })();
  }

  pushHost(state) {
    if (!this.worker) return;
    const now = performance.now();
    const force = this.resync;
    this.resync = false;
    const changes = [];
    for (const [g, k, v] of state) {
      const id = `${g},${k}`;
      // While the DJ is moving a fader, the hardware is the truth.
      if (now - (this.touched.get(id) || -Infinity) < WORKER_HOLD_MS) continue;
      if (!force && this.lastPushed.get(id) === v) continue;
      this.lastPushed.set(id, v);
      changes.push([g, k, v]);
    }
    if (changes.length) this.worker.postMessage({type: "host", changes});
  }

  async stop() {
    if (this.worker) {
      // Let the mapping switch its lights off before the device closes.
      const stopped = new Promise((resolve) => { this.onStopped = resolve; setTimeout(resolve, 400); });
      try { this.worker.postMessage({type: "stop"}); } catch (_e) { /* already gone */ }
      await stopped;
      await new Promise((r) => setTimeout(r, 50)); // let the last HID writes go out
    }
    this.dispose();
  }

  dispose() {
    this.disposed = true;
    if (this.onFailed) this.onFailed("stopped"); // a start() still waiting gives up now
    if (this.worker) { this.worker.terminate(); this.worker = null; }
    this.disposers.splice(0).forEach((fn) => { try { fn(); } catch (_e) { /* ignore */ } });
    this.hidQueue.clear();
    this.hidFifo.length = 0;
  }
}

window.compasControllers = new ControllerRuntime();
