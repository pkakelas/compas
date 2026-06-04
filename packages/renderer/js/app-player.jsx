// app-player.jsx — Compás, the single-page live player (desktop)
// Left: choose tandas & cortinas to play next · Right: tonight's queue · Bottom: transport
// Audio is real: each song streams from compas-audio://song/<id> through Howler.
const { useState, useRef, useMemo, useEffect } = React;

let _kid = 100;
const kid = () => "q" + (_kid++);
const mk = (type, data, extra = {}) => ({ key: kid(), type, data, ...extra });

const XF_TAIL_MS = 3000;      // auto-crossfade: start fading this long before the end
const FADE_TO_TANDA_MS = 2500;

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

function GenreTag({ genre, small }) {
  return <span className={"tp-tag is-" + genre} style={small ? { height: 19, fontSize: 10, padding: "0 7px" } : null}>{GENRE_LABEL[genre] || "Tango"}</span>;
}

function LibTandaCard({ t, added, onAdd }) {
  const m = tandaMeta(t);
  return (
    <div className="tp-libcard">
      <div className="tp-libcard-main">
        <div className="tp-libcard-top">
          <span className="tp-libcard-orq">{t.name || m.orq}</span>
          <GenreTag genre={m.genre} small />
          {m.decade && <span className="tp-tag is-plain" style={{ height: 19, fontSize: 10, padding: "0 7px" }}>{m.decade}</span>}
        </div>
        <div className="tp-libcard-songs">
          {t.songs.map((s, i) => (
            <span key={s.id} className="tp-libsong">{s.title}{i < t.songs.length - 1 ? <span className="tp-dotsep">·</span> : null}</span>
          ))}
        </div>
        <div className="tp-libcard-meta">
          {m.singer}
          <span className="tp-dotsep">·</span>{t.songs.length} songs<span className="tp-dotsep">·</span>
          <span className="tp-mono">{m.total}</span>
        </div>
      </div>
      <button className={"tp-addbtn" + (added ? " is-added" : "")} onClick={onAdd} title="Add tanda to queue">
        {added ? <I.check s={16} /> : <I.plus s={16} />}
      </button>
    </div>
  );
}

function LibCortinaRow({ c, added, onAdd }) {
  return (
    <div className="tp-cortrow">
      <span className="tp-cortrow-ic"><I.curtain s={15} /></span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="tp-cortrow-title">{c.title}</div>
        <div className="tp-cortrow-meta">{c.orq || "Cortina"}<span className="tp-dotsep">·</span><span className="tp-mono">{c.dur}</span></div>
      </div>
      <span className="tp-tag is-plain" style={{ height: 19, fontSize: 10, padding: "0 7px" }}>{c.folder || "Cortina"}</span>
      <button className={"tp-addbtn sm" + (added ? " is-added" : "")} onClick={onAdd} title="Add cortina to queue">
        {added ? <I.check s={15} /> : <I.plus s={15} />}
      </button>
    </div>
  );
}

function LibPlaylistCard({ pl, added, onAdd }) {
  const tandaCount = pl.items.filter((i) => i.type === "tanda").length;
  const cortinaCount = pl.items.filter((i) => i.type === "cortina").length;
  const total = fmtDur(queueDurationSec(pl.items));
  return (
    <div className="tp-libcard">
      <div className="tp-libcard-main">
        <div className="tp-libcard-top">
          <span className="tp-libcard-orq">{pl.name || "Untitled playlist"}</span>
          <span className="tp-tag is-plain" style={{ height: 19, fontSize: 10, padding: "0 7px" }}>Playlist</span>
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

function LibraryPanel({ tandas, cortinas, playlists, onAddTanda, onAddCortina, onAddPlaylist, flash }) {
  const [tab, setTab] = useState("tandas");
  const [genre, setGenre] = useState("all");
  const [q, setQ] = useState("");

  const filteredTandas = useMemo(() => tandas.filter((t) => {
    const m = tandaMeta(t);
    const hay = ((t.name || "") + " " + m.orq + " " + m.singer + " " + t.songs.map((s) => s.title).join(" ")).toLowerCase();
    return (genre === "all" || m.genre === genre) && (q.trim() === "" || hay.includes(q.toLowerCase()));
  }), [tandas, genre, q]);

  const filteredCortinas = useMemo(() => cortinas.filter((c) =>
    q.trim() === "" || ((c.title || "") + " " + (c.orq || "") + " " + (c.folder || "")).toLowerCase().includes(q.toLowerCase())
  ), [cortinas, q]);

  const filteredPlaylists = useMemo(() => playlists.filter((p) => {
    const hay = ((p.name || "") + " " + p.items.map((it) =>
      it.type === "cortina" ? it.data.title : (it.data.name || tandaMeta(it.data).orq)).join(" ")).toLowerCase();
    return q.trim() === "" || hay.includes(q.toLowerCase());
  }), [playlists, q]);

  const placeholder = tab === "tandas" ? "Search orchestras, singers, titles…"
    : tab === "cortinas" ? "Search cortinas…" : "Search playlists…";

  return (
    <div className="tp-lib">
      <div className="tp-lib-head">
        <div>
          <div className="tp-eyebrow">Add to tonight</div>
          <div className="tp-lib-title">Choose what plays next</div>
        </div>
        <div className="tp-tabs">
          <button className={"tp-tab" + (tab === "tandas" ? " is-on" : "")} onClick={() => setTab("tandas")}>Tandas</button>
          <button className={"tp-tab" + (tab === "cortinas" ? " is-on" : "")} onClick={() => setTab("cortinas")}>Cortinas</button>
          <button className={"tp-tab" + (tab === "playlists" ? " is-on" : "")} onClick={() => setTab("playlists")}>Playlists</button>
        </div>
      </div>

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
          <LibTandaCard key={t.id} t={t} added={flash === "t:" + t.id} onAdd={() => onAddTanda(t)} />
        ))}
        {tab === "cortinas" && filteredCortinas.map((c) => (
          <LibCortinaRow key={c.id} c={c} added={flash === "c:" + c.id} onAdd={() => onAddCortina(c)} />
        ))}
        {tab === "playlists" && filteredPlaylists.map((p) => (
          <LibPlaylistCard key={p.id} pl={p} added={flash === "p:" + p.id} onAdd={() => onAddPlaylist(p)} />
        ))}
        {tab === "tandas" && filteredTandas.length === 0 && (
          <div className="tp-empty">{tandas.length ? "No tandas match." : "No tandas yet — build some in the Tandas view."}</div>
        )}
        {tab === "cortinas" && filteredCortinas.length === 0 && (
          <div className="tp-empty">{cortinas.length ? "No cortinas match." : "No cortinas found — put short clips in a folder named “Cortinas”."}</div>
        )}
        {tab === "playlists" && filteredPlaylists.length === 0 && (
          <div className="tp-empty">{playlists.length ? "No playlists match." : "No playlists yet — build one in the Playlists view."}</div>
        )}
      </div>
    </div>
  );
}

/* ============================ QUEUE (right) ============================ */

function QSong({ n, title, dur, state }) {
  return (
    <div className={"tp-songrow" + (state === "now" ? " is-now" : "")} style={state === "done" ? { opacity: .4 } : null}>
      <span className="n">{state === "now" ? <EQ /> : n}</span>
      <span className="tt"><div className="tp-song-title">{title}</div></span>
      <span className="tp-song-dur">{dur}</span>
    </div>
  );
}

function QueueTanda({ item, ix, now, nowIx, onPlay, onRemove, drag }) {
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
        {m.decade && <span className="tp-tag is-plain" style={{ height: 19, fontSize: 10, padding: "0 7px" }}>{m.decade}</span>}
        {!now && <button className="tp-qx" onClick={(e) => { e.stopPropagation(); onRemove(); }} title="Remove"><I.x s={14} /></button>}
      </div>
      {t.songs.map((s, i) => (
        <QSong key={s.id} n={i + 1} title={s.title} dur={s.dur || "—"}
          state={now ? (i < nowIx ? "done" : i === nowIx ? "now" : "up") : "up"} />
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

function QueuePanel({ queue, nowKey, nowIx, onPlay, onRemove, onReorder }) {
  const dragKey = useRef(null);
  const [overKey, setOverKey] = useState(null);
  const tandaCount = queue.filter(i => i.type === "tanda").length;
  const setTotal = fmtDur(queueDurationSec(queue));

  const dragProps = (item) => {
    return {
      draggable: true,
      onDragStart: (e) => { dragKey.current = item.key; e.dataTransfer.effectAllowed = "move"; },
      onDragEnd: () => { dragKey.current = null; setOverKey(null); },
      onDragOver: (e) => { e.preventDefault(); if (overKey !== item.key) setOverKey(item.key); },
      onDrop: (e) => { e.preventDefault(); onReorder(dragKey.current, item.key); dragKey.current = null; setOverKey(null); },
      className: "tp-qdrag" + (overKey === item.key && dragKey.current && dragKey.current !== item.key ? " is-over" : "") + (dragKey.current === item.key ? " is-dragging" : ""),
    };
  };

  let tIx = 0;
  return (
    <div className="tp-queue">
      <div className="tp-qhead">
        <div>
          <div className="tp-eyebrow">Tonight</div>
          <div className="tp-q-title">Up next</div>
        </div>
        <div className="tp-q-stat">
          <span><b>{tandaCount}</b> tandas queued</span>
          <span className="tp-dotsep">·</span>
          <span className="tp-mono">set {setTotal}</span>
        </div>
      </div>
      <div className="tp-q-scroll">
        {queue.map((item) => {
          if (item.type === "tanda") tIx += 1;
          const dp = dragProps(item);
          const isNow = item.key === nowKey;
          return item.type === "tanda"
            ? <QueueTanda key={item.key} item={item} ix={tIx} now={isNow} nowIx={isNow ? nowIx : 0} onPlay={() => onPlay(item.key)} onRemove={() => onRemove(item.key)} drag={dp} />
            : <QueueCortina key={item.key} item={item} now={isNow} onPlay={() => onPlay(item.key)} onRemove={() => onRemove(item.key)} drag={dp} />;
        })}
        <div className="tp-q-end">{queue.length ? "End of queue — add tandas & cortinas from the left" : "Empty queue — add tandas & cortinas from the left"}</div>
      </div>
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

function NowBar({ now, nowIx, queue, playing, pos, dur, autoXf, onPlayPause, onPrev, onNext, onSeek, onFadeToTanda, onToggleXf }) {
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
        </div>
      </div>
    );
  }

  const remain = Math.max(0, (dur || 0) - (pos || 0));
  const isCortina = now.type === "cortina";

  if (isCortina) {
    const c = now.data;
    const upcoming = nextTandaAfter(queue, now.key);
    return (
      <div className="tp-nowbar is-cortina">
        <div className="tp-nb-meta">
          <div className="tp-nb-mark cortina"><I.curtain s={18} /></div>
          <div style={{ minWidth: 0 }}>
            <div className="tp-nb-eyebrow">Cortina · floor clears</div>
            <div className="tp-nb-cortitle">“{c.title}”</div>
            <div className="tp-nb-sub">{c.orq || "Cortina"}</div>
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
          <label className="tp-toggle" style={{ marginLeft: 6 }} onClick={onToggleXf}>
            <span className={"tp-switch" + (autoXf ? " on" : "")}></span> Auto-crossfade
          </label>
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
          <div className="tp-nb-sub"><b>{m.orq}</b> · {song && song.singer ? song.singer : "Instrumental"}</div>
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
        <label className="tp-toggle" style={{ marginLeft: 12 }} onClick={onToggleXf}>
          <span className={"tp-switch" + (autoXf ? " on" : "")}></span> Auto-crossfade
        </label>
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

function usePlayerEngine() {
  const [queue, setQueue] = useState([]);
  const [nowKey, setNowKey] = useState(null);
  const [nowIx, setNowIx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const [dur, setDur] = useState(0);
  const [autoXf, setAutoXf] = useState(false);
  const [flash, setFlash] = useState(null);
  const [preview, setPreview] = useState(null);   // a standalone song played outside the queue
  const flashTimer = useRef(null);

  const howlRef = useRef(null);
  const tickRef = useRef(null);
  const advancingRef = useRef(false);    // guards double-advance (rAF fade vs onend)

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
  stateRef.current = { queue, nowKey, nowIx, autoXf, playing, preview };

  const stopTick = () => { if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; } };
  const startTick = () => {
    stopTick();
    tickRef.current = setInterval(() => {
      const h = howlRef.current;
      if (!h) return;
      const p = h.seek();
      const cur = typeof p === "number" ? p : 0;
      setPos(cur);
      const d = h.duration() || 0;
      // auto-crossfade: fade the tail out and advance early
      if (stateRef.current.autoXf && d > 0 && !advancingRef.current && (d - cur) * 1000 <= XF_TAIL_MS) {
        if (hasNext()) { advancingRef.current = true; h.fade(h.volume(), 0, Math.max(200, (d - cur) * 1000)); setTimeout(advance, Math.max(200, (d - cur) * 1000)); }
      }
    }, 200);
  };

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

  // Load the current song into a fresh Howl whenever it changes.
  useEffect(() => {
    stopTick();
    if (howlRef.current) { howlRef.current.unload(); howlRef.current = null; }
    setPos(0); setDur(0);
    advancingRef.current = false;
    if (!currentId) return;

    const fadeIn = stateRef.current.autoXf;
    const howl = new Howl({
      src: [window.compas.audioUrl(currentId)],
      html5: true,
      // compas-audio:// URLs carry no extension; hint a format so Howler's codec
      // gate passes. In html5 mode the browser decodes the real stream itself.
      format: ["mp3"],
      volume: fadeIn ? 0 : 1,
      onload: () => setDur(howl.duration() || 0),
      onplay: () => {
        setDur(howl.duration() || 0);
        setPlaying(true);
        if (fadeIn) howl.fade(0, 1, Math.min(XF_TAIL_MS, (howl.duration() || 1) * 1000));
        startTick();
      },
      onpause: () => { setPlaying(false); stopTick(); },
      onstop: () => { stopTick(); },
      onend: () => { stopTick(); if (!advancingRef.current) advance(); },
      onloaderror: () => { advance(); },
      onplayerror: () => { howl.once("unlock", () => howl.play()); },
    });
    howlRef.current = howl;
    if (stateRef.current.playing) howl.play();

    return () => { stopTick(); howl.unload(); };
    // eslint-disable-next-line
  }, [currentId]);

  // Sync play/pause intent to the current Howl.
  useEffect(() => {
    const h = howlRef.current;
    if (!h) return;
    if (playing && !h.playing()) h.play();
    else if (!playing && h.playing()) h.pause();
    // eslint-disable-next-line
  }, [playing]);

  useEffect(() => () => { stopTick(); if (howlRef.current) howlRef.current.unload(); }, []);

  const ping = (id) => {
    setFlash(id);
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), 1100);
  };

  const addTanda = (t) => { setQueue((q) => [...q, mk("tanda", t)]); ping("t:" + t.id); };
  const addCortina = (c) => { setQueue((q) => [...q, mk("cortina", c)]); ping("c:" + c.id); };
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
  const seek = (sec) => { const h = howlRef.current; if (h) { h.seek(sec); setPos(sec); } };

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

  // Play a single song outside the queue (the Tandas-view song preview).
  const previewSong = (song) => {
    if (!song) return;
    if (preview && preview.id === song.id) { setPlaying((p) => !p); return; }
    setPreview(song);
    setPlaying(true);
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
    queue, now, nowKey: displayKey, nowIx: displayIx, playing, pos, dur, autoXf, flash,
    previewId: preview ? preview.id : null,
    addTanda, addCortina, addPlaylist, remove, reorder,
    playItem, playPause, prev, next, seek, fadeToTanda, toggleXf: () => setAutoXf((v) => !v),
    previewSong, loadPlaylist,
  };
}

function PlayerProvider({ children }) {
  const engine = usePlayerEngine();
  return <PlayerContext.Provider value={engine}>{children}</PlayerContext.Provider>;
}

/* ============================ LIVE PLAYER (library + queue) ============================ */

function LivePlayer() {
  const { tandas, songs, playlists } = useStore();
  const cortinas = useMemo(() => songs.filter((s) => s.genre === "cortina"), [songs]);
  const p = usePlayer();
  return (
    <div className="tp-main">
      <LibraryPanel tandas={tandas} cortinas={cortinas} playlists={playlists}
        onAddTanda={p.addTanda} onAddCortina={p.addCortina} onAddPlaylist={p.addPlaylist} flash={p.flash} />
      <QueuePanel queue={p.queue} nowKey={p.nowKey} nowIx={p.nowIx} onPlay={p.playItem} onRemove={p.remove} onReorder={p.reorder} />
    </div>
  );
}

// The transport bar reads everything from the shared player engine.
function PlayerBar() {
  const p = usePlayer();
  return (
    <NowBar now={p.now} nowIx={p.nowIx} queue={p.queue} playing={p.playing} pos={p.pos} dur={p.dur} autoXf={p.autoXf}
      onPlayPause={p.playPause} onPrev={p.prev} onNext={p.next} onSeek={p.seek}
      onFadeToTanda={p.fadeToTanda} onToggleXf={p.toggleXf} />
  );
}

Object.assign(window, { LivePlayer, PlayerProvider, PlayerBar, usePlayer });
