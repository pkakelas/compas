// app-player.jsx — Compás, the single-page live player (desktop)
// Left: choose tandas & cortinas to play next · Right: tonight's queue · Bottom: transport
// Audio is real: each song streams from compas-audio://song/<id> through Howler.
const { useState, useRef, useMemo, useEffect, useCallback } = React;

let _kid = 100;
const kid = () => "q" + (_kid++);
const mk = (type, data) => ({ key: kid(), type, data });

const FADE_TO_TANDA_MS = 2500;   // fallback fade when no preference is set

/* ---------- sound leveling (loudness + silence trim) ----------
   Both derive from the raw per-song measurements stored by the background
   analysis pass (loudnessLufs, content{Start,End}Samples, sampleRate). Gain and
   trim are computed here at playback time so the target/pad settings can change
   without re-analyzing anything. */

// Per-song volume multiplier (0..1) to pull a song toward the target loudness.
// The live engine uses Howler's html5 mode, whose <audio> volume can't exceed
// 1.0 — so we attenuate loud songs toward the target and leave quiet ones alone
// (the DJ raises the master to compensate). No measurement → no change.
function gainForSong(song, s) {
  if (!s || !s.normalizeEnabled) return 1;
  const lufs = song && typeof song.loudnessLufs === "number" ? song.loudnessLufs : null;
  if (lufs == null) return 1;
  const gainDb = Math.min(0, (s.targetLufs || -18) - lufs);
  return Math.max(0, Math.min(1, Math.pow(10, gainDb / 20)));
}

// Content onset/offset in seconds (with a small safety pad), derived from the
// detected silence boundaries. Falls back to the whole file when there's no
// measurement or trimming is off. Never returns an inverted range.
function trimBoundsSec(song, s, realDur) {
  const out = { startSec: 0, endSec: realDur || 0 };
  if (!s || !s.trimSilenceEnabled || !song || !song.sampleRate) return out;
  // Live-set only unless the DJ opted into applying it to library previews too.
  if (s.preview && !s.trimEverywhere) return out;
  const sr = song.sampleRate;
  const pad = (s.trimPadMs || 30) / 1000;
  if (typeof song.contentStartSamples === "number" && song.contentStartSamples > 0) {
    out.startSec = Math.max(0, song.contentStartSamples / sr - pad);
  }
  if (typeof song.contentEndSamples === "number" && song.contentEndSamples > 0) {
    const e = song.contentEndSamples / sr + pad;
    if (!realDur || e < realDur) out.endSec = e;
  }
  if (!(out.endSec > out.startSec)) { out.startSec = 0; out.endSec = realDur || 0; }
  return out;
}

/* ---------- live-state persistence ----------
   The live queue (and which item/song is "now") is the DJ's working set, so it
   survives an app restart. We keep the whole serialized queue in localStorage —
   items already carry their full tanda/cortina/song data, so a reload doesn't
   depend on the library being identical. Playback always resumes paused. */
const LIVE_PERSIST_KEY = "compas.live.v1";
function loadLiveState() {
  try {
    const raw = localStorage.getItem(LIVE_PERSIST_KEY);
    if (!raw) return {};
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.queue)) return {};
    // Restored keys came from a previous session's counter; advance _kid past
    // the highest so newly added items can never collide with restored ones.
    let max = 0;
    data.queue.forEach((it) => {
      const n = it && typeof it.key === "string" ? parseInt(it.key.slice(1), 10) : NaN;
      if (Number.isFinite(n) && n > max) max = n;
    });
    if (max >= _kid) _kid = max + 1;
    return data;
  } catch (_e) {
    return {};
  }
}

/* ---------- audio output routing ---------- */
// Route an <audio> element (raw, or Howler's internal html5 node) to a specific
// output card. Empty id falls back to the system default. Wrapped because
// setSinkId rejects on unknown ids (e.g. a card that was just unplugged).
function applySinkId(node, deviceId) {
  if (!node || typeof node.setSinkId !== "function") return;
  try { node.setSinkId(deviceId || "default").catch(() => {}); } catch (_e) { /* unsupported */ }
}
// Howler keeps its html5 <audio> on the first pooled sound. Reach in so the live
// engine can target the main output without abandoning Howler's crossfade logic.
function howlNode(howl) {
  return howl && howl._sounds && howl._sounds[0] ? howl._sounds[0]._node : null;
}

/* ---------- queue helpers ---------- */
// A queue item is either a tanda (data.songs[]) or a single song (data IS the
// song). A single song is rendered/behaves as a *cortina* only when it plays
// that role — see actsAsCortina — otherwise it's just a song.
function songOf(item, ix) {
  if (!item) return null;
  if (item.type === "tanda") {
    const songs = (item.data && item.data.songs) || [];
    return songs[ix] || null;
  }
  return item.data || null;
}
function itemSongs(item) {
  if (!item) return [];
  return item.type === "tanda" ? ((item.data && item.data.songs) || []) : [item.data];
}
// Songs a DJ marks "skip" stay in the tanda but are passed over during live
// playback. These find the next song that should actually play.
function nextLiveSong(songs, from) {
  for (let i = Math.max(0, from); i < songs.length; i++) if (!songs[i].skip) return i;
  return -1;
}
// First song index a queue item should start on (skipping over skipped tracks).
// Non-tanda items always play, so they start at 0. A tanda whose songs are all
// skipped returns -1 — the whole item is then passed over.
function firstLiveSong(item) {
  if (!item) return -1;
  if (item.type !== "tanda") return 0;
  return nextLiveSong((item.data && item.data.songs) || [], 0);
}

// Does the single-song item at `index` play the cortina role? Yes if and only if
// it sits directly between two tandas (the item immediately before AND after it
// are both tandas) — a lone song bridging two tandas is a cortina. The song's
// own isCortina flag does NOT make it act as a cortina here: a flagged cortina
// played on its own (or not wrapped by tandas) still presents as a plain song.
// Two or more songs between tandas are just songs (none is the single
// floor-clearing bridge). Tandas themselves are never cortinas. Drives both the
// curtain presentation and the floor-clearing behaviours (snippet auto-fade,
// "fade to next tanda").
function actsAsCortina(queue, index) {
  const item = queue[index];
  if (!item || item.type === "tanda") return false;
  const prev = queue[index - 1];
  const next = queue[index + 1];
  return !!(prev && prev.type === "tanda" && next && next.type === "tanda");
}
function queueDurationSec(queue) {
  return queue.reduce((a, it) => a + itemSongs(it).reduce((b, s) => b + (s.durationSec || secOf(s.dur)), 0), 0);
}

/* ============================ LIBRARY (left) ============================ */

function LibPlaylistCard({ pl, added, onAdd }) {
  const tandaCount = pl.items.filter((i) => i.type === "tanda").length;
  // Count single songs as cortinas only when they play that role.
  const cortinaCount = pl.items.filter((it, i) => it.type !== "tanda" && actsAsCortina(pl.items, i)).length;
  const total = fmtDur(queueDurationSec(pl.items));
  return (
    <div className="tp-libcard">
      <div className="tp-libcard-main">
        <div className="tp-libcard-top">
          <span className="tp-libcard-orq">{pl.name || "Untitled playlist"}</span>
          <span className="tp-tag is-plain sm">Playlist</span>
        </div>
        <div className="tp-libcard-songs">
          {pl.items.map((it, i) => (
            <span key={i} className="tp-libsong">
              {it.type === "cortina" ? "“" + it.data.title + "”" : (it.data.name || tandaMeta(it.data).orq)}
              {i < pl.items.length - 1 ? <span className="tp-dotsep">·</span> : null}
            </span>
          ))}
        </div>
        <div className="tp-libcard-meta">
          {tandaCount} {tandaCount === 1 ? "tanda" : "tandas"}
          {cortinaCount > 0 ? ` · ${cortinaCount} ${cortinaCount === 1 ? "cortina" : "cortinas"}` : ""}
          <span className="tp-dotsep">·</span><span className="tp-mono">{total}</span>
        </div>
      </div>
      <button className={"tp-addbtn" + (added ? " is-added" : "")} onClick={onAdd} title="Add playlist to queue">
        {added ? <I.check s={16} /> : <I.plus s={16} />}
      </button>
    </div>
  );
}

const EMPTY_SET = new Set();

// A flagged cortina song in the Live "Cortinas" picker: audition on click, drag
// to drop at a spot, or tap + to append. Added as a single-song item that —
// because the song is flagged isCortina — renders as a cortina in the queue.
function LibCortinaRow({ c, added, onAdd, preview, makeDrag, draggingId }) {
  const playing = preview && preview.previewId === c.id && preview.playing;
  const drag = makeDrag ? makeDrag(c) : {};
  return (
    <div className={"tp-cortrow" + (draggingId === c.id ? " is-dragging" : "")} {...drag}
      onClick={preview ? () => preview.toggle(c) : undefined}
      title={previewTitle(preview, playing, "Audition this cortina")}>
      <span className="tp-cortrow-ic">{playing ? <EQ /> : (preview && preview.viaMonitor ? <span className="tp-cuebadge"><I.headphones s={14} /></span> : <I.curtain s={15} />)}</span>
      <div className="tp-flex1">
        <div className="tp-cortrow-title">{c.title}</div>
        <div className="tp-cortrow-meta">{c.orq || "Cortina"}<span className="tp-dotsep">·</span><span className="tp-mono">{c.dur}</span></div>
      </div>
      <button className={"tp-addbtn sm" + (added ? " is-added" : "")} onClick={(e) => { e.stopPropagation(); onAdd(); }} title="Add cortina to queue">
        {added ? <I.check s={15} /> : <I.plus s={15} />}
      </button>
    </div>
  );
}

function LibraryPanel({ tandas, cortinas, playlists, onAddTanda, onAddSong, onAddPlaylist, makeDrag, draggingId, preview, flash }) {
  const [tab, setTab] = useState("tandas");
  const [genre, setGenre] = useState("all");
  const [q, setQ] = useState("");

  const filteredTandas = useMemo(() => tandas.filter((t) => {
    const m = tandaMeta(t);
    const hay = ((t.name || "") + " " + m.orq + " " + m.singer + " " + t.songs.map((s) => s.title).join(" ")).toLowerCase();
    return (genre === "all" || tandaTypes(t).includes(genre)) && (q.trim() === "" || hay.includes(q.toLowerCase()));
  }), [tandas, genre, q]);

  const filteredPlaylists = useMemo(() => playlists.filter((p) => {
    const hay = ((p.name || "") + " " + p.items.map((it) =>
      it.type === "cortina" ? it.data.title : (it.data.name || tandaMeta(it.data).orq)).join(" ")).toLowerCase();
    return q.trim() === "" || hay.includes(q.toLowerCase());
  }), [playlists, q]);

  const filteredCortinas = useMemo(() => (cortinas || []).filter((c) => {
    const hay = ((c.title || "") + " " + (c.orq || "") + " " + (c.folder || "")).toLowerCase();
    return q.trim() === "" || hay.includes(q.toLowerCase());
  }), [cortinas, q]);

  const placeholder = tab === "tandas" ? "Search orchestras, singers, titles…"
    : tab === "cortinas" ? "Search cortinas…" : "Search playlists…";

  return (
    <div className="tp-lib">
      <div className="tp-lib-head">
        <div className="tv-title">Add to queue</div>
        <div className="tp-tabs">
          <button className={"tp-tab" + (tab === "tandas" ? " is-on" : "")} onClick={() => setTab("tandas")}>Tandas</button>
          <button className={"tp-tab" + (tab === "cortinas" ? " is-on" : "")} onClick={() => setTab("cortinas")}>Cortinas</button>
          <button className={"tp-tab" + (tab === "library" ? " is-on" : "")} onClick={() => setTab("library")}>Songs</button>
          <button className={"tp-tab" + (tab === "playlists" ? " is-on" : "")} onClick={() => setTab("playlists")}>Playlists</button>
        </div>
      </div>

      {tab === "library" ? (
        // The same folders+songs tree used by the Tandas builder. Tapping + on a
        // song appends it to the queue; dragging it drops it at an exact spot.
        <LibraryTree builderIds={EMPTY_SET} onAdd={onAddSong} makeDrag={makeDrag}
          draggingId={draggingId} preview={preview} hint="Drag a song into the queue, or tap +" />
      ) : (
        <React.Fragment>
          <div className="tp-lib-controls">
            <label className="tp-search">
              <I.search s={16} />
              <input value={q} onChange={e => setQ(e.target.value)} placeholder={placeholder} />
            </label>
            {tab === "tandas" && (
              <div className="tp-filters">
                {["all", "tango", "vals", "milonga"].map(g => (
                  <button key={g} className={"tp-filter" + (genre === g ? " is-on" : "")} onClick={() => setGenre(g)}>
                    {g === "all" ? "All" : GENRE_LABEL[g]}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="tp-lib-scroll">
            {tab === "tandas" && filteredTandas.map((t) => (
              <TandaLibCard key={t.id} t={t} preview={preview} added={flash === "t:" + t.id}
                onAdd={() => onAddTanda(t)} addTitle="Add tanda to queue" />
            ))}
            {tab === "cortinas" && filteredCortinas.map((c) => (
              <LibCortinaRow key={c.id} c={c} added={flash === "c:" + c.id} onAdd={() => onAddSong(c)}
                preview={preview} makeDrag={makeDrag} draggingId={draggingId} />
            ))}
            {tab === "playlists" && filteredPlaylists.map((p) => (
              <LibPlaylistCard key={p.id} pl={p} added={flash === "p:" + p.id} onAdd={() => onAddPlaylist(p)} />
            ))}
            {tab === "tandas" && filteredTandas.length === 0 && (
              <div className="tp-empty">{tandas.length ? "No tandas match." : "No tandas yet — build some in the Tandas view."}</div>
            )}
            {tab === "cortinas" && filteredCortinas.length === 0 && (
              <div className="tp-empty">{(cortinas && cortinas.length) ? "No cortinas match." : "No cortinas yet — flag a song or folder as a cortina (in the Library or a song’s editor)."}</div>
            )}
            {tab === "playlists" && filteredPlaylists.length === 0 && (
              <div className="tp-empty">{playlists.length ? "No playlists match." : "No playlists yet — build one in the Playlists view."}</div>
            )}
          </div>
        </React.Fragment>
      )}
    </div>
  );
}

/* ============================ QUEUE (right) ============================ */

const LIVE_QUEUE_MIN_W = 360;
const LIVE_QUEUE_MAX_W = 900;

/* Draggable divider between the library and the queue — mirrors the Tandas
 * builder's BuilderResizer. The queue is pinned right, so dragging left widens
 * it; width is clamped and committed (persisted) on release. */
function QueueResizer({ width, min, max, onResize, onCommit }) {
  const start = (e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = width;
    let last = startW;
    const move = (ev) => {
      last = Math.max(min, Math.min(max, startW - (ev.clientX - startX)));
      onResize(last);
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      if (onCommit) onCommit(last);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };
  return (
    <div className="tv-resizer" onMouseDown={start} title="Drag to resize the queue">
      <span className="grip" />
    </div>
  );
}

function QSong({ n, title, dur, state, playing, skip, onPlay, onSkip }) {
  const isNow = state === "now";
  return (
    <div className={"tp-songrow" + (isNow ? " is-now" : "") + (state === "done" ? " is-done" : "") + (skip ? " is-skip" : "") + (onPlay ? " is-clickable" : "")}
      onClick={onPlay ? (e) => { e.stopPropagation(); onPlay(); } : undefined}
      {...(onPlay ? clickKeys(onPlay) : {})}
      title={onPlay ? "Play this song" : undefined}>
      <span className="n">{isNow && playing ? <EQ /> : <><span className="qn">{n}</span><I.play s={12} /></>}</span>
      <span className="tt"><div className="tp-song-title">{title}</div></span>
      <span className="tp-song-dur">{dur}</span>
      {onSkip && (
        <button className={"tp-song-skip" + (skip ? " is-on" : "")} disabled={isNow}
          onClick={(e) => { e.stopPropagation(); if (!isNow) onSkip(); }}
          title={isNow ? "Can’t skip the song that’s playing" : skip ? "Play this song" : "Skip this song"}>
          <I.skip s={13} />
        </button>
      )}
    </div>
  );
}

function QueueTanda({ item, ix, now, playing, nowIx, onPlay, onPlaySong, onSkipSong, onRemove, drag }) {
  const t = item.data;
  const m = tandaMeta(t);
  const songNameOnly = useSongNameOnly();
  const [collapsed, setCollapsed] = useState(false);
  const { className: dragCls = "", ...handlers } = drag;
  return (
    <div className={"tp-tandacard tp-qrow" + (now ? " is-now" : "") + (collapsed ? " is-collapsed" : "") + " " + dragCls} {...handlers}
      onClick={onPlay}>
      <div className="tp-tanda-head">
        {!now && <span className="tp-grip" title="Drag to reorder"><I.grip s={15} /></span>}
        <button className={"tp-tanda-caret" + (collapsed ? "" : " is-open")} title={collapsed ? "Show songs" : "Hide songs"}
          aria-expanded={!collapsed} onClick={(e) => { e.stopPropagation(); setCollapsed((c) => !c); }}>
          <I.chev s={13} />
        </button>
        {now && <span className="ix">NOW</span>}
        <span className="tp-now-orq" style={{ flex: 1 }}>{t.name || m.orq}</span>
        <GenreTag genre={m.genre} small />
        {m.year && <span className="tp-tag is-plain sm" title={m.era}>{m.year}</span>}
        {!now && <button className="tp-qx" onClick={(e) => { e.stopPropagation(); onRemove(); }} title="Remove"><I.x s={14} /></button>}
      </div>
      {collapsed
        ? <div className="tp-tanda-collapsed" onClick={(e) => { e.stopPropagation(); setCollapsed(false); }}>
            {t.songs.length} {t.songs.length === 1 ? "song" : "songs"}<span className="tp-dotsep">·</span><span className="tp-mono">{m.total}</span>
          </div>
        : t.songs.map((s, i) => (
            <QSong key={s.id} n={i + 1} title={songNameOnly ? cleanSongTitle(s) : s.title} dur={s.dur || "—"}
              state={now ? (i < nowIx ? "done" : i === nowIx ? "now" : "up") : "up"}
              playing={playing} skip={!!s.skip}
              onPlay={() => onPlaySong(i)} onSkip={() => onSkipSong(i)} />
          ))}
    </div>
  );
}

function QueueCortina({ item, now, playing, onPlay, onRemove, drag }) {
  const c = item.data;
  const { className: dragCls = "", ...handlers } = drag;
  return (
    <div className={"tp-cortina tp-qrow" + (now ? " is-now" : "") + " " + dragCls} {...handlers}
      onClick={onPlay}>
      <div className="curtain"></div>
      <span className="tp-grip dark" title="Drag to reorder"><I.grip s={15} /></span>
      <I.curtain s={17} />
      <div className="tp-flex1">
        <div className="tp-cortina-label">{now ? (playing ? "Cortina · playing" : "Cortina · paused") : "Cortina"}</div>
        <div className="tp-cortina-sub">“{c.title}” · {c.orq || "Cortina"}</div>
      </div>
      <div className="tp-fade">{now && playing ? <EQ /> : <I.clock s={13} />} {c.dur}</div>
      <button className="tp-qx dark" onClick={(e) => { e.stopPropagation(); onRemove(); }} title="Remove"><I.x s={14} /></button>
    </div>
  );
}

// A single song in the queue that is NOT acting as a cortina (it's not between
// tandas, e.g. an opener, an intro, or a one-off request). Rendered as a plain
// track card — no curtain, no "floor clears" language.
function QueueSong({ item, now, playing, onPlay, onRemove, drag }) {
  const s = item.data;
  const songNameOnly = useSongNameOnly();
  const { className: dragCls = "", ...handlers } = drag;
  return (
    <div className={"tp-songcard tp-qrow" + (now ? " is-now" : "") + " " + dragCls} {...handlers}
      onClick={onPlay}>
      <span className="tp-grip" title="Drag to reorder"><I.grip s={15} /></span>
      <span className="tp-songcard-glyph">{now && playing ? <EQ /> : <I.note s={15} />}</span>
      <div className="tp-flex1">
        <div className="tp-songcard-title">{songNameOnly ? cleanSongTitle(s) : s.title}</div>
        <div className="tp-songcard-sub">{s.orq || "Unknown"}{s.singer ? " · " + s.singer : ""}</div>
      </div>
      <div className="tp-fade"><I.clock s={13} /> {s.dur || "—"}</div>
      {!now && <button className="tp-qx" onClick={(e) => { e.stopPropagation(); onRemove(); }} title="Remove"><I.x s={14} /></button>}
    </div>
  );
}

// Shown between two tandas that have no cortina between them. A cortina isn't
// required, but a DJ usually wants one to clear the floor, so we flag the gap.
function MissingCortinaHint() {
  return (
    <div className="tp-nocort" title="No cortina between these tandas">
      <span className="tp-nocort-line" />
      <span className="tp-nocort-tag"><I.curtain s={13} /> No cortina</span>
      <span className="tp-nocort-line" />
    </div>
  );
}

// A friendly default name so the DJ can just hit Save: "Set · Jun 4".
function defaultPlaylistName() {
  const d = new Date();
  return `Set · ${d.toLocaleString("en-US", { month: "short" })} ${d.getDate()}`;
}

function QueuePanel({ queue, nowKey, nowIx, now, playing, pos, width, onPlay, onPlaySongAt, onSkipSong, onRemove, onReorder, onInsertSong, onSavePlaylist, onClearQueue }) {
  const dragKey = useRef(null);              // set while reordering an existing queue item
  const [overKey, setOverKey] = useState(null);
  const [overEnd, setOverEnd] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [savingNow, setSavingNow] = useState(false);
  const saveInputRef = useRef(null);
  const scrollRef = useRef(null);
  const autoScroll = useRef({ raf: 0, dir: 0, speed: 0 });
  const { toast, flash, dismiss } = useToast();
  const { ask, modal } = useConfirm();
  const tandaCount = queue.filter(i => i.type === "tanda").length;
  const setTotal = fmtDur(queueDurationSec(queue));

  const openSave = () => { setSaveName(defaultPlaylistName()); setSaveOpen(true); };
  const closeSave = () => { setSaveOpen(false); setSavingNow(false); };
  useEffect(() => {
    if (saveOpen && saveInputRef.current) { saveInputRef.current.focus(); saveInputRef.current.select(); }
  }, [saveOpen]);
  // Close the namer if the queue empties out from under it.
  useEffect(() => { if (!queue.length && saveOpen) closeSave(); }, [queue.length]); // eslint-disable-line

  // Keep the now-playing item in view as playback advances — like VLC, the list
  // follows along so the DJ always sees what's on air and what's coming up. We
  // park it a little below the top so a tanda of context stays visible above.
  // Since every view stays mounted (hidden via display:none), a tanda can advance
  // while the Live tab is off-screen — where there's no layout to scroll. So we
  // also re-run when the panel regains layout (the DJ flips back to Live).
  const wasHidden = useRef(true);
  useEffect(() => {
    const box = scrollRef.current;
    if (!box) return;
    const scrollToNow = () => {
      if (!nowKey || !box.clientHeight) return;
      const el = box.querySelector(".is-now");
      if (!el) return;
      const top = box.scrollTop + (el.getBoundingClientRect().top - box.getBoundingClientRect().top) - 24;
      box.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
    };
    if (box.clientHeight) { scrollToNow(); wasHidden.current = false; }
    const ro = new ResizeObserver(() => {
      const visible = box.clientHeight > 0;
      if (visible && wasHidden.current) scrollToNow();
      wasHidden.current = !visible;
    });
    ro.observe(box);
    return () => ro.disconnect();
  }, [nowKey]);

  const handleClear = () => {
    if (!queue.length) return;
    ask({
      title: "Clear the queue?",
      message: `${tandaCount} ${tandaCount === 1 ? "tanda" : "tandas"} and the rest of the set will be removed. Your library and playlists aren't affected.`,
      confirmLabel: "Clear queue",
      onConfirm: () => { onClearQueue(); flash("Queue cleared"); },
    });
  };

  const commitSave = () => {
    if (savingNow || !queue.length) return;
    setSavingNow(true);
    Promise.resolve(onSavePlaylist(saveName))
      .then(() => { closeSave(); flash("Saved to Playlists"); })
      .catch(() => { setSavingNow(false); flash("Couldn’t save playlist"); });
  };

  // Edge auto-scroll while dragging: native HTML5 drag doesn't scroll the list,
  // so without this you can't drag an item further than one screenful (e.g. a
  // tanda from the bottom up past several earlier tandas). When the cursor nears
  // the top/bottom edge of the scroll box we scroll it via a RAF loop, faster the
  // closer the cursor is to the edge.
  const stopAutoScroll = () => {
    if (autoScroll.current.raf) cancelAnimationFrame(autoScroll.current.raf);
    autoScroll.current.raf = 0;
    autoScroll.current.dir = 0;
  };
  const stepAutoScroll = () => {
    const box = scrollRef.current, a = autoScroll.current;
    if (!box || !a.dir) { a.raf = 0; return; }
    box.scrollTop += a.dir * a.speed;
    a.raf = requestAnimationFrame(stepAutoScroll);
  };
  const updateAutoScroll = (clientY) => {
    const box = scrollRef.current;
    if (!box) return;
    const r = box.getBoundingClientRect();
    const EDGE = 64, MAX = 20, a = autoScroll.current;
    if (clientY < r.top + EDGE && box.scrollTop > 0) {
      a.dir = -1; a.speed = Math.ceil((r.top + EDGE - clientY) / EDGE * MAX);
    } else if (clientY > r.bottom - EDGE && box.scrollTop + box.clientHeight < box.scrollHeight) {
      a.dir = 1; a.speed = Math.ceil((clientY - (r.bottom - EDGE)) / EDGE * MAX);
    } else {
      stopAutoScroll(); return;
    }
    if (!a.raf) a.raf = requestAnimationFrame(stepAutoScroll);
  };
  useEffect(() => stopAutoScroll, []);

  const clearDrag = () => { stopAutoScroll(); dragKey.current = null; setOverKey(null); setOverEnd(false); };

  // A drop is either an internal reorder (dragKey set, no transfer data) or a
  // song dragged in from the library tree (transfer data "song:<id>"). beforeKey
  // is the queue item to insert in front of; null means append to the end.
  const handleDrop = (e, beforeKey) => {
    e.preventDefault();
    const raw = e.dataTransfer.getData("text/plain") || "";
    if (raw.indexOf("song:") === 0) {
      const s = Store.songById(raw.slice(5));
      if (s) onInsertSong(s, beforeKey);
    } else if (dragKey.current && beforeKey && dragKey.current !== beforeKey) {
      onReorder(dragKey.current, beforeKey);
    }
    clearDrag();
  };

  const dragProps = (item) => {
    return {
      draggable: true,
      onDragStart: (e) => { dragKey.current = item.key; e.dataTransfer.effectAllowed = "move"; },
      onDragEnd: clearDrag,
      onDragOver: (e) => { e.preventDefault(); if (overKey !== item.key) setOverKey(item.key); if (overEnd) setOverEnd(false); },
      onDrop: (e) => { e.stopPropagation(); handleDrop(e, item.key); },
      className: "tp-qdrag" + (overKey === item.key && dragKey.current !== item.key ? " is-over" : "") + (dragKey.current === item.key ? " is-dragging" : ""),
    };
  };

  // Whole-list drop zone: appends. Item rows stop propagation so an on-item drop
  // inserts in place instead of bubbling here.
  const listDrop = {
    onDragOver: (e) => { e.preventDefault(); updateAutoScroll(e.clientY); if (e.target === e.currentTarget && !overEnd) setOverEnd(true); },
    onDrop: (e) => handleDrop(e, null),
    onDragLeave: (e) => { if (!e.currentTarget.contains(e.relatedTarget)) clearDrag(); },
  };

  let tIx = 0;
  return (
    <div className="tp-queue" style={width ? { flex: `0 0 ${width}px`, width } : undefined}>
      <div className="tp-qhead">
        <div className="tp-qhead-l">
          <div className="tv-title">Queue</div>
        </div>
        <div className="tp-qhead-r">
          <div className="tp-q-stat">
            <span><b>{tandaCount}</b> tandas queued</span>
            <span className="tp-dotsep">·</span>
            <span className="tp-mono">set {setTotal}</span>
          </div>
          <div className="tp-qhead-btns">
            <button className="tp-savepl" onClick={openSave} disabled={!queue.length || saveOpen}
              title={queue.length ? "Save this set as a playlist" : "Add tandas to save a playlist"}>
              <I.plus s={14} /> Save as playlist
            </button>
            <button className="tp-clearq" onClick={handleClear} disabled={!queue.length}
              title={queue.length ? "Clear the whole queue" : "Queue is already empty"}>
              <I.trash s={14} /> Clear queue
            </button>
          </div>
        </div>
      </div>

      {saveOpen && (
        <div className="tp-qsave">
          <label className="tp-qsave-field">
            <span className="tp-qsave-eyebrow">Playlist name</span>
            <input ref={saveInputRef} value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitSave();
                else if (e.key === "Escape") closeSave();
              }}
              placeholder="Name this set…" />
          </label>
          <button className="tp-btn primary" onClick={commitSave} disabled={savingNow}>
            <I.check s={15} /> {savingNow ? "Saving…" : "Save"}
          </button>
          <button className="tp-btn ghost" onClick={closeSave}>Cancel</button>
        </div>
      )}

      <div ref={scrollRef} className={"tp-q-scroll" + (overEnd ? " drop-end" : "")} {...listDrop}>
        {queue.map((item, i) => {
          if (item.type === "tanda") tIx += 1;
          const dp = dragProps(item);
          const isNow = item.key === nowKey;
          const prev = queue[i - 1];
          const gap = item.type === "tanda" && prev && prev.type === "tanda";
          // A single song shows as a cortina only when it plays that role
          // (between tandas, or flagged cortina material); otherwise it's a song.
          const role = item.type === "tanda" ? "tanda" : (actsAsCortina(queue, i) ? "cortina" : "song");
          const row = role === "tanda"
            ? <QueueTanda key={item.key} item={item} ix={tIx} now={isNow} playing={playing} nowIx={isNow ? nowIx : 0} onPlay={() => onPlay(item.key)} onPlaySong={(ix) => onPlaySongAt(item.key, ix)} onSkipSong={(ix) => onSkipSong(item.key, ix)} onRemove={() => onRemove(item.key)} drag={dp} />
            : role === "cortina"
              ? <QueueCortina key={item.key} item={item} now={isNow} playing={playing} onPlay={() => onPlay(item.key)} onRemove={() => onRemove(item.key)} drag={dp} />
              : <QueueSong key={item.key} item={item} now={isNow} playing={playing} onPlay={() => onPlay(item.key)} onRemove={() => onRemove(item.key)} drag={dp} />;
          return gap
            ? <React.Fragment key={item.key}><MissingCortinaHint />{row}</React.Fragment>
            : row;
        })}
        <div className="tp-q-end"
          onDragOver={(e) => { e.preventDefault(); if (!overEnd) setOverEnd(true); setOverKey(null); }}
          onDrop={(e) => { e.stopPropagation(); handleDrop(e, null); }}>
          {queue.length ? "End of queue — drag songs here, or add from the left" : "Empty queue — add tandas & cortinas from the left"}
        </div>
      </div>
      <Toast toast={toast} onDismiss={dismiss} />
      {modal}
    </div>
  );
}

/* ============================ NOW BAR (bottom) ============================ */

function nextTandaAfter(queue, key) {
  const i = queue.findIndex(x => x.key === key);
  for (let j = i + 1; j < queue.length; j++) if (queue[j].type === "tanda") return queue[j];
  return null;
}

function SeekBar({ pos, dur, onSeek, className = "tp-nb-bar" }) {
  const ref = useRef(null);
  const frac = dur > 0 ? Math.min(1, Math.max(0, pos / dur)) : 0;
  const onClick = (e) => {
    if (!ref.current || dur <= 0) return;
    const r = ref.current.getBoundingClientRect();
    onSeek(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * dur);
  };
  return (
    <div ref={ref} className={className} onClick={onClick} style={{ cursor: dur > 0 ? "pointer" : "default" }}>
      <div className="tp-nb-bar-fill" style={{ width: (frac * 100) + "%" }}></div>
    </div>
  );
}

function NowBar({ now, nowIx, queue, playing, pos, dur, volume, muted, onPlayPause, onPrev, onNext, onSeek, onFadeToTanda, onVolume, onToggleMute, cortinaSnippetEnabled, cortinaSnippetSec }) {
  const songNameOnly = useSongNameOnly();
  if (!now) {
    // Nothing is selected yet. If the queue already has items, the main Play
    // button must still work — it starts the set from the top (onPlayPause falls
    // back to queue[0]). Only a truly empty queue leaves the transport inert.
    const hasQueue = queue.length > 0;
    return (
      <div className="tp-nowbar">
        <div className="tp-nb-meta">
          <div className="tp-nb-mark"><I.note s={16} /></div>
          <div style={{ minWidth: 0 }}>
            <div className="tp-nb-title">{hasQueue ? "Ready to play" : "Nothing playing"}</div>
            <div className="tp-nb-sub">
              {hasQueue ? "Press play to start the set" : "Add a tanda or cortina, then press play"}
            </div>
          </div>
        </div>
        <div className="tp-nb-wave" />
        <div className="tp-nb-ctrls">
          <button className="tp-tbtn nb" disabled><I.prev s={16} /></button>
          <button className="tp-tbtn nb play" onClick={hasQueue ? onPlayPause : undefined} disabled={!hasQueue}><I.play s={22} /></button>
          <button className="tp-tbtn nb" disabled><I.next s={16} /></button>
          <VolumeControl volume={volume} muted={muted} onVolume={onVolume} onToggleMute={onToggleMute} />
        </div>
      </div>
    );
  }

  const remain = Math.max(0, (dur || 0) - (pos || 0));
  // A single-song item shows as a cortina only when it plays that role; tandas
  // (and the preview pseudo-tanda, which isn't in the queue) never do.
  const nowIdx = queue.findIndex((x) => x.key === now.key);
  const isCortina = now.type !== "tanda" && actsAsCortina(queue, nowIdx);

  if (isCortina) {
    const c = now.data;
    const upcoming = nextTandaAfter(queue, now.key);
    // Surface the cortina-snippet setting while it's active: a small countdown to
    // the auto-fade so the DJ knows the floor is about to move on its own.
    const snippetActive = cortinaSnippetEnabled && !!upcoming;
    const snippetRemain = Math.max(0, cortinaSnippetSec - (pos || 0));
    return (
      <div className="tp-nowbar is-cortina">
        <div className="tp-nb-meta">
          <div className="tp-nb-mark cortina"><I.curtain s={18} /></div>
          <div style={{ minWidth: 0 }}>
            <div className="tp-nb-eyebrow">{snippetActive ? `Cortina · snippet ${cortinaSnippetSec}s` : "Cortina · floor clears"}</div>
            <Marquee className="tp-nb-cortitle" text={"“" + c.title + "”"} />
            <div className="tp-nb-sub">
              {c.orq || "Cortina"}
              {snippetActive && (
                <span className="tp-snippet-badge" title={`Playing the first ${cortinaSnippetSec}s, then fading to the next tanda`}>
                  <I.fwd s={11} /> Auto-fade {fmtDur(snippetRemain)}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="tp-nb-wave">
          <span className="tp-mono tp-nb-t">{fmtDur(pos)}</span>
          <SeekBar pos={pos} dur={dur} onSeek={onSeek} />
          <span className="tp-mono tp-nb-t rem">−{fmtDur(remain)}</span>
        </div>

        <div className="tp-nb-ctrls">
          <button className="tp-tbtn nb" onClick={onPrev}><I.prev s={16} /></button>
          <button className="tp-tbtn nb play" onClick={onPlayPause}>
            {playing ? <I.pause s={22} /> : <I.play s={22} />}
          </button>
          <button className="tp-tbtn nb" onClick={onNext}><I.next s={16} /></button>
          <button className="tp-chip warn" style={{ marginLeft: 6 }} onClick={onFadeToTanda} disabled={!upcoming}>
            <I.fwd s={15} /> Fade to next tanda{upcoming ? <span className="tp-chip-tail"> · {tandaMeta(upcoming.data).orq}</span> : null}
          </button>
          <VolumeControl volume={volume} muted={muted} onVolume={onVolume} onToggleMute={onToggleMute} />
        </div>
      </div>
    );
  }

  // Tanda or single song. A single song has no song list, so it shows no dots
  // and reads its orchestra straight off the song.
  const isTanda = now.type === "tanda";
  const song = songOf(now, nowIx);
  const orq = isTanda ? tandaMeta(now.data).orq : ((song && song.orq) || "Unknown");
  const tandaSongs = isTanda ? (now.data.songs || []) : [];
  return (
    <div className="tp-nowbar">
      <div className="tp-nb-meta">
        <div className="tp-nb-mark">{playing ? <EQ /> : <I.pause s={16} />}</div>
        <div style={{ minWidth: 0 }}>
          <Marquee className="tp-nb-title" text={song ? (songNameOnly ? cleanSongTitle(song) : song.title) : "—"} />
          <div className="tp-nb-sub"><b>{orq}</b>{song && song.singer ? " · " + song.singer : ""}</div>
        </div>
        {isTanda && (
          <span className="tp-nb-dots">
            {tandaSongs.map((_, i) => <span key={i} className={"tp-dot" + (i < nowIx ? " done" : i === nowIx ? " now" : "")}></span>)}
          </span>
        )}
      </div>

      <div className="tp-nb-wave">
        <span className="tp-mono tp-nb-t">{fmtDur(pos)}</span>
        <div className="tp-flex1" style={{ cursor: dur > 0 ? "pointer" : "default" }}
          onClick={(e) => {
            if (dur <= 0) return;
            const r = e.currentTarget.getBoundingClientRect();
            onSeek(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * dur);
          }}>
          <Waveform progress={dur > 0 ? pos / dur : 0} bars={92} seed={(song && song.id || "x").length + 11} height={34} />
        </div>
        <span className="tp-mono tp-nb-t rem">−{fmtDur(remain)}</span>
      </div>

      <div className="tp-nb-ctrls">
        <button className="tp-tbtn nb" onClick={onPrev}><I.prev s={16} /></button>
        <button className="tp-tbtn nb play" onClick={onPlayPause}>
          {playing ? <I.pause s={22} /> : <I.play s={22} />}
        </button>
        <button className="tp-tbtn nb" onClick={onNext}><I.next s={16} /></button>
        <VolumeControl volume={volume} muted={muted} onVolume={onVolume} onToggleMute={onToggleMute} />
      </div>
    </div>
  );
}

/* ============================ PLAYER ENGINE ============================ */
// One audio engine for the whole app, shared through context. The transport bar
// lives at the shell level (always visible) and every play action — the live
// queue, a song preview from the Tandas view, a saved playlist — runs through
// this single engine, so only one thing is ever audible.

const PlayerContext = React.createContext(null);
const usePlayer = () => React.useContext(PlayerContext);

function usePlayerEngine(mainDeviceId, playback) {
  // Defensive default so the engine works even before settings are wired in.
  const cortinaSnippetEnabled = !!(playback && playback.cortinaSnippetEnabled);
  const cortinaSnippetSec = (playback && playback.cortinaSnippetSec) || CORTINA_SNIPPET_DEFAULT_SEC;
  const cortinaFadeSec = playback && typeof playback.cortinaFadeSec === "number" ? playback.cortinaFadeSec : CORTINA_FADE_DEFAULT_SEC;
  // Sound-leveling settings (with safe defaults).
  const normalizeEnabled = !playback || playback.normalizeEnabled !== false;
  const targetLufs = (playback && playback.targetLufs) || TARGET_LUFS_DEFAULT;
  const trimSilenceEnabled = !playback || playback.trimSilenceEnabled !== false;
  const trimPadMs = (playback && playback.trimPadMs) || TRIM_PAD_MS_DEFAULT;
  // Scope: trimming + inter-song gaps apply to the live set always, and to
  // library previews only when the DJ opts in. Gap is seconds between songs.
  const trimEverywhere = !!(playback && playback.trimEverywhere);
  const songGapSec = playback && typeof playback.songGapSec === "number" ? playback.songGapSec : SONG_GAP_DEFAULT_SEC;
  const restored = useMemo(loadLiveState, []);
  const [queue, setQueue] = useState(() => restored.queue || []);
  const [nowKey, setNowKey] = useState(() => restored.nowKey || null);
  const [nowIx, setNowIx] = useState(() => restored.nowIx || 0);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const [dur, setDur] = useState(0);
  const [volume, setVolume] = useState(1);      // master output, 0..1
  const [muted, setMuted] = useState(false);
  const [flash, setFlash] = useState(null);
  const [preview, setPreview] = useState(null);   // a standalone song played outside the queue
  const [error, setError] = useState(null);       // transient transport error (e.g. missing file)
  const flashTimer = useRef(null);
  const errTimer = useRef(null);

  const howlRef = useRef(null);
  const tickRef = useRef(null);
  const advancingRef = useRef(false);    // guards double-advance (rAF fade vs onend)
  const snippetFiredRef = useRef(false); // cortina snippet: armed once per cortina
  // Silence trimming: the resolved content window for the current song (real
  // file seconds), the displayed duration offset, and per-song fire guards.
  const trimRef = useRef({ startSec: 0, endSec: 0, realDur: 0 });
  const trimStartAppliedRef = useRef(false); // seek-past-intro done once per song
  const trimEndFiredRef = useRef(false);     // end-trim advance fired once per song
  const gapTimerRef = useRef(null);          // pending inter-song silence gap

  const queueNow = queue.find((i) => i.key === nowKey) || null;
  // A preview is shown in the bar as a one-song pseudo-tanda so the existing UI just works.
  const previewItem = useMemo(
    () => preview ? { type: "tanda", key: "__preview__", data: { name: preview.orq || preview.title, songs: [preview] } } : null,
    [preview]
  );
  const now = previewItem || queueNow;
  const displayKey = previewItem ? "__preview__" : nowKey;
  const displayIx = previewItem ? 0 : nowIx;
  const currentSong = previewItem ? preview : songOf(queueNow, nowIx);
  const currentId = currentSong ? currentSong.id : null;

  // Keep mutable copies for use inside Howl callbacks.
  const stateRef = useRef({});
  stateRef.current = { queue, nowKey, nowIx, playing, preview, mainDeviceId, cortinaSnippetEnabled, cortinaSnippetSec, cortinaFadeSec, normalizeEnabled, targetLufs, trimSilenceEnabled, trimPadMs, trimEverywhere, songGapSec };

  const stopTick = () => { if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; } };
  const startTick = () => {
    stopTick();
    tickRef.current = setInterval(() => {
      const h = howlRef.current;
      if (!h) return;
      const p = h.seek();
      const cur = typeof p === "number" ? p : 0;
      const { startSec, endSec } = trimRef.current;
      // Position/duration are reported relative to the trimmed window so the
      // seek bar and timecodes stay honest.
      const shown = Math.max(0, cur - (startSec || 0));
      setPos(shown);
      // Trailing-silence trim: end the song at the detected content offset.
      if (endSec > 0 && cur >= endSec && !advancingRef.current && !trimEndFiredRef.current) {
        trimEndFiredRef.current = true;
        stopTick();
        advanceWithGap();
        return;
      }
      maybeFireCortinaSnippet(h, shown);
    }, 200);
  };

  // "Cortina snippet": once a cortina has played its first N seconds, auto-fade to
  // the next tanda. We run this off the playback clock (the tick) rather than a
  // React effect so it fires reliably — exactly like the manual "Fade to next
  // tanda" button — reading the latest settings/queue from stateRef. Armed once
  // per cortina (snippetFiredRef is reset whenever the now-playing item changes).
  function maybeFireCortinaSnippet(h, cur) {
    const s = stateRef.current;
    if (!s.cortinaSnippetEnabled || s.preview) return;
    if (advancingRef.current || snippetFiredRef.current) return;
    // Only auto-fade when the current item is actually playing the cortina role.
    const idx = s.queue.findIndex((i) => i.key === s.nowKey);
    if (idx < 0 || !actsAsCortina(s.queue, idx)) return;
    if (cur < s.cortinaSnippetSec) return;
    const t = nextTandaAfter(s.queue, s.nowKey);
    if (!t) return;   // nothing to fade into — let it play out
    snippetFiredRef.current = true;
    startFadeTo(t.key);
  }

  // Advance after a configurable beat of silence between songs. The gap is a
  // live-set affordance: previews are single songs (nothing to advance to), and
  // an empty/last-song queue just stops. The trailing-trim path can stop the
  // file mid-stream, so we silence the current Howl to keep the gap truly quiet.
  function clearGapTimer() {
    if (gapTimerRef.current) { clearTimeout(gapTimerRef.current); gapTimerRef.current = null; }
  }
  function advanceWithGap() {
    const s = stateRef.current;
    const gapMs = Math.max(0, Math.round((s.songGapSec || 0) * 1000));
    if (gapMs <= 0 || s.preview || !hasNext()) { advance(); return; }
    advancingRef.current = true;
    stopTick();
    const h = howlRef.current;
    if (h) { try { h.stop(); } catch (_e) { /* already stopped */ } }
    clearGapTimer();
    gapTimerRef.current = setTimeout(() => {
      gapTimerRef.current = null;
      advancingRef.current = false;
      advance();
    }, gapMs);
  }

  function hasNext() {
    const { preview, queue, nowKey, nowIx } = stateRef.current;
    if (preview) return false;
    const item = queue.find((i) => i.key === nowKey);
    if (!item) return false;
    if (item.type === "tanda" && nextLiveSong(item.data.songs || [], nowIx + 1) >= 0) return true;
    const idx = queue.findIndex((i) => i.key === nowKey);
    for (let j = idx + 1; j < queue.length; j++) if (firstLiveSong(queue[j]) >= 0) return true;
    return false;
  }

  function advance() {
    clearGapTimer();
    advancingRef.current = false;
    const { preview, queue, nowKey, nowIx } = stateRef.current;
    if (preview) { setPreview(null); setPlaying(false); return; }
    const item = queue.find((i) => i.key === nowKey);
    if (!item) { setPlaying(false); return; }
    if (item.type === "tanda") {
      const nx = nextLiveSong(item.data.songs || [], nowIx + 1);
      if (nx >= 0) { setNowIx(nx); return; }
    }
    const idx = queue.findIndex((i) => i.key === nowKey);
    for (let j = idx + 1; j < queue.length; j++) {
      const li = firstLiveSong(queue[j]);
      if (li >= 0) { setNowKey(queue[j].key); setNowIx(li); return; }
    }
    setPlaying(false);
  }

  // Crossfade the current sound out, then jump to `targetKey` and start it. When
  // nothing is audible (paused) it just hands over immediately. Shared by the
  // manual "Fade to next tanda" button and the automatic cortina-snippet fade.
  function startFadeTo(targetKey) {
    const h = howlRef.current;
    const fadeSec = stateRef.current.cortinaFadeSec;
    const fadeMs = Number.isFinite(fadeSec) && fadeSec >= 0
      ? Math.round(fadeSec * 1000) : FADE_TO_TANDA_MS;
    if (h && h.playing()) {
      advancingRef.current = true;
      h.fade(h.volume(), 0, fadeMs);
      setTimeout(() => {
        advancingRef.current = false;
        setPreview(null); setNowKey(targetKey); setNowIx(0); setPlaying(true);
      }, fadeMs);
    } else {
      setPreview(null); setNowKey(targetKey); setNowIx(0); setPlaying(true);
    }
  }

  const flashError = (msg) => {
    setError(msg);
    clearTimeout(errTimer.current);
    errTimer.current = setTimeout(() => setError(null), 6000);
  };

  // A song failed to load. If the file is genuinely gone, self-heal by removing
  // it from the library (so the dead folder/track disappears) and tell the DJ;
  // otherwise it was a transient error. Either way, skip on so the set flows.
  function handleLoadError(song) {
    if (song && song.id != null) {
      Promise.resolve(Store.removeSongIfMissing(song.id))
        .then((res) => flashError(res && res.removed
          ? `“${song.title}” is no longer on disk — removed from your library.`
          : `Couldn’t play “${song.title}”.`))
        .catch(() => flashError(`Couldn’t play “${song.title}”.`));
    } else {
      flashError("Couldn’t play this track.");
    }
    advance();
  }

  // Load the current song into a fresh Howl whenever it changes.
  useEffect(() => {
    stopTick();
    clearGapTimer();
    if (howlRef.current) { howlRef.current.unload(); howlRef.current = null; }
    setPos(0); setDur(0);
    advancingRef.current = false;
    // Reset per-song trim state.
    trimRef.current = { startSec: 0, endSec: 0, realDur: 0 };
    trimStartAppliedRef.current = false;
    trimEndFiredRef.current = false;
    if (!currentId) return;

    const failing = currentSong;   // captured for error reporting in callbacks
    // Prefer the live library copy: a song queued before analysis finished may
    // carry a stale snapshot without measurements, but the DB row is current.
    const song = (Store.songById && Store.songById(currentId)) || currentSong;
    const baseGain = gainForSong(song, stateRef.current);

    // Resolve the trimmed window once duration is known, and report the trimmed
    // duration to the UI. Idempotent — safe to call from onload and onplay.
    const applyTrimMeta = () => {
      const realDur = howl.duration() || 0;
      const tb = trimBoundsSec(song, stateRef.current, realDur);
      trimRef.current = { startSec: tb.startSec, endSec: tb.endSec, realDur };
      setDur(Math.max(0, tb.endSec - tb.startSec));
    };

    const howl = new Howl({
      src: [window.compas.audioUrl(currentId)],
      html5: true,
      // compas-audio:// URLs carry no extension; hint a format so Howler's codec
      // gate passes. In html5 mode the browser decodes the real stream itself.
      format: ["mp3"],
      volume: baseGain,
      onload: () => { applyTrimMeta(); applySinkId(howlNode(howl), stateRef.current.mainDeviceId); },
      onplay: () => {
        applyTrimMeta();
        applySinkId(howlNode(howl), stateRef.current.mainDeviceId);
        // Skip the leading silence once, at the very start of the song.
        if (!trimStartAppliedRef.current) {
          trimStartAppliedRef.current = true;
          if (trimRef.current.startSec > 0.05) howl.seek(trimRef.current.startSec);
        }
        setPlaying(true);
        startTick();
      },
      onpause: () => { setPlaying(false); stopTick(); },
      onstop: () => { stopTick(); },
      onend: () => { stopTick(); if (!advancingRef.current) advanceWithGap(); },
      onloaderror: () => { handleLoadError(failing); },
      onplayerror: () => { howl.once("unlock", () => howl.play()); },
    });
    howlRef.current = howl;
    applySinkId(howlNode(howl), stateRef.current.mainDeviceId);
    if (stateRef.current.playing) howl.play();

    return () => { stopTick(); howl.unload(); };
    // eslint-disable-next-line
  }, [currentId]);

  // Re-route the live engine when the DJ picks a different main output card.
  useEffect(() => { applySinkId(howlNode(howlRef.current), mainDeviceId); }, [mainDeviceId]);

  // Sync play/pause intent to the current Howl.
  useEffect(() => {
    const h = howlRef.current;
    if (!h) return;
    if (playing && !h.playing()) h.play();
    else if (!playing && h.playing()) h.pause();
    // eslint-disable-next-line
  }, [playing]);

  // Keep the OS display awake while playing. Without this the screen sleeps
  // after the system idle timeout during a long unattended set; the window
  // then becomes occluded and the playback tick gets throttled, making the
  // engine flicker (rapid stop/start) until input wakes the display.
  useEffect(() => {
    if (window.compas && window.compas.setKeepAwake) {
      try { window.compas.setKeepAwake(playing); } catch (_e) { /* bridge unavailable */ }
    }
  }, [playing]);

  // Master output volume. Howler's global volume scales every Howl (and rides on
  // top of per-song fades), so crossfades keep working relative to this level.
  useEffect(() => { Howler.volume(muted ? 0 : volume); }, [volume, muted]);

  useEffect(() => () => { stopTick(); clearGapTimer(); if (howlRef.current) howlRef.current.unload(); }, []);

  // Persist the live working set so it's still here after a restart. We store
  // the queue plus which item/song is current; playback resumes paused.
  useEffect(() => {
    try {
      localStorage.setItem(LIVE_PERSIST_KEY, JSON.stringify({ queue, nowKey, nowIx }));
    } catch (_e) { /* storage full or unavailable — non-fatal */ }
  }, [queue, nowKey, nowIx]);

  const ping = (id) => {
    setFlash(id);
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), 1100);
  };

  const addTanda = (t) => { setQueue((q) => [...q, mk("tanda", t)]); ping("t:" + t.id); };
  const addCortina = (c) => { setQueue((q) => [...q, mk("cortina", c)]); ping("c:" + c.id); };
  // Insert a song (as a standalone cortina item) at an exact spot — used when a
  // library song is dropped onto the queue. beforeKey null appends to the end.
  const insertSong = (song, beforeKey) => {
    if (!song) return;
    setQueue((q) => {
      const item = mk("cortina", song);
      const idx = beforeKey ? q.findIndex((i) => i.key === beforeKey) : -1;
      if (idx < 0) return [...q, item];
      const copy = q.slice();
      copy.splice(idx, 0, item);
      return copy;
    });
    ping("c:" + song.id);
  };
  const addPlaylist = (pl) => {
    if (!pl.items || !pl.items.length) return;
    setQueue((q) => [...q, ...pl.items.map((it) => mk(it.type, it.data))]);
    ping("p:" + pl.id);
  };
  const remove = (key) => setQueue((q) => {
    const filtered = q.filter((i) => i.key !== key);
    if (key === nowKey) { setNowKey(null); setNowIx(0); setPlaying(false); }
    return filtered;
  });
  // Reorder so the dragged item lands *in front of* the drop target (see
  // QueuePanel.handleDrop). Removing `from` first shifts later indices down by
  // one, so a downward move targets `to - 1` to avoid landing past the target.
  const reorder = (fromKey, toKey) => setQueue((q) => {
    const from = q.findIndex((i) => i.key === fromKey), to = q.findIndex((i) => i.key === toKey);
    if (from < 0 || to < 0 || from === to) return q;
    const copy = q.slice();
    const [m] = copy.splice(from, 1);
    copy.splice(from < to ? to - 1 : to, 0, m);
    return copy;
  });
  // Wipe the whole live set and stop playback — the "start the night over" reset.
  const clearQueue = () => {
    setPreview(null);
    setQueue([]);
    setNowKey(null);
    setNowIx(0);
    setPlaying(false);
  };

  const playItem = (key) => {
    if (preview) setPreview(null);
    if (!preview && key === nowKey) { setPlaying((p) => !p); return; }
    const item = queue.find((i) => i.key === key);
    setNowKey(key); setNowIx(Math.max(0, firstLiveSong(item))); setPlaying(true);
  };
  // Toggle a tanda song's "skip" flag — skipped songs stay listed but are passed
  // over during live playback. The song currently on air can't be skipped (it's
  // already playing); let it finish or use the transport Next.
  const toggleSkip = (key, ix) => {
    if (!preview && key === nowKey && ix === nowIx) return;
    setQueue((q) => q.map((it) => {
      if (it.key !== key || it.type !== "tanda") return it;
      const songs = (it.data.songs || []).map((s, i) => i === ix ? { ...s, skip: !s.skip } : s);
      return { ...it, data: { ...it.data, songs } };
    }));
  };
  // Jump straight to a specific song inside a queued item (e.g. tapping the 3rd
  // song of a tanda). Clicking the song that's already playing toggles play/pause.
  const playItemAt = (key, ix) => {
    if (preview) setPreview(null);
    if (!preview && key === nowKey && ix === nowIx) { setPlaying((p) => !p); return; }
    setNowKey(key); setNowIx(ix); setPlaying(true);
  };
  const playPause = () => {
    if (preview) { setPlaying((p) => !p); return; }
    if (!nowKey) {
      const first = queue[0];
      if (first) { setNowKey(first.key); setNowIx(0); setPlaying(true); }
      return;
    }
    setPlaying((p) => !p);
  };
  const prev = () => {
    if (preview) { const h = howlRef.current; if (h) h.seek(0); setPos(0); return; }
    if (queueNow && queueNow.type === "tanda" && nowIx > 0) { setNowIx(nowIx - 1); setPlaying(true); return; }
    const idx = queue.findIndex((i) => i.key === nowKey);
    const p = idx > 0 ? queue[idx - 1] : null;
    if (p) { setNowKey(p.key); setNowIx(p.type === "tanda" ? Math.max(0, p.data.songs.length - 1) : 0); setPlaying(true); }
    else { const h = howlRef.current; if (h) h.seek(0); setPos(0); }
  };
  const next = () => {
    if (preview) { setPreview(null); setPlaying(false); return; }
    advancingRef.current = false; advance(); setPlaying(true);
  };
  // UI seconds are relative to the trimmed window; map back to real file time.
  const seek = (sec) => { const h = howlRef.current; if (h) { h.seek((trimRef.current.startSec || 0) + sec); setPos(sec); } };

  const fadeToTanda = () => {
    const t = nextTandaAfter(queue, nowKey);
    if (t) startFadeTo(t.key);
  };

  // Re-arm the cortina snippet whenever the now-playing item changes, so the
  // auto-fade (driven from the playback tick above) fires once per cortina.
  useEffect(() => { snippetFiredRef.current = false; }, [nowKey]);

  // The background analysis pass now runs continuously — we no longer pause it
  // during playback (it was halting the whole pass for one-song library
  // previews, which made the progress banner look stuck). ffmpeg is left to run
  // alongside playback.

  // Play a single song outside the queue (the Tandas-view song preview).
  const previewSong = (song) => {
    if (!song) return;
    if (preview && preview.id === song.id) { setPlaying((p) => !p); return; }
    setPreview(song);
    setPlaying(true);
  };

  // Save the current live queue as a reusable playlist. Items reference saved
  // tandas/cortinas by id, matching the Playlists view's save shape.
  const saveQueueAsPlaylist = (name) => {
    if (!queue.length) return Promise.resolve(null);
    return Store.savePlaylist({
      id: null,
      name: (name && name.trim()) || null,
      items: queue.map((it) => ({ type: it.type, refId: it.data.id })),
    });
  };

  // Replace the queue with a saved playlist and start it (handoff from Playlists view).
  const loadPlaylist = (items) => {
    if (!items || !items.length) return;
    const q = items.map((it) => mk(it.type, it.data));
    setPreview(null);
    setQueue(q);
    setNowKey(q[0].key);
    setNowIx(0);
    setPlaying(true);
  };

  const livePlaying = playing && !preview && !!queueNow;

  return {
    queue, now, nowKey: displayKey, nowIx: displayIx, playing, livePlaying, pos, dur, flash,
    cortinaSnippetEnabled, cortinaSnippetSec,
    error, dismissError: () => { clearTimeout(errTimer.current); setError(null); },
    volume, muted, setVolume: (v) => { setVolume(Math.min(1, Math.max(0, v))); if (v > 0) setMuted(false); },
    toggleMute: () => setMuted((m) => !m),
    previewId: preview ? preview.id : null,
    clearPreview: () => { setPreview(null); setPlaying(false); },
    addTanda, addCortina, addPlaylist, insertSong, remove, reorder, clearQueue,
    playItem, playItemAt, toggleSkip, playPause, prev, next, seek, fadeToTanda,
    previewSong, loadPlaylist, saveQueueAsPlaylist,
  };
}

/* ============================ PLAYBACK SETTINGS ============================ */
// DJ playback preferences that aren't about devices. Right now: "cortina snippet"
// — only play the first few seconds of a cortina, then auto-fade to the next
// tanda. Persisted in localStorage so the choice survives restarts.
const CORTINA_SNIPPET_DEFAULT_SEC = 90;
// How long the auto-fade out of a cortina takes, in seconds.
const CORTINA_FADE_DEFAULT_SEC = 2.5;
// Sound-leveling defaults. Target loudness is where every song is pulled toward;
// -18 LUFS is a comfortable level for a tango set. Trim pad keeps a hair of
// silence so a hard cut never clips the first attack / final note.
const TARGET_LUFS_DEFAULT = -18;
const TRIM_PAD_MS_DEFAULT = 30;
// A short breath of silence inserted between songs in the live set, on top of
// any trailing-silence trim. Seconds, so the slider reads naturally.
const SONG_GAP_DEFAULT_SEC = 1.5;
function usePlaybackSettings() {
  const [cortinaSnippetEnabled, setSnippet] = useState(() => localStorage.getItem("compas.cortinaSnippetEnabled") === "1");
  const [cortinaSnippetSec, setSnippetSecState] = useState(() => {
    const v = parseInt(localStorage.getItem("compas.cortinaSnippetSec"), 10);
    return Number.isFinite(v) && v > 0 ? v : CORTINA_SNIPPET_DEFAULT_SEC;
  });
  const [cortinaFadeSec, setFadeSecState] = useState(() => {
    const v = parseFloat(localStorage.getItem("compas.cortinaFadeSec"));
    return Number.isFinite(v) && v >= 0 ? v : CORTINA_FADE_DEFAULT_SEC;
  });
  // Sound leveling — default on so a freshly-analyzed library "just works".
  const [normalizeEnabled, setNorm] = useState(() => localStorage.getItem("compas.normalizeEnabled") !== "0");
  const [targetLufs, setTargetState] = useState(() => {
    const v = parseFloat(localStorage.getItem("compas.targetLufs"));
    return Number.isFinite(v) ? v : TARGET_LUFS_DEFAULT;
  });
  const [trimSilenceEnabled, setTrim] = useState(() => localStorage.getItem("compas.trimSilenceEnabled") !== "0");
  // Trimming + gaps are a live-set behaviour by default; opt in to also apply
  // them when previewing a song straight from the library.
  const [trimEverywhere, setTrimEverywhere] = useState(() => localStorage.getItem("compas.trimEverywhere") === "1");
  const [songGapSec, setGapState] = useState(() => {
    const v = parseFloat(localStorage.getItem("compas.songGapSec"));
    return Number.isFinite(v) && v >= 0 ? v : SONG_GAP_DEFAULT_SEC;
  });

  const setCortinaSnippetEnabled = useCallback((v) => {
    setSnippet(!!v); localStorage.setItem("compas.cortinaSnippetEnabled", v ? "1" : "0");
  }, []);
  const setCortinaSnippetSec = useCallback((v) => {
    const n = Math.max(1, Math.round(Number(v) || CORTINA_SNIPPET_DEFAULT_SEC));
    setSnippetSecState(n); localStorage.setItem("compas.cortinaSnippetSec", String(n));
  }, []);
  const setCortinaFadeSec = useCallback((v) => {
    const n = Math.max(0, Math.min(10, Math.round((Number(v) || 0) * 2) / 2));
    setFadeSecState(n); localStorage.setItem("compas.cortinaFadeSec", String(n));
  }, []);
  const setNormalizeEnabled = useCallback((v) => {
    setNorm(!!v); localStorage.setItem("compas.normalizeEnabled", v ? "1" : "0");
  }, []);
  const setTargetLufs = useCallback((v) => {
    const n = Math.max(-30, Math.min(-6, Math.round(Number(v) || TARGET_LUFS_DEFAULT)));
    setTargetState(n); localStorage.setItem("compas.targetLufs", String(n));
  }, []);
  const setTrimSilenceEnabled = useCallback((v) => {
    setTrim(!!v); localStorage.setItem("compas.trimSilenceEnabled", v ? "1" : "0");
  }, []);
  const setTrimEverywhereCb = useCallback((v) => {
    setTrimEverywhere(!!v); localStorage.setItem("compas.trimEverywhere", v ? "1" : "0");
  }, []);
  const setSongGapSec = useCallback((v) => {
    const n = Math.max(0, Math.min(8, Math.round((Number(v) || 0) * 2) / 2));
    setGapState(n); localStorage.setItem("compas.songGapSec", String(n));
  }, []);

  return {
    cortinaSnippetEnabled, cortinaSnippetSec, setCortinaSnippetEnabled, setCortinaSnippetSec,
    cortinaFadeSec, setCortinaFadeSec,
    normalizeEnabled, targetLufs, trimSilenceEnabled, trimPadMs: TRIM_PAD_MS_DEFAULT,
    setNormalizeEnabled, setTargetLufs, setTrimSilenceEnabled,
    trimEverywhere, songGapSec, setTrimEverywhere: setTrimEverywhereCb, setSongGapSec,
  };
}

/* ============================ AUDIO OUTPUT DEVICES ============================ */
// Tracks the available output cards and the DJ's main/monitor routing choices.
// Choices persist in localStorage (device ids can rotate between sessions, so we
// also keep the label and re-match on it when the saved id disappears).
function useAudioDevices() {
  const [outputs, setOutputs] = useState([]);
  const [needsAccess, setNeedsAccess] = useState(false);
  const [mainDeviceId, setMainId] = useState(() => localStorage.getItem("compas.mainDeviceId") || "");
  const [monitorDeviceId, setMonId] = useState(() => localStorage.getItem("compas.monitorDeviceId") || "");
  const [cueingEnabled, setCueing] = useState(() => localStorage.getItem("compas.cueingEnabled") === "1");

  const refresh = useCallback(async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      const outs = list
        .filter((d) => d.kind === "audiooutput" && d.deviceId)
        .map((d) => ({ deviceId: d.deviceId, label: d.label || "" }));
      setOutputs(outs);
      // Labels come back blank until the user has granted media access at least once.
      setNeedsAccess(outs.length > 0 && outs.every((o) => !o.label));
    } catch (_e) { /* ignore */ }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    const md = navigator.mediaDevices;
    if (!md || !md.addEventListener) return;
    const onChange = () => refresh();
    md.addEventListener("devicechange", onChange);
    return () => md.removeEventListener("devicechange", onChange);
  }, [refresh]);

  // One-time prompt so enumerateDevices() returns human-readable labels.
  const requestAccess = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
    } catch (_e) { /* denied — labels stay blank */ }
    refresh();
  }, [refresh]);

  const setMainDeviceId = useCallback((id) => {
    setMainId(id); localStorage.setItem("compas.mainDeviceId", id || "");
  }, []);
  const setMonitorDeviceId = useCallback((id) => {
    setMonId(id); localStorage.setItem("compas.monitorDeviceId", id || "");
  }, []);
  const setCueingEnabled = useCallback((v) => {
    setCueing(v); localStorage.setItem("compas.cueingEnabled", v ? "1" : "0");
  }, []);

  const labelFor = useCallback((id) => {
    if (!id) return "System default";
    const m = outputs.find((o) => o.deviceId === id);
    return m && m.label ? m.label : "Selected output";
  }, [outputs]);

  // Cueing is only truly available once a distinct monitor card is chosen.
  const monitorReady = !!(cueingEnabled && monitorDeviceId);

  return {
    outputs, needsAccess, refresh, requestAccess, labelFor,
    mainDeviceId, monitorDeviceId, cueingEnabled, monitorReady,
    setMainDeviceId, setMonitorDeviceId, setCueingEnabled,
  };
}

/* ============================ CUE ENGINE (headphone monitor) ============================ */
// A second, fully independent playback chain on its own <audio> element, routed
// to the monitor card via setSinkId. The DJ auditions tracks here while the live
// queue keeps playing to the floor — the two never share state or volume.
function useCueEngine(monitorDeviceId) {
  const [song, setSong] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const [dur, setDur] = useState(0);
  const [volume, setVol] = useState(() => {
    const v = parseFloat(localStorage.getItem("compas.cueVolume"));
    return Number.isFinite(v) ? v : 0.85;
  });
  const audioRef = useRef(null);
  const tickRef = useRef(null);
  const songsRef = useRef([]);
  const ixRef = useRef(0);
  const monIdRef = useRef(monitorDeviceId);
  useEffect(() => { monIdRef.current = monitorDeviceId; }, [monitorDeviceId]);

  const stopTick = () => { if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; } };
  const startTick = () => {
    stopTick();
    tickRef.current = setInterval(() => {
      const a = audioRef.current;
      if (a) setPos(a.currentTime || 0);
    }, 200);
  };

  useEffect(() => {
    const a = new Audio();
    a.preload = "auto";
    a.volume = volume;
    audioRef.current = a;
    const onMeta = () => setDur(a.duration || 0);
    const onPlay = () => { setPlaying(true); startTick(); };
    const onPause = () => { setPlaying(false); stopTick(); };
    const onEnd = () => {
      const songs = songsRef.current;
      const ix = ixRef.current;
      if (songs.length && ix < songs.length - 1) {
        ixRef.current = ix + 1;
        const next = songs[ix + 1];
        setSong(next); setPos(0); setDur(0);
        a.src = window.compas.audioUrl(next.id);
        const start = () => a.play().catch(() => {});
        if (typeof a.setSinkId === "function" && monIdRef.current) {
          a.setSinkId(monIdRef.current).then(start, start);
        } else start();
        return;
      }
      songsRef.current = [];
      ixRef.current = 0;
      setSong(null);
      setPlaying(false); setPos(0); stopTick();
    };
    a.addEventListener("loadedmetadata", onMeta);
    a.addEventListener("play", onPlay);
    a.addEventListener("pause", onPause);
    a.addEventListener("ended", onEnd);
    return () => {
      stopTick();
      a.removeEventListener("loadedmetadata", onMeta);
      a.removeEventListener("play", onPlay);
      a.removeEventListener("pause", onPause);
      a.removeEventListener("ended", onEnd);
      a.pause(); a.src = "";
    };
    // eslint-disable-next-line
  }, []);

  // Keep the element pinned to the monitor card (re-applied on device change).
  useEffect(() => { applySinkId(audioRef.current, monitorDeviceId); }, [monitorDeviceId]);
  useEffect(() => { if (audioRef.current) audioRef.current.volume = volume; }, [volume]);

  const playSong = useCallback((s) => {
    const a = audioRef.current;
    if (!s || !a) return;
    setSong(s); setPos(0); setDur(0);
    a.src = window.compas.audioUrl(s.id);
    const start = () => a.play().catch(() => {});
    // Set the sink before the first play so the preview never leaks onto main.
    if (typeof a.setSinkId === "function" && monitorDeviceId) {
      a.setSinkId(monitorDeviceId).then(start, start);
    } else start();
  }, [monitorDeviceId]);

  const cue = useCallback((s) => {
    const a = audioRef.current;
    if (!s || !a) return;
    if (song && song.id === s.id) { if (a.paused) a.play().catch(() => {}); else a.pause(); return; }
    songsRef.current = [];
    ixRef.current = 0;
    playSong(s);
  }, [song, playSong]);

  const cueSongs = useCallback((songs) => {
    if (!songs || !songs.length) return;
    songsRef.current = songs;
    ixRef.current = 0;
    playSong(songs[0]);
  }, [playSong]);

  const toggle = useCallback(() => {
    const a = audioRef.current;
    if (!a || !song) return;
    if (a.paused) a.play().catch(() => {}); else a.pause();
  }, [song]);

  const stop = useCallback(() => {
    const a = audioRef.current;
    if (a) { a.pause(); a.removeAttribute("src"); a.load(); }
    songsRef.current = [];
    ixRef.current = 0;
    setSong(null); setPlaying(false); setPos(0); setDur(0);
  }, []);

  const seek = useCallback((sec) => {
    const a = audioRef.current;
    if (a) { a.currentTime = sec; setPos(sec); }
  }, []);

  const setVolume = useCallback((v) => {
    const nv = Math.min(1, Math.max(0, v));
    setVol(nv); localStorage.setItem("compas.cueVolume", String(nv));
  }, []);

  return { song, playing, pos, dur, volume, cue, cueSongs, toggle, stop, seek, setVolume };
}

function PlayerProvider({ children }) {
  const devices = useAudioDevices();
  const playback = usePlaybackSettings();
  const engine = usePlayerEngine(devices.mainDeviceId, playback);
  const cueEngine = useCueEngine(devices.monitorDeviceId);

  // Turning pre-listen off tears down any in-progress cue immediately — stop()
  // clears the cue song, which makes the blue CueBar strip disappear at once.
  useEffect(() => {
    if (!devices.cueingEnabled) cueEngine.stop();
  }, [devices.cueingEnabled, cueEngine.stop]);

  // Unified "listen" affordance for the library/tandas play buttons, and the
  // source of the now-playing highlight in cards/editors. The cue engine is the
  // single "play in place" chain for tandas, playlists, and single-song
  // auditions — it never touches the live queue. The highlight follows the cue
  // engine whenever it's playing something (so the active song shows with or
  // without a monitor); only single-song auditions on a monitor-less setup fall
  // back to the shared floor engine.
  const cueActive = !!cueEngine.song;
  const preview = (devices.monitorReady || cueActive)
    ? { previewId: cueEngine.song ? cueEngine.song.id : null, playing: cueEngine.playing, toggle: cueEngine.cue, viaMonitor: devices.monitorReady }
    : { previewId: engine.previewId, playing: engine.playing, toggle: engine.previewSong, viaMonitor: false };

  // Play a list of songs "in place" on the cue engine: it marks the playing song
  // active in the card/editor and never touches the live queue. The live queue is
  // only ever fed by the explicit "Import to Live" action in the Live tab.
  const playSongs = useCallback((songs) => {
    if (!songs || !songs.length) return;
    engine.clearPreview();
    cueEngine.cueSongs(songs);
  }, [engine, cueEngine]);

  // Play a whole tanda in place.
  const playTanda = useCallback((t) => {
    if (t && t.songs) playSongs(t.songs);
  }, [playSongs]);

  // Play a saved playlist in place — every item (tandas, cortinas, loose songs)
  // flattened into one ordered run on the cue engine.
  const playPlaylist = useCallback((items) => {
    if (!items || !items.length) return;
    playSongs(items.flatMap((it) => itemSongs(it)));
  }, [playSongs]);

  // Spacebar is a global play/pause toggle. While the floor is live and the
  // headphone monitor (the "backup player") is enabled, Space drives the monitor
  // so it can never pause the dancers mid-tanda by accident; otherwise it toggles
  // the floor. Kept in a ref so the listener subscribes once.
  const spaceRef = useRef(() => {});
  spaceRef.current = () => {
    if (engine.livePlaying && devices.monitorReady) cueEngine.toggle();
    else engine.playPause();
  };
  useEffect(() => {
    const onKey = (e) => {
      if (e.code !== "Space" && e.key !== " ") return;
      // Leave the spacebar alone while typing or inside an interactive control
      // (text fields, selects, buttons, switches) so it keeps its native role.
      const el = e.target;
      if (el && (
        el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" ||
        el.tagName === "BUTTON" || el.isContentEditable ||
        (el.closest && el.closest('[role="switch"],[role="button"],a[href]'))
      )) return;
      e.preventDefault();
      spaceRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const value = { ...engine, devices, playback, cue: cueEngine, preview, playTanda, playPlaylist };
  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}

/* ============================ LIVE PLAYER (library + queue) ============================ */

function LivePlayer({ queueWidth, onQueueWidthChange }) {
  const { tandas, songs, playlists } = useStore();
  const p = usePlayer();
  const [draggingId, setDraggingId] = useState(null);

  // Live queue width while dragging the divider; seeded from the persisted tweak.
  const [qW, setQW] = useState(queueWidth || 600);
  useEffect(() => { setQW(queueWidth || 600); }, [queueWidth]);
  const commitQW = (w) => { if (onQueueWidthChange) onQueueWidthChange(w); };
  // Cortina material is flagged per song (song.isCortina), independent of genre.
  const cortinas = useMemo(() => (songs || []).filter((s) => s.isCortina), [songs]);

  // Drag source for library songs — mirrors the Tandas builder's payload so the
  // queue can read "song:<id>" off the drop.
  const makeDrag = (s) => ({
    onDragStart: (e) => { e.dataTransfer.setData("text/plain", "song:" + s.id); e.dataTransfer.effectAllowed = "copy"; setDraggingId(s.id); },
    onDragEnd: () => setDraggingId(null),
  });

  // Single-song "listen" — routes to the monitor when cueing is on, otherwise
  // through the shared engine (see PlayerProvider).
  const preview = p.preview;

  return (
    <div className="tp-main">
      <LibraryPanel tandas={tandas} cortinas={cortinas} playlists={playlists}
        onAddTanda={p.addTanda} onAddSong={p.addCortina} onAddPlaylist={p.addPlaylist}
        makeDrag={makeDrag} draggingId={draggingId} preview={preview} flash={p.flash} />
      <QueueResizer width={qW} min={LIVE_QUEUE_MIN_W} max={LIVE_QUEUE_MAX_W}
        onResize={setQW} onCommit={commitQW} />
      <QueuePanel queue={p.queue} nowKey={p.nowKey} nowIx={p.nowIx} now={p.now} playing={p.playing} pos={p.pos} width={qW} onPlay={p.playItem} onPlaySongAt={p.playItemAt} onSkipSong={p.toggleSkip} onRemove={p.remove} onReorder={p.reorder} onInsertSong={p.insertSong} onSavePlaylist={p.saveQueueAsPlaylist} onClearQueue={p.clearQueue} />
    </div>
  );
}

// Master output control, lives inside the transport bar's control cluster.
function VolumeControl({ volume, muted, onVolume, onToggleMute }) {
  const off = muted || volume <= 0;
  const pct = Math.round((off ? 0 : volume) * 100);
  return (
    <div className="tp-nb-vol" title="Master output">
      <button className="tp-vol-btn" onClick={onToggleMute} title={off ? "Unmute" : "Mute"}>
        {off ? <I.volX s={16} /> : <I.vol s={16} />}
      </button>
      <input className="tp-vol-range" type="range" min="0" max="100" step="1" value={pct}
        style={{ "--vfill": pct + "%" }}
        onChange={(e) => onVolume(Number(e.target.value) / 100)} />
    </div>
  );
}

// Headphone monitor strip — a second, visually distinct transport that sits
// above the floor's NowBar. Only mounts while a track is cued, so it stays out
// of the way until the DJ auditions something.
function CueBar({ cue, monitorLabel }) {
  const songNameOnly = useSongNameOnly();
  const song = cue.song;
  if (!song) return null;
  const remain = Math.max(0, (cue.dur || 0) - (cue.pos || 0));
  const off = cue.volume <= 0;
  const pct = Math.round(cue.volume * 100);
  return (
    <div className="tp-cuebar">
      <div className="tp-cb-meta">
        <div className="tp-cb-mark"><I.headphones s={20} /></div>
        <div style={{ minWidth: 0 }}>
          <div className="tp-cb-eyebrow">Pre-listen{monitorLabel ? " · " + monitorLabel : ""}</div>
          <div className="tp-cb-title">{songNameOnly ? cleanSongTitle(song) : song.title}</div>
          <div className="tp-cb-sub">{song.orq}{song.singer ? " · " + song.singer : ""}</div>
        </div>
      </div>

      <div className="tp-cb-wave">
        <span className="tp-mono tp-nb-t">{fmtDur(cue.pos)}</span>
        <SeekBar pos={cue.pos} dur={cue.dur} onSeek={cue.seek} className="tp-nb-bar cue" />
        <span className="tp-mono tp-nb-t rem">−{fmtDur(remain)}</span>
      </div>

      <div className="tp-cb-ctrls">
        <button className="tp-tbtn sm" onClick={cue.toggle} title={cue.playing ? "Pause preview" : "Play preview"}>
          {cue.playing ? <I.pause s={18} /> : <I.play s={18} />}
        </button>
        <button className="tp-tbtn sm ghost" onClick={cue.stop} title="Close pre-listen"><I.x s={16} /></button>
        <div className="tp-nb-vol" title="Pre-listen volume">
          <span className="tp-vol-btn cue" aria-hidden="true">{off ? <I.volX s={15} /> : <I.headphones s={15} />}</span>
          <input className="tp-vol-range cue" type="range" min="0" max="100" step="1" value={pct}
            style={{ "--vfill": pct + "%" }}
            onChange={(e) => cue.setVolume(Number(e.target.value) / 100)} />
        </div>
      </div>
    </div>
  );
}

// The transport bar reads everything from the shared player engine.
function PlayerBar() {
  const p = usePlayer();
  return (
    <React.Fragment>
      {p.error && (
        <div className="tp-error-toast" role="alert">
          <span className="ic"><I.curtain s={15} /></span>
          <span className="msg">{p.error}</span>
          <button className="x" onClick={p.dismissError} title="Dismiss"><I.x s={14} /></button>
        </div>
      )}
      <CueBar cue={p.cue} monitorLabel={p.devices.labelFor(p.devices.monitorDeviceId)} />
      <NowBar now={p.now} nowIx={p.nowIx} queue={p.queue} playing={p.playing} pos={p.pos} dur={p.dur}
        volume={p.volume} muted={p.muted}
        cortinaSnippetEnabled={p.cortinaSnippetEnabled} cortinaSnippetSec={p.cortinaSnippetSec}
        onPlayPause={p.playPause} onPrev={p.prev} onNext={p.next} onSeek={p.seek}
        onFadeToTanda={p.fadeToTanda} onVolume={p.setVolume} onToggleMute={p.toggleMute} />
    </React.Fragment>
  );
}

// Slim banner shown while the background analysis pass is running. Explains
// what's happening (and why) and reassures the DJ the library is usable now.
// Hidden whenever nothing is being processed.
function AnalysisBanner() {
  const { analysis } = useStore();
  const a = analysis || {};
  if (!a.running) return null;
  const total = a.total || 0;
  const completed = a.completed || 0;
  const remaining = Math.max(0, total - completed);
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  return (
    <div className="tp-analyze-banner" role="status">
      <span className="tp-analyze-spinner" aria-hidden="true" />
      <div className="tp-analyze-text">
        <div className="tp-analyze-title">Preparing your music</div>
        <div className="tp-analyze-sub">
          Leveling each song’s volume and trimming silence at the start and end so every
          tanda plays evenly — you can keep using everything while this finishes.
        </div>
        <div className="tp-analyze-bar"><div className="tp-analyze-bar-fill" style={{ width: pct + "%" }} /></div>
      </div>
      <div className="tp-analyze-count">
        <span className="tp-mono">{remaining}</span>
        <span className="tp-analyze-count-lbl">{remaining === 1 ? "song left" : "songs left"}</span>
      </div>
    </div>
  );
}

Object.assign(window, { LivePlayer, PlayerProvider, PlayerBar, usePlayer, AnalysisBanner, MissingCortinaHint, itemSongs, queueDurationSec, actsAsCortina });
