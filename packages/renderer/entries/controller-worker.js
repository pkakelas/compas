// controller-worker.js — a small stand-in for Mixxx's controller scripting
// engine, so Mixxx's community controller mappings run unchanged in Compás.
//
// This file is loaded as text (Vite `?raw`) and started as a classic Web Worker
// from a Blob, one worker per connected controller. The mapping's own scripts
// are then loaded into the same global scope with importScripts(), exactly as
// Mixxx evaluates them, so they see the `engine`, `midi`, `controller`, `print`
// and `ColorMapper` globals they expect.
//
// A worker has no DOM and no access to window.compas, the database or files:
// the mapping code can only talk to this shim, and the shim only talks to the
// renderer through postMessage. The renderer owns the actual devices (WebHID /
// Web MIDI) and Compás' player; it forwards raw device input here and receives
// raw device output and control changes back.
//
// Semantics follow Mixxx 2.5 (src/controllers/scripting/legacy/*,
// src/controllers/midi/midicontroller.cpp, src/controllers/softtakeover.cpp):
// connection callbacks are queued and coalesced, soft takeover ignores the
// first value and far-away values, MIDI options compute like Mixxx's.
//
// Protocol (renderer → worker):
//   {type:'start', name, protocol, scripts:[{name, source}], prefixes, settings,
//    midi:{controls, outputs}, host:{keys:{"[G],k": 'value'|'param'}, state:[[g,k,v]]},
//    inputReportSizes:{id: bytes}, featureReportSizes:{id: bytes}, featureReports:{id: number[]}}
//   {type:'hid', reportId, data: Uint8Array}       raw HID input report
//   {type:'midi', data: Uint8Array}                 one MIDI message
//   {type:'host', changes:[[group, key, v]]}        Compás state changed
//   {type:'stop'}
// Protocol (worker → renderer):
//   {type:'started'} | {type:'failed', message} | {type:'stopped'}
//   {type:'host', changes:[[group, key, v]]}        a mapping moved a Compás control
//   {type:'hidOut', reportId, data, feature}        send a HID output/feature report
//   {type:'midiOut', data}                          send a MIDI message
//   {type:'log', level, message}

// Everything here is wrapped in a function: a classic worker shares one global
// lexical scope with every importScripts()'d file, and Mixxx's own scripts
// declare names like `Control`. Only the globals assigned on `self` below
// (engine, midi, controller, print, console, ColorMapper) are visible to them.
(() => {
"use strict";

/* ------------------------------------------------------------------ logging */

const post = (msg, transfer) => self.postMessage(msg, transfer || []);
const fmt = (args) => args.map((a) => {
  if (typeof a === "string") return a;
  if (a instanceof Error) return a.stack || String(a);
  try { return JSON.stringify(a); } catch (_e) { return String(a); }
}).join(" ");
let logBudget = 200; // a chatty mapping must not flood the renderer
const log = (level, ...args) => {
  if (logBudget <= 0) return;
  logBudget--;
  post({type: "log", level, message: fmt(args)});
};
setInterval(() => { logBudget = 200; }, 10000);
self.console = {
  log: (...a) => log("debug", ...a),
  debug: (...a) => log("debug", ...a),
  info: (...a) => log("info", ...a),
  warn: (...a) => log("warn", ...a),
  error: (...a) => log("error", ...a),
  assert: (cond, ...a) => { if (!cond) log("error", "Assertion failed", ...a); },
  trace: (...a) => log("debug", ...a),
};
self.print = (msg) => log("debug", msg);

const safely = (what, fn) => {
  try { return fn(); } catch (e) { log("error", `${what}:`, e); return undefined; }
};

/* --------------------------------------------------------------- controls */

// Mixxx 2.4 renamed [Master] to [Main]; mappings use both.
const canonicalGroup = (g) => (g === "[Master]" ? "[Main]" : String(g));
const ckey = (g, k) => `${canonicalGroup(g)},${k}`;

// How a control maps between its value and its 0..1 "parameter" (what a knob
// position means). Mirrors Mixxx's potmeter kinds closely enough for mappings.
//   linear:  value == parameter (0..1)
//   center1: 0..4 with 1 at the middle (gains, EQ)
//   bipolar: -1..1 with 0 at the middle (crossfader, balance, rate)
//   toggle / push: buttons
const TOGGLE_KEYS = new Set([
  "play", "pfl", "mute", "keylock", "quantize", "slip_enabled", "repeat", "talkover",
  "loop_enabled", "reverse", "enabled", "passthrough", "button_parameter1",
  "button_parameter2", "button_parameter3", "button_parameter4", "maximize_library",
  "show_library", "show_mixer", "show_effectrack", "show_samplers",
]);
const PUSH_KEYS = /^(cue_|hotcue_|beatjump|beatloop|loop_|reloop|start|end|eject|LoadSelectedTrack|back|fwd|sync|beatsync|rate_temp|rate_perm|MoveUp|MoveDown|MoveLeft|MoveRight|GoToItem|MoveFocus|ScrollUp|ScrollDown|SelectNext|SelectPrev|Select|ChooseItem|intro_|outro_|next_|prev_|pregain_set|volume_set|headMix_set|rate_set)/;
function specFor(group, key) {
  const g = canonicalGroup(group);
  if (TOGGLE_KEYS.has(key)) return {kind: "toggle", def: key === "enabled" ? 1 : 0};
  if (PUSH_KEYS.test(key)) return {kind: "push", def: 0};
  if (/^parameter\d+$/.test(key) && /^\[EqualizerRack/.test(g)) return {kind: "center1", def: 1};
  if (/^parameter\d+$/.test(key)) return {kind: "linear", def: 0.5};
  switch (key) {
    case "volume": return {kind: "linear", def: 1};
    case "pregain": case "gain": case "headGain": case "boothGain": return {kind: "center1", def: 1};
    case "crossfader": case "headMix": case "balance": case "rate": case "headSplit": return {kind: "bipolar", def: 0};
    case "super1": return {kind: "linear", def: 0.5};
    case "mix": return {kind: "linear", def: 1};
    case "orientation": return {kind: "raw", def: 1};
    case "rateRange": return {kind: "raw", def: 0.08};
    case "rate_dir": return {kind: "raw", def: 1};
    case "track_samplerate": return {kind: "raw", def: 44100};
    case "num_decks": return {kind: "raw", def: 4};
    case "num_samplers": return {kind: "raw", def: 4};
    case "num_preview_decks": return {kind: "raw", def: 1};
    // Mixxx's default deck EQ (3 bands, with kill buttons) and quick effect
    // (the filter); mappings size their knob rows from these.
    case "num_parameters": return {kind: "raw", def: /^\[(EqualizerRack|QuickEffectRack)/.test(g) ? 3 : 0};
    case "num_button_parameters": return {kind: "raw", def: /^\[EqualizerRack/.test(g) ? 3 : 0};
    default: return {kind: "raw", def: 0};
  }
}
const POT_KINDS = new Set(["linear", "center1", "bipolar"]);
function toParam(spec, v) {
  switch (spec.kind) {
    case "center1": return v <= 1 ? v / 2 : 0.5 + (v - 1) / 6;
    case "bipolar": return (v + 1) / 2;
    default: return v;
  }
}
function fromParam(spec, p) {
  switch (spec.kind) {
    case "center1": return p <= 0.5 ? p * 2 : 1 + (p - 0.5) * 6;
    case "bipolar": return p * 2 - 1;
    case "linear": return Math.min(1, Math.max(0, p));
    default: return p;
  }
}

class Control {
  constructor(group, key) {
    this.group = canonicalGroup(group);
    this.key = key;
    this.spec = specFor(group, key);
    this.value = this.spec.def;
    this.connections = [];
    this.softTakeover = null; // {time, prev, threshold} once enabled
    this.midiOutputs = [];
  }
  get param() { return toParam(this.spec, this.value); }
}
const controls = new Map();
const control = (group, key) => {
  const id = ckey(group, key);
  let c = controls.get(id);
  if (!c) { c = new Control(group, key); controls.set(id, c); }
  return c;
};

// Host (Compás) controls: changes a mapping makes to these go to the renderer.
let hostKeys = {}; // "[G],k" → 'value' | 'param'
// Nothing reaches Compás while the mapping initialises: init code often pushes
// every fader position at once (or zeros, before the device has reported), and
// the floor must never jump because a controller was plugged in.
let hostArmed = false;
const HOST_ARM_DELAY_MS = 500;

// Queued, coalesced change notification (Mixxx delivers connection callbacks
// through a queued signal, so a script's own setValue reaches its callbacks
// asynchronously, and only the latest value of a burst).
const dirty = new Set();
const forced = new Set();
const hostOut = new Map();
let flushScheduled = false;
function scheduleFlush() {
  if (flushScheduled) return;
  flushScheduled = true;
  setTimeout(flush, 0);
}
function flush() {
  flushScheduled = false;
  if (hostOut.size) {
    post({type: "host", changes: [...hostOut.values()]});
    hostOut.clear();
  }
  const batch = [...new Set([...dirty, ...forced])];
  dirty.clear(); forced.clear();
  for (const c of batch) {
    for (const conn of c.connections.slice()) {
      if (conn.connected) safely(`callback ${c.group},${c.key}`, () => conn.callback(c.value, c.group, c.key));
    }
    for (const out of c.midiOutputs) out.update(c.value);
  }
}

function softTakeoverIgnores(c, newParam) {
  const st = c.softTakeover;
  if (!st || !POT_KINDS.has(c.spec.kind)) return false;
  const now = performance.now();
  let ignore = false;
  if (st.time === 0) {
    // The first value after enabling (or after ignoreNext) would jump.
    ignore = true;
    st.time = 1;
  } else if (now - st.time > 50) {
    const diff = c.param - newParam;
    const prevDiff = c.param - st.prev;
    if ((prevDiff < 0 && diff < 0) || (prevDiff > 0 && diff > 0)) {
      if (Math.abs(diff) > st.threshold && Math.abs(prevDiff) > st.threshold) ignore = true;
    }
  }
  if (!ignore) st.time = now;
  st.prev = newParam;
  return ignore;
}

// Set a control's value. `fromScript` runs soft takeover and reports host
// controls back to Compás; host updates (fromScript=false) never echo back.
function setControl(c, value, fromScript) {
  if (typeof value === "boolean") value = value ? 1 : 0;
  value = Number(value);
  if (!Number.isFinite(value)) { log("warn", `Ignoring non-numeric value for ${c.group},${c.key}`); return; }
  if (fromScript && softTakeoverIgnores(c, toParam(c.spec, value))) return;
  if (c.value === value) return;
  c.value = value;
  dirty.add(c);
  if (c.key === "play") {
    // Mixxx keeps these in step with play; mappings light LEDs from them.
    for (const k of ["play_indicator", "play_latched"]) {
      const d = control(c.group, k);
      if (d.value !== value) { d.value = value; dirty.add(d); }
    }
  }
  if (fromScript && hostArmed) {
    const id = ckey(c.group, c.key);
    const unit = hostKeys[id];
    if (unit) hostOut.set(id, [c.group, c.key, unit === "param" ? c.param : c.value]);
  }
  scheduleFlush();
}

/* ------------------------------------------------------------------ engine */

let settings = {};
let timers = new Map();
let nextTimerId = 1;
const globalEval = (0, eval);

// Mixxx evaluates "(KEY)(args)" so `this` stays bound to KEY's owner object.
const wrapCache = new Map();
function wrapFunctionCode(code, nargs) {
  const id = `${nargs}:${code}`;
  if (!wrapCache.has(id)) {
    const args = Array.from({length: nargs}, (_v, i) => `arg${i + 1}`).join(",");
    wrapCache.set(id, globalEval(`(function (${args}) { return (${code})(${args}); })`));
  }
  return wrapCache.get(id);
}

class ScriptConnection {
  constructor(c, callback) {
    this.c = c;
    this.callback = callback;
    this.connected = true;
    c.connections.push(this);
  }
  get isConnected() { return this.connected; }
  disconnect() {
    if (!this.connected) return false;
    this.connected = false;
    this.c.connections = this.c.connections.filter((x) => x !== this);
    return true;
  }
  trigger() { if (this.connected) safely("connection trigger", () => this.callback(this.c.value, this.c.group, this.c.key)); }
}

const engine = {
  getValue: (group, key) => control(group, key).value,
  setValue: (group, key, value) => setControl(control(group, key), value, true),
  getParameter: (group, key) => control(group, key).param,
  setParameter: (group, key, p) => { const c = control(group, key); setControl(c, fromParam(c.spec, Number(p)), true); },
  getParameterForValue: (group, key, v) => toParam(control(group, key).spec, Number(v)),
  reset: (group, key) => { const c = control(group, key); setControl(c, c.spec.def, true); },
  getDefaultValue: (group, key) => control(group, key).spec.def,
  getDefaultParameter: (group, key) => { const c = control(group, key); return toParam(c.spec, c.spec.def); },
  makeConnection: (group, key, callback) => {
    if (typeof callback !== "function") { log("warn", `makeConnection(${group}, ${key}): callback is not a function`); return undefined; }
    return new ScriptConnection(control(group, key), callback);
  },
  makeUnbufferedConnection: (group, key, callback) => engine.makeConnection(group, key, callback),
  connectControl: (group, key, callback, disconnect) => {
    const c = control(group, key);
    let fn = callback;
    if (typeof callback === "string") {
      const existing = c.connections.find((x) => x.source === callback);
      if (disconnect) { if (existing) existing.disconnect(); return true; }
      if (existing) return existing;
      fn = safely(`connectControl ${callback}`, () => wrapFunctionCode(callback, 3));
      if (typeof fn !== "function") return undefined;
      const conn = new ScriptConnection(c, fn);
      conn.source = callback;
      return conn;
    }
    if (disconnect) {
      c.connections.filter((x) => x.callback === callback).forEach((x) => x.disconnect());
      return true;
    }
    return typeof fn === "function" ? new ScriptConnection(c, fn) : undefined;
  },
  trigger: (group, key) => { forced.add(control(group, key)); scheduleFlush(); },
  log: (msg) => log("debug", msg),
  getSetting: (name) => settings[name],
  beginTimer: (ms, callback, oneShot) => {
    let fn = callback;
    if (typeof callback === "string") fn = safely("beginTimer", () => globalEval(`()=>${callback}`));
    if (typeof fn !== "function") { log("error", "engine.beginTimer: invalid callback"); return 0; }
    const interval = Math.max(20, Number(ms) || 0);
    const id = nextTimerId++;
    const run = () => {
      if (oneShot) timers.delete(id);
      safely("timer", fn);
    };
    timers.set(id, oneShot ? setTimeout(run, interval) : setInterval(run, interval));
    return id;
  },
  stopTimer: (id) => {
    const t = timers.get(id);
    if (t === undefined) return;
    clearTimeout(t); clearInterval(t);
    timers.delete(id);
  },
  softTakeover: (group, key, enable) => {
    const c = control(group, key);
    if (enable) c.softTakeover = c.softTakeover || {time: 0, prev: c.param, threshold: 3 / 128};
    else if (!hostKeys[ckey(group, key)]) c.softTakeover = null; // Compás' own stay protected
  },
  softTakeoverIgnoreNextValue: (group, key) => {
    const c = control(group, key);
    if (c.softTakeover) c.softTakeover.time = 0;
  },
  // Compás has no turntable emulation: scratching, braking and spin effects
  // are accepted and ignored.
  scratchEnable: () => {},
  scratchTick: () => {},
  scratchDisable: () => {},
  isScratching: () => false,
  brake: () => {},
  spinback: () => {},
  softStart: () => {},
  getDeckRate: () => 0,
  isDeckPlaying: (group) => control(group, "play").value > 0,
  isTrackLoaded: (group) => control(group, "track_loaded").value > 0,
  stopDeck: (group) => setControl(control(group, "play"), 0, true),
};

/* -------------------------------------------------------------------- HID */

let inputReportSizes = {};
let featureReports = {};
let featureReportSizes = {};
const lastInput = new Map(); // reportId → Uint8Array (without the id)
const lastOutput = new Map(); // reportId → Uint8Array

const toBytes = (data, length) => {
  let bytes;
  if (data instanceof ArrayBuffer) bytes = new Uint8Array(data);
  else if (ArrayBuffer.isView(data)) bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  else bytes = Uint8Array.from(Array.from(data || [], (x) => Number(x) & 0xff));
  if (Number.isInteger(length) && length >= 0 && length < bytes.length) bytes = bytes.subarray(0, length);
  return new Uint8Array(bytes); // own copy, safe to transfer
};
const sameBytes = (a, b) => a && b && a.length === b.length && a.every((x, i) => x === b[i]);

// Like Mixxx: by default a report identical to the last one sent with its id
// is dropped, and a newer one may replace one still waiting to go out. With
// `fifo` (Mixxx's useNonSkippingFIFO; always for feature reports) it is sent
// as is, in order — the S4 MK3 sends both jog wheels' lights on one report id.
function sendHid(reportId, bytes, feature, fifo) {
  if (!feature) {
    const prev = lastOutput.get(reportId);
    if (!fifo && sameBytes(prev, bytes)) return;
    lastOutput.set(reportId, bytes.slice());
  }
  post({type: "hidOut", reportId: reportId & 0xff, data: bytes, feature: !!feature, fifo: !!(fifo || feature)}, [bytes.buffer]);
}

/* ------------------------------------------------------------------- MIDI */

const midiShort = (status, b1, b2) => post({type: "midiOut", data: [status & 0xff, b1 & 0x7f, b2 & 0x7f]});
const midi = {
  sendShortMsg: (status, b1, b2) => midiShort(status, b1, b2),
  sendShortMsgBuffered: (status, b1, b2) => midiShort(status, b1, b2),
  sendSysexMsg: (data, length) => {
    const bytes = Array.from(toBytes(data, length));
    post({type: "midiOut", data: bytes});
  },
};

/* ------------------------------------------------------------- controller */

const controllerObject = {
  // HID
  send: (data, length, reportId, useNonSkippingFIFO) => sendHid(Number(reportId) || 0, toBytes(data), false, !!useNonSkippingFIFO),
  sendOutputReport: (reportId, data, useNonSkippingFIFO) => sendHid(Number(reportId) || 0, toBytes(data), false, !!useNonSkippingFIFO),
  sendFeatureReport: (reportId, data) => sendHid(Number(reportId) || 0, toBytes(data), true, true),
  // WebHID cannot read a report on demand, so these answer from what the
  // device last sent (or zeros of the right size before it has sent any).
  getInputReport: (reportId) => {
    const last = lastInput.get(Number(reportId));
    const bytes = last ? last.slice() : new Uint8Array(inputReportSizes[reportId] || 64);
    return bytes.buffer;
  },
  // Read ahead by the renderer (WebHID can't read synchronously). A report the
  // device wouldn't give comes back as zeros of its declared size, or empty —
  // what Mixxx returns when the read fails.
  getFeatureReport: (reportId) => {
    const pre = featureReports[reportId];
    return (pre ? Uint8Array.from(pre) : new Uint8Array(featureReportSizes[reportId] || 0)).buffer;
  },
  // MIDI mappings call these through `midi`, a few through `controller`.
  sendShortMsg: (status, b1, b2) => midiShort(status, b1, b2),
  sendSysexMsg: (data, length) => midi.sendSysexMsg(data, length),
};

/* ------------------------------------------------------------ ColorMapper */

class ColorMapper {
  constructor(available) {
    this.entries = Object.entries(available || {}).map(([rgb, v]) => [Number(rgb), v]);
    this.cache = new Map();
  }
  getNearestColor(rgb) {
    rgb = Number(rgb);
    if (this.cache.has(rgb)) return this.cache.get(rgb);
    const r = (rgb >> 16) & 0xff, g = (rgb >> 8) & 0xff, b = rgb & 0xff;
    let best = null, bestD = Infinity;
    for (const [c, v] of this.entries) {
      const dr = r - ((c >> 16) & 0xff), dg = g - ((c >> 8) & 0xff), db = b - (c & 0xff);
      // Weighted distance, as Mixxx's ColorMapper does.
      const rm = (r + ((c >> 16) & 0xff)) / 2;
      const d = (2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db;
      if (d < bestD) { bestD = d; best = {rgb: c, value: v}; }
    }
    this.cache.set(rgb, best);
    return best;
  }
  getValueForNearestColor(rgb) {
    const n = this.getNearestColor(rgb);
    return n ? n.value : undefined;
  }
}

self.engine = engine;
self.midi = midi;
self.controller = controllerObject;
self.ColorMapper = ColorMapper;

/* ---------------------------------------------------- MIDI input mappings */

// Mixxx's potmeter conversion between a 0..127 MIDI value and a parameter.
const midiToParameter = (v) => (v > 64 ? 0.5 + (v - 64) / 126 : v / 128);
const parameterToMidi = (p) => (p > 0.5 ? 64 + (p - 0.5) * 126 : p * 128);

let midiInputs = new Map(); // (status<<8 | midino) → [mapping]
let fourteenBitQueue = [];

function computeValue(opts, prev, v) {
  if (!opts.size) return v;
  if (opts.has("invert")) return 127 - v;
  if (opts.has("rot64") || opts.has("rot64inv")) {
    let diff = v - 64;
    if (diff === -1 || diff === 1) diff /= 16; else diff += diff > 0 ? -1 : 1;
    const t = opts.has("rot64") ? prev + diff : prev - diff;
    return Math.min(127, Math.max(0, t));
  }
  if (opts.has("rot64fast")) return Math.min(127, Math.max(0, prev + (v - 64) * 1.5));
  if (opts.has("diff")) { if (v >= 64) v -= 128; v = prev + v; }
  if (opts.has("selectknob")) { if (v >= 64) v -= 128; }
  if (opts.has("button")) v = v !== 0 ? 1 : 0;
  if (opts.has("switch")) v = 1;
  if (opts.has("spread64")) v -= 64;
  if (opts.has("herc-jog")) { if (v > 64) v -= 128; v += prev; }
  if (opts.has("herc-jog-fast")) { if (v > 64) v -= 128; v = prev + v * 3; }
  return v;
}

// Mixxx's ControlObject::setValueFromMidi, by control kind.
function setFromMidi(c, opcode, v, softTakeover) {
  const kind = c.spec.kind;
  const isNote = opcode === 0x90 || opcode === 0x80;
  if (kind === "toggle" || kind === "push" || (kind === "raw" && isNote)) {
    const pressed = opcode !== 0x80 && v > 0;
    if (kind === "toggle") { if (pressed) setControl(c, c.value > 0 ? 0 : 1, true); return; }
    setControl(c, pressed ? 1 : 0, true);
    return;
  }
  const p = midiToParameter(v);
  if (softTakeover) {
    if (!c.softTakeover) c.softTakeover = {time: 0, prev: c.param, threshold: 3 / 128};
  }
  setControl(c, POT_KINDS.has(kind) ? fromParam(c.spec, p) : v, true);
}

function handleShortMidi(status, b1, b2) {
  if (status >= 0xf8) return; // clock and other real-time bytes
  const opcode = status & 0xf0;
  const channel = status & 0x0f;
  const list = midiInputs.get((status << 8) | b1);
  if (!list) return;
  for (const m of list) {
    if (m.script) {
      const fn = m.fn || (m.fn = safely(`MIDI binding ${m.key}`, () => wrapFunctionCode(m.key, 5)));
      if (typeof fn === "function") safely(`MIDI binding ${m.key}`, () => fn(channel, b1, b2, status, m.group));
      continue;
    }
    const c = control(m.group, m.key);
    let v = b2;
    const is14 = m.opts.has("fourteen-bit-msb") || m.opts.has("fourteen-bit-lsb");
    if (!is14 && fourteenBitQueue.length) fourteenBitQueue = [];
    if (is14) {
      const i = fourteenBitQueue.findIndex((q) => q.m.group === m.group && q.m.key === m.key);
      if (i < 0) { fourteenBitQueue.push({m, v: b2}); continue; }
      const q = fourteenBitQueue.splice(i, 1)[0];
      const iv = m.opts.has("fourteen-bit-msb") ? (b2 << 7) | q.v : (q.v << 7) | b2;
      v = Math.min(127, iv / 128);
    } else if (opcode === 0xe0) {
      v = Math.min(127, ((b2 << 7) | b1) / 128);
    } else {
      v = computeValue(m.opts, parameterToMidi(c.param), b2);
    }
    const op = m.opts.has("button") || m.opts.has("switch") ? 0x90 : opcode;
    setFromMidi(c, op, v, m.opts.has("soft-takeover"));
  }
}

function setupMidi(config) {
  midiInputs = new Map();
  for (const m of (config && config.controls) || []) {
    const opts = new Set((m.options || []).map((o) => String(o).toLowerCase()).filter((o) => o !== "normal"));
    const entry = {group: m.group, key: m.key, script: opts.has("script-binding"), opts};
    opts.delete("script-binding");
    const id = ((m.status & 0xff) << 8) | (m.midino & 0xff);
    if (!midiInputs.has(id)) midiInputs.set(id, []);
    midiInputs.get(id).push(entry);
  }
  for (const o of (config && config.outputs) || []) {
    const c = control(o.group, o.key);
    let last = null;
    const out = {
      update(value) {
        const byte = value >= o.min && value <= o.max ? o.on : o.off;
        if (byte === last || byte === 0xff) return; // 0xFF means "send nothing"
        last = byte;
        midiShort(o.status, o.midino, byte);
      },
    };
    c.midiOutputs.push(out);
  }
}

/* -------------------------------------------------------- start and stop */

let prefixes = [];
let incomingData = [];
let running = false;

function callOnPrefixes(name, args) {
  for (const prefix of prefixes) {
    const fn = safely(`${prefix}.${name}`, () => {
      const obj = globalEval(prefix);
      return obj && typeof obj[name] === "function" ? obj[name].bind(obj) : null;
    });
    if (fn) safely(`${prefix}.${name}`, () => fn(...args));
  }
}

function start(msg) {
  settings = msg.settings || {};
  hostKeys = (msg.host && msg.host.keys) || {};
  inputReportSizes = msg.inputReportSizes || {};
  featureReports = msg.featureReports || {};
  featureReportSizes = msg.featureReportSizes || {};
  for (const [g, k, v] of (msg.host && msg.host.state) || []) {
    const unit = hostKeys[ckey(g, k)];
    const c = control(g, k);
    c.value = unit === "param" ? fromParam(c.spec, v) : v;
  }
  setupMidi(msg.midi);
  // Compás' own faders and knobs always use soft takeover, whatever the
  // mapping asks for: the hardware has to pass through the current level
  // before it takes over, so a fader left at zero can't silence the floor.
  for (const id of Object.keys(hostKeys)) {
    const [g, k] = [id.slice(0, id.indexOf("],") + 1), id.slice(id.indexOf("],") + 2)];
    engine.softTakeover(g, k, true);
  }

  const load = (code) => {
    const url = URL.createObjectURL(new Blob([code], {type: "text/javascript"}));
    try { importScripts(url); } finally { URL.revokeObjectURL(url); }
  };
  for (const s of msg.scripts) {
    const tag = `\n//# sourceURL=mixxx/${s.name}`;
    try {
      try {
        load(s.source + tag);
      } catch (e) {
        // Mixxx evaluates each file on its own, so a mapping may declare with
        // class/let/const a name an earlier file made with var (the S4 MK3's
        // `class Button` against common-controller-scripts' `var Button`).
        // Browsers refuse that across scripts, before running any of it. In a
        // block, the file's own class/let/const names stay its own, while its
        // vars and functions (the mapping object Compás calls) are still global.
        if (!(e && e.name === "SyntaxError" && /already been declared/.test(e.message))) throw e;
        load(`{\n${s.source}\n}${tag}`);
      }
    } catch (e) {
      post({type: "failed", message: `${s.name}: ${e && e.message ? e.message : e}`});
      return;
    }
  }

  prefixes = (msg.prefixes || []).filter((p) => /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/.test(p));
  incomingData = prefixes
    .map((p) => safely(`${p}.incomingData`, () => {
      const obj = globalEval(p);
      return obj && typeof obj.incomingData === "function" ? wrapFunctionCode(`${p}.incomingData`, 2) : null;
    }))
    .filter(Boolean);

  callOnPrefixes("init", [msg.name || "", false]);
  running = true;
  setTimeout(() => { hostArmed = true; }, HOST_ARM_DELAY_MS);
  // Light the controller to match Compás' current state.
  for (const c of controls.values()) if (c.midiOutputs.length) forced.add(c);
  scheduleFlush();
  post({type: "started"});
}

function stop() {
  hostArmed = false;
  if (running) callOnPrefixes("shutdown", []);
  running = false;
  for (const id of [...timers.keys()]) engine.stopTimer(id);
  flush();
  post({type: "stopped"});
}

self.onmessage = (e) => {
  const msg = e.data || {};
  switch (msg.type) {
    case "start":
      safely("start", () => start(msg));
      break;
    case "hid": {
      if (!running) return;
      const data = msg.data instanceof Uint8Array ? msg.data : new Uint8Array(msg.data || []);
      const id = msg.reportId | 0;
      lastInput.set(id, data.slice());
      // Mixxx hands scripts the report with its id as the first byte.
      let packet = data;
      if (id !== 0) { packet = new Uint8Array(data.length + 1); packet[0] = id; packet.set(data, 1); }
      for (const fn of incomingData) safely("incomingData", () => fn(packet, packet.length));
      break;
    }
    case "midi": {
      if (!running) return;
      const d = msg.data || [];
      if (d[0] === 0xf0) {
        const bytes = Uint8Array.from(d);
        for (const fn of incomingData) safely("incomingData", () => fn(bytes, bytes.length));
      } else if (d.length) {
        handleShortMidi(d[0], d[1] || 0, d[2] || 0);
      }
      break;
    }
    case "host":
      for (const [g, k, v] of msg.changes || []) {
        const c = control(g, k);
        const unit = hostKeys[ckey(g, k)];
        setControl(c, unit === "param" ? fromParam(c.spec, Number(v)) : Number(v), false);
      }
      break;
    case "stop":
      safely("stop", stop);
      break;
    default:
      break;
  }
};
})();
