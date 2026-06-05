// app-player.jsx — Compás, the single-page live player (desktop)
// Left: choose tandas & cortinas to play next · Right: tonight's queue · Bottom: transport
// Audio is real: each song streams from compas-audio://song/<id> through Howler.
const { useState, useRef, useMemo, useEffect, useCallback } = React;

let _kid = 100;
const kid = () => "q" + (_kid++);
const mk = (type, data, extra = {}) => ({ key: kid(), type, data, ...extra });

const FADE_TO_TANDA_MS = 2500;

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
// For a tanda item, the playable song is data.songs[ix]; for a cortina the data IS the song.
function songOf(item, ix) {
  if (!item) return null;
  if (item.type === "cortina") return item.data || null;
  const songs = (item.data && item.data.songs) || [];
  return songs[ix] || null;
}
function itemSongs(item) {
  if (!item) return [];
  return item.type === "cortina" ? [item.data] : ((item.data && item.data.songs) || []);
}
function queueDurationSec(queue) {
  return queue.reduce((a, it) => a + itemSongs(it).reduce((b, s) => b + (s.durationSec || secOf(s.dur)), 0), 0);
}

/* ============================ LIBRARY (left) ============================ */

function LibPlaylistCard({ pl, added, onAdd }) {
  const tandaCount = pl.items.filter((i) => i.type === "tanda").length;
  const cortinaCount = pl.items.filter((i) => i.type === "cortina").length;
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

function LibraryPanel({ tandas, playlists, onAddTanda, onAddSong, onAddPlaylist, makeDrag, draggingId, preview, flash }) {
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

  const placeholder = tab === "tandas" ? "Search orchestras, singers, titles…" : "Search playlists…";

  return (
    <div className="tp-lib">
      <div className="tp-lib-head">
        <div>
          <div className="tp-eyebrow">Add to tonight</div>
          <div className="tp-lib-title">Choose what plays next</div>
        </div>
        <div className="tp-tabs">
          <button className={"tp-tab" + (tab === "tandas" ? " is-on" : "")} onClick={() => setTab("tandas")}>Tandas</button>
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
            {tab === "playlists" && filteredPlaylists.map((p) => (
              <LibPlaylistCard key={p.id} pl={p} added={flash === "p:" + p.id} onAdd={() => onAddPlaylist(p)} />
            ))}
            {tab === "tandas" && filteredTandas.length === 0 && (
              <div className="tp-empty">{tandas.length ? "No tandas match." : "No tandas yet — build some in the Tandas view."}</div>
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

function QSong({ n, title, dur, state, onPlay }) {
  return (
    <div className={"tp-songrow" + (state === "now" ? " is-now" : "") + (onPlay ? " is-clickable" : "")}
      style={state === "done" ? { opacity: .4 } : null}
      onClick={onPlay ? (e) => { e.stopPropagation(); onPlay(); } : undefined}
      title={onPlay ? "Play this song" : undefined}>
      <span className="n">{state === "now" ? <EQ /> : <><span className="qn">{n}</span><I.play s={12} /></>}</span>
      <span className="tt"><div className="tp-song-title">{title}</div></span>
      <span className="tp-song-dur">{dur}</span>
    </div>
  );
}

function QueueTanda({ item, ix, now, nowIx, onPlay, onPlaySong, onRemove, drag }) {
  const t = item.data;
  const m = tandaMeta(t);
  const { className: dragCls = "", ...handlers } = drag;
  return (
    <div className={"tp-tandacard tp-qrow" + (now ? " is-now" : "") + " " + dragCls} {...handlers}
      onClick={onPlay}>
      <div className="tp-tanda-head">
        {!now && <span className="tp-grip" title="Drag to reorder"><I.grip s={15} /></span>}
        <span className="ix">{now ? "NOW" : String(ix).padStart(2, "0")}</span>
        <span className="tp-now-orq" style={{ flex: 1 }}>{t.name || m.orq}</span>
        <GenreTag genre={m.genre} small />
        {m.decade && <span className="tp-tag is-plain sm">{m.decade}</span>}
        {!now && <button className="tp-qx" onClick={(e) => { e.stopPropagation(); onRemove(); }} title="Remove"><I.x s={14} /></button>}
      </div>
      {t.songs.map((s, i) => (
        <QSong key={s.id} n={i + 1} title={s.title} dur={s.dur || "—"}
          state={now ? (i < nowIx ? "done" : i === nowIx ? "now" : "up") : "up"}
          onPlay={() => onPlaySong(i)} />
      ))}
    </div>
  );
}

function QueueCortina({ item, now, onPlay, onRemove, drag }) {
  const c = item.data;
  const { className: dragCls = "", ...handlers } = drag;
  return (
    <div className={"tp-cortina tp-qrow" + (now ? " is-now" : "") + " " + dragCls} {...handlers}
      onClick={onPlay}>
      <div className="curtain"></div>
      <span className="tp-grip dark" title="Drag to reorder"><I.grip s={15} /></span>
      <I.curtain s={17} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="tp-cortina-label">{now ? "Cortina · playing" : "Cortina"}</div>
        <div className="tp-cortina-sub">“{c.title}” · {c.orq || "Cortina"}</div>
      </div>
      <div className="tp-fade">{now ? <EQ /> : <I.clock s={13} />} {c.dur}</div>
      <button className="tp-qx dark" onClick={(e) => { e.stopPropagation(); onRemove(); }} title="Remove"><I.x s={14} /></button>
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

function QueuePanel({ queue, nowKey, nowIx, now, pos, onPlay, onPlaySongAt, onRemove, onReorder, onInsertSong, onFadeToTanda, onSavePlaylist, cortinaSnippetEnabled, cortinaSnippetSec }) {
  const dragKey = useRef(null);              // set while reordering an existing queue item
  const [overKey, setOverKey] = useState(null);
  const [overEnd, setOverEnd] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [savingNow, setSavingNow] = useState(false);
  const saveInputRef = useRef(null);
  const { toast, flash, dismiss } = useToast();
  const tandaCount = queue.filter(i => i.type === "tanda").length;
  const setTotal = fmtDur(queueDurationSec(queue));

  const openSave = () => { setSaveName(defaultPlaylistName()); setSaveOpen(true); };
  const closeSave = () => { setSaveOpen(false); setSavingNow(false); };
  useEffect(() => {
    if (saveOpen && saveInputRef.current) { saveInputRef.current.focus(); saveInputRef.current.select(); }
  }, [saveOpen]);
  // Close the namer if the queue empties out from under it.
  useEffect(() => { if (!queue.length && saveOpen) closeSave(); }, [queue.length]); // eslint-disable-line

  const commitSave = () => {
    if (savingNow || !queue.length) return;
    setSavingNow(true);
    Promise.resolve(onSavePlaylist(saveName))
      .then(() => { closeSave(); flash("Saved to Playlists"); })
      .catch(() => { setSavingNow(false); flash("Couldn’t save playlist"); });
  };

  // While a cortina is on air, surface a quick "fade to next tanda" action that
  // floats over the queue — the DJ shouldn't have to hunt for it in the transport.
  const cortinaPlaying = now && now.type === "cortina";
  const upcomingTanda = cortinaPlaying ? nextTandaAfter(queue, now.key) : null;

  const clearDrag = () => { dragKey.current = null; setOverKey(null); setOverEnd(false); };

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
    onDragOver: (e) => { e.preventDefault(); if (e.target === e.currentTarget && !overEnd) setOverEnd(true); },
    onDrop: (e) => handleDrop(e, null),
    onDragLeave: (e) => { if (!e.currentTarget.contains(e.relatedTarget)) clearDrag(); },
  };

  let tIx = 0;
  return (
    <div className="tp-queue">
      {cortinaPlaying && upcomingTanda && (
        <div className="tp-fade-float">
          <button className="tp-chip warn tp-fade-float-btn" onClick={onFadeToTanda}>
            <I.fwd s={15} /> Fade to next tanda
            <span className="tp-chip-tail"> · {tandaMeta(upcomingTanda.data).orq}</span>
          </button>
          {cortinaSnippetEnabled && (
            <div className="tp-fade-float-note">
              Auto-fade in {fmtDur(Math.max(0, cortinaSnippetSec - (pos || 0)))}
            </div>
          )}
        </div>
      )}
      <div className="tp-qhead">
        <div className="tp-qhead-l">
          <div className="tp-eyebrow">Tonight</div>
          <div className="tp-q-title">Up next</div>
        </div>
        <div className="tp-qhead-r">
          <div className="tp-q-stat">
            <span><b>{tandaCount}</b> tandas queued</span>
            <span className="tp-dotsep">·</span>
            <span className="tp-mono">set {setTotal}</span>
          </div>
          <button className="tp-savepl" onClick={openSave} disabled={!queue.length || saveOpen}
            title={queue.length ? "Save this set as a playlist" : "Add tandas to save a playlist"}>
            <I.plus s={14} /> Save as playlist
          </button>
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
          <button className="tp-qsave-save" onClick={commitSave} disabled={savingNow}>
            <I.check s={15} /> {savingNow ? "Saving…" : "Save"}
          </button>
          <button className="tp-qsave-cancel" onClick={closeSave}>Cancel</button>
        </div>
      )}

      <div className={"tp-q-scroll" + (overEnd ? " drop-end" : "")} {...listDrop}>
        {queue.map((item, i) => {
          if (item.type === "tanda") tIx += 1;
          const dp = dragProps(item);
          const isNow = item.key === nowKey;
          const prev = queue[i - 1];
          const gap = item.type === "tanda" && prev && prev.type === "tanda";
          const row = item.type === "tanda"
            ? <QueueTanda key={item.key} item={item} ix={tIx} now={isNow} nowIx={isNow ? nowIx : 0} onPlay={() => onPlay(item.key)} onPlaySong={(ix) => onPlaySongAt(item.key, ix)} onRemove={() => onRemove(item.key)} drag={dp} />
            : <QueueCortina key={item.key} item={item} now={isNow} onPlay={() => onPlay(item.key)} onRemove={() => onRemove(item.key)} drag={dp} />;
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
  if (!now) {
    return (
      <div className="tp-nowbar">
        <div className="tp-nb-meta">
          <div className="tp-nb-mark"><I.note s={16} /></div>
          <div style={{ minWidth: 0 }}>
            <div className="tp-nb-title">Nothing playing</div>
            <div className="tp-nb-sub">Add a tanda or cortina, then press play</div>
          </div>
        </div>
        <div className="tp-nb-wave" />
        <div className="tp-nb-ctrls">
          <button className="tp-tbtn" style={{ width: 40, height: 40 }} disabled><I.prev s={16} /></button>
          <button className="tp-tbtn play" style={{ width: 52, height: 52 }} disabled><I.play s={22} /></button>
          <button className="tp-tbtn" style={{ width: 40, height: 40 }} disabled><I.next s={16} /></button>
          <VolumeControl volume={volume} muted={muted} onVolume={onVolume} onToggleMute={onToggleMute} />
        </div>
      </div>
    );
  }

  const remain = Math.max(0, (dur || 0) - (pos || 0));
  const isCortina = now.type === "cortina";

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
            <div className="tp-nb-cortitle">“{c.title}”</div>
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
          <button className="tp-tbtn" style={{ width: 40, height: 40 }} onClick={onPrev}><I.prev s={16} /></button>
          <button className="tp-tbtn play" style={{ width: 52, height: 52 }} onClick={onPlayPause}>
            {playing ? <I.pause s={22} /> : <I.play s={22} />}
          </button>
          <button className="tp-tbtn" style={{ width: 40, height: 40 }} onClick={onNext}><I.next s={16} /></button>
          <button className="tp-chip warn" style={{ marginLeft: 6 }} onClick={onFadeToTanda} disabled={!upcoming}>
            <I.fwd s={15} /> Fade to next tanda{upcoming ? <span className="tp-chip-tail"> · {tandaMeta(upcoming.data).orq}</span> : null}
          </button>
          <VolumeControl volume={volume} muted={muted} onVolume={onVolume} onToggleMute={onToggleMute} />
        </div>
      </div>
    );
  }

  const t = now.data;
  const song = songOf(now, nowIx);
  const m = tandaMeta(t);
  return (
    <div className="tp-nowbar">
      <div className="tp-nb-meta">
        <div className="tp-nb-mark">{playing ? <EQ /> : <I.pause s={16} />}</div>
        <div style={{ minWidth: 0 }}>
          <div className="tp-nb-title">{song ? song.title : "—"}</div>
          <div className="tp-nb-sub"><b>{m.orq}</b>{song && song.singer ? " · " + song.singer : ""}</div>
        </div>
        <span className="tp-nb-dots">
          {t.songs.map((_, i) => <span key={i} className={"tp-dot" + (i < nowIx ? " done" : i === nowIx ? " now" : "")}></span>)}
        </span>
      </div>

      <div className="tp-nb-wave">
        <span className="tp-mono tp-nb-t">{fmtDur(pos)}</span>
        <div style={{ flex: 1, minWidth: 0, cursor: dur > 0 ? "pointer" : "default" }}
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
        <button className="tp-tbtn" style={{ width: 40, height: 40 }} onClick={onPrev}><I.prev s={16} /></button>
        <button className="tp-tbtn play" style={{ width: 52, height: 52 }} onClick={onPlayPause}>
          {playing ? <I.pause s={22} /> : <I.play s={22} />}
        </button>
        <button className="tp-tbtn" style={{ width: 40, height: 40 }} onClick={onNext}><I.next s={16} /></button>
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
  stateRef.current = { queue, nowKey, nowIx, playing, preview, mainDeviceId, cortinaSnippetEnabled, cortinaSnippetSec, normalizeEnabled, targetLufs, trimSilenceEnabled, trimPadMs, trimEverywhere, songGapSec };

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
    const item = s.queue.find((i) => i.key === s.nowKey);
    if (!item || item.type !== "cortina") return;
    if (cur < s.cortinaSnippetSec) return;
    const t = nextTandaAfter(s.queue, s.nowKey);
    if (!t) return;   // nothing to fade into — let it play out
    snippetFiredRef.current = true;
    advancingRef.current = true;
    h.fade(h.volume(), 0, FADE_TO_TANDA_MS);
    setTimeout(() => {
      advancingRef.current = false;
      setPreview(null); setNowKey(t.key); setNowIx(0); setPlaying(true);
    }, FADE_TO_TANDA_MS);
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
    if (item.type === "tanda" && nowIx < ((item.data.songs || []).length - 1)) return true;
    const idx = queue.findIndex((i) => i.key === nowKey);
    return idx >= 0 && idx < queue.length - 1;
  }

  function advance() {
    clearGapTimer();
    advancingRef.current = false;
    const { preview, queue, nowKey, nowIx } = stateRef.current;
    if (preview) { setPreview(null); setPlaying(false); return; }
    const item = queue.find((i) => i.key === nowKey);
    if (!item) { setPlaying(false); return; }
    if (item.type === "tanda" && nowIx < ((item.data.songs || []).length - 1)) {
      setNowIx(nowIx + 1);
      return;
    }
    const idx = queue.findIndex((i) => i.key === nowKey);
    const next = idx >= 0 ? queue[idx + 1] : null;
    if (next) { setNowKey(next.key); setNowIx(0); }
    else { setPlaying(false); }
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
  const reorder = (fromKey, toKey) => setQueue((q) => {
    const from = q.findIndex((i) => i.key === fromKey), to = q.findIndex((i) => i.key === toKey);
    if (from < 0 || to < 0 || from === to) return q;
    const copy = q.slice();
    const [m] = copy.splice(from, 1);
    copy.splice(to, 0, m);
    return copy;
  });

  const playItem = (key) => {
    if (preview) setPreview(null);
    if (!preview && key === nowKey) { setPlaying((p) => !p); return; }
    setNowKey(key); setNowIx(0); setPlaying(true);
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
    if (!t) return;
    const h = howlRef.current;
    if (h && h.playing()) {
      advancingRef.current = true;
      h.fade(h.volume(), 0, FADE_TO_TANDA_MS);
      setTimeout(() => { advancingRef.current = false; setPreview(null); setNowKey(t.key); setNowIx(0); setPlaying(true); }, FADE_TO_TANDA_MS);
    } else {
      setPreview(null); setNowKey(t.key); setNowIx(0); setPlaying(true);
    }
  };

  // Re-arm the cortina snippet whenever the now-playing item changes, so the
  // auto-fade (driven from the playback tick above) fires once per cortina.
  useEffect(() => { snippetFiredRef.current = false; }, [nowKey]);

  // Let the main process pause the background analysis pool while the floor is
  // live, so ffmpeg never competes with playback for CPU.
  useEffect(() => {
    try { if (window.compas.setAnalysisPlaying) window.compas.setAnalysisPlaying(playing); }
    catch (_e) { /* older main without the channel */ }
  }, [playing]);

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

  return {
    queue, now, nowKey: displayKey, nowIx: displayIx, playing, pos, dur, flash,
    cortinaSnippetEnabled, cortinaSnippetSec,
    error, dismissError: () => { clearTimeout(errTimer.current); setError(null); },
    volume, muted, setVolume: (v) => { setVolume(Math.min(1, Math.max(0, v))); if (v > 0) setMuted(false); },
    toggleMute: () => setMuted((m) => !m),
    previewId: preview ? preview.id : null,
    addTanda, addCortina, addPlaylist, insertSong, remove, reorder,
    playItem, playItemAt, playPause, prev, next, seek, fadeToTanda,
    previewSong, loadPlaylist, saveQueueAsPlaylist,
  };
}

/* ============================ PLAYBACK SETTINGS ============================ */
// DJ playback preferences that aren't about devices. Right now: "cortina snippet"
// — only play the first few seconds of a cortina, then auto-fade to the next
// tanda. Persisted in localStorage so the choice survives restarts.
const CORTINA_SNIPPET_DEFAULT_SEC = 90;
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
    const onEnd = () => { setPlaying(false); setPos(0); stopTick(); };
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

  const cue = useCallback((s) => {
    const a = audioRef.current;
    if (!s || !a) return;
    if (song && song.id === s.id) { if (a.paused) a.play().catch(() => {}); else a.pause(); return; }
    setSong(s); setPos(0); setDur(0);
    a.src = window.compas.audioUrl(s.id);
    const start = () => a.play().catch(() => {});
    // Set the sink before the first play so the preview never leaks onto main.
    if (typeof a.setSinkId === "function" && monitorDeviceId) {
      a.setSinkId(monitorDeviceId).then(start, start);
    } else start();
  }, [song, monitorDeviceId]);

  const toggle = useCallback(() => {
    const a = audioRef.current;
    if (!a || !song) return;
    if (a.paused) a.play().catch(() => {}); else a.pause();
  }, [song]);

  const stop = useCallback(() => {
    const a = audioRef.current;
    if (a) { a.pause(); a.removeAttribute("src"); a.load(); }
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

  return { song, playing, pos, dur, volume, cue, toggle, stop, seek, setVolume };
}

function PlayerProvider({ children }) {
  const devices = useAudioDevices();
  const playback = usePlaybackSettings();
  const engine = usePlayerEngine(devices.mainDeviceId, playback);
  const cueEngine = useCueEngine(devices.monitorDeviceId);

  // When the floor needs a cued track, hand it to the live queue and clear cue.
  const sendCueToFloor = () => {
    if (!cueEngine.song) return;
    engine.insertSong(cueEngine.song, null);
    cueEngine.stop();
  };

  // Unified "listen" affordance for the library/tandas play buttons. With a
  // monitor ready, auditioning a song routes to the headphone card so the floor
  // is never interrupted; otherwise it falls back to the single shared engine.
  const preview = devices.monitorReady
    ? { previewId: cueEngine.song ? cueEngine.song.id : null, playing: cueEngine.playing, toggle: cueEngine.cue, viaMonitor: true }
    : { previewId: engine.previewId, playing: engine.playing, toggle: engine.previewSong, viaMonitor: false };

  const value = { ...engine, devices, playback, cue: cueEngine, sendCueToFloor, preview };
  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}

/* ============================ LIVE PLAYER (library + queue) ============================ */

function LivePlayer() {
  const { tandas, playlists } = useStore();
  const p = usePlayer();
  const [draggingId, setDraggingId] = useState(null);

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
      <LibraryPanel tandas={tandas} playlists={playlists}
        onAddTanda={p.addTanda} onAddSong={p.addCortina} onAddPlaylist={p.addPlaylist}
        makeDrag={makeDrag} draggingId={draggingId} preview={preview} flash={p.flash} />
      <QueuePanel queue={p.queue} nowKey={p.nowKey} nowIx={p.nowIx} now={p.now} pos={p.pos} onPlay={p.playItem} onPlaySongAt={p.playItemAt} onRemove={p.remove} onReorder={p.reorder} onInsertSong={p.insertSong} onSavePlaylist={p.saveQueueAsPlaylist} onFadeToTanda={p.fadeToTanda} cortinaSnippetEnabled={p.cortinaSnippetEnabled} cortinaSnippetSec={p.cortinaSnippetSec} />
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
function CueBar({ cue, monitorLabel, onSendToFloor }) {
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
          <div className="tp-cb-eyebrow">Monitor{monitorLabel ? " · " + monitorLabel : ""}</div>
          <div className="tp-cb-title">{song.title}</div>
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
        <button className="tp-chip cue" onClick={onSendToFloor} title="Add this track to the live queue">
          <I.arrowDn s={15} /> Send to floor
        </button>
        <button className="tp-tbtn sm ghost" onClick={cue.stop} title="Close monitor"><I.x s={16} /></button>
        <div className="tp-nb-vol" title="Monitor volume">
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
      <CueBar cue={p.cue} monitorLabel={p.devices.labelFor(p.devices.monitorDeviceId)} onSendToFloor={p.sendCueToFloor} />
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
        <div className="tp-analyze-title">
          Preparing your music{a.paused ? " · paused while playing" : ""}
        </div>
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

Object.assign(window, { LivePlayer, PlayerProvider, PlayerBar, usePlayer, AnalysisBanner });
