// playlists-view.jsx — the Playlists workspace. The landing is a grid of saved
// sets; opening one drops you into a live-style editor (a rich queue you can
// reorder, trim, add to, and audition) that auto-saves as you work.
const { useState, useMemo, useRef, useEffect, useCallback } = React;

/* ---------- local key generator for editor rows ---------- */
let _plKid = 1;
const plKid = () => "pl" + (_plKid++);

/* ---------- playlist meta helpers ---------- */
// itemSongs + queueDurationSec are shared with the live player (window globals).
function playlistMeta(items) {
  const list = items || [];
  // A single-song item is counted as a cortina only when it plays that role
  // (between tandas, or flagged cortina material); other single songs are loose.
  let cortinas = 0;
  list.forEach((it, i) => { if (it.type !== "tanda" && actsAsCortina(list, i)) cortinas += 1; });
  return {
    tandas: list.filter((i) => i.type === "tanda").length,
    cortinas,
    songs: list.reduce((a, it) => a + itemSongs(it).length, 0),
    total: fmtDur(queueDurationSec(list)),
  };
}
function itemTitle(it) {
  return it.type === "cortina" ? it.data.title : (it.data.name || tandaMeta(it.data).orq);
}

/* ---------- internal drag-to-reorder for the editor queue (index based) ---------- */
function usePLReorder(onReorder) {
  const [drag, setDrag] = useState(null);
  const [over, setOver] = useState(null);
  return (i) => ({
    dragging: drag === i,
    over: over === i && drag !== null && drag !== i,
    handlers: {
      draggable: true,
      onDragStart: (e) => { e.dataTransfer.effectAllowed = "move"; setDrag(i); },
      onDragEnd: () => { setDrag(null); setOver(null); },
      onDragOver: (e) => { e.preventDefault(); if (over !== i) setOver(i); },
      onDrop: (e) => { e.preventDefault(); if (drag !== null && drag !== i) onReorder(drag, i); setDrag(null); setOver(null); },
    },
  });
}

/* ============================ ADD LIBRARY (left) ============================ */
function PlAddCortinaRow({ c, onAdd }) {
  return (
    <div className="tp-cortrow">
      <span className="tp-cortrow-ic"><I.curtain s={15} /></span>
      <div className="tp-flex1">
        <div className="tp-cortrow-title">{c.title}</div>
        <div className="tp-cortrow-meta">{c.orq || "Cortina"}<span className="tp-dotsep">·</span><span className="tp-mono">{c.dur}</span></div>
      </div>
      <button className="tp-addbtn sm" onClick={onAdd} title="Add to playlist"><I.plus s={15} /></button>
    </div>
  );
}

function PlLibrary({ tandas, cortinas, onAdd, preview }) {
  const [tab, setTab] = useState("tandas");
  const [q, setQ] = useState("");

  const ft = useMemo(() => tandas.filter((t) => {
    const m = tandaMeta(t);
    const hay = ((t.name || "") + " " + m.orq + " " + m.singer + " " + t.songs.map((s) => s.title).join(" ")).toLowerCase();
    return q.trim() === "" || hay.includes(q.toLowerCase());
  }), [tandas, q]);

  const fc = useMemo(() => cortinas.filter((c) =>
    q.trim() === "" || ((c.title || "") + " " + (c.orq || "") + " " + (c.folder || "")).toLowerCase().includes(q.toLowerCase())
  ), [cortinas, q]);

  return (
    <div className="tp-lib">
      <div className="tp-lib-head">
        <div className="tv-title">Add items</div>
        <div className="tp-tabs">
          <button className={"tp-tab" + (tab === "tandas" ? " is-on" : "")} onClick={() => setTab("tandas")}>Tandas</button>
          <button className={"tp-tab" + (tab === "cortinas" ? " is-on" : "")} onClick={() => setTab("cortinas")}>Cortinas</button>
        </div>
      </div>

      <div className="tp-lib-controls">
        <label className="tp-search">
          <I.search s={16} />
          <input value={q} onChange={(e) => setQ(e.target.value)}
            placeholder={tab === "tandas" ? "Search tandas…" : "Search cortinas…"} />
        </label>
      </div>

      <div className="tp-lib-scroll">
        {tab === "tandas"
          ? ft.map((t) => <TandaLibCard key={t.id} t={t} preview={preview}
              onAdd={() => onAdd("tanda", t)} addTitle="Add to playlist" />)
          : fc.map((c) => <PlAddCortinaRow key={c.id} c={c} onAdd={() => onAdd("cortina", c)} />)}
        {tab === "tandas" && ft.length === 0 && (
          <div className="tp-empty">{tandas.length ? "No tandas match." : "No tandas yet — build some in the Tandas view."}</div>
        )}
        {tab === "cortinas" && fc.length === 0 && (
          <div className="tp-empty">{cortinas.length ? "No cortinas match." : "No cortinas found — put short clips in a folder named “Cortinas”."}</div>
        )}
      </div>
    </div>
  );
}

/* ---------- draggable divider between the library and the editor dock ----------
 * Mirrors the Live tab's QueueResizer: the dock is pinned right, so dragging
 * left widens it; width is clamped and committed (persisted) on release. */
const PL_DOCK_MIN_W = 360;
const PL_DOCK_MAX_W = 760;

function PlDockResizer({ width, min, max, onResize, onCommit }) {
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
    <div className="tv-resizer" onMouseDown={start} title="Drag to resize the playlist">
      <span className="grip" />
    </div>
  );
}

/* ============================ EDITOR QUEUE (right) ============================
 * The same visual language as the live queue: tandas read as full cards with
 * their song list, cortinas as the calm dark band. Rows are draggable to
 * reorder, every song auditions on click, and the × trims an item. */
function PlEditorSong({ n, title, dur, playing, onPlay, preview }) {
  return (
    <div className={"tp-songrow is-clickable" + (playing ? " is-now" : "")}
      onClick={(e) => { e.stopPropagation(); onPlay(); }} {...clickKeys(onPlay)}
      title={previewTitle(preview, playing, "Audition this song")}>
      <span className="n"><PreviewGlyph preview={preview} playing={playing} n={n} s={12} /></span>
      <span className="tt"><div className="tp-song-title">{title}</div></span>
      <span className="tp-song-dur">{dur}</span>
    </div>
  );
}

function PlEditorTanda({ it, ix, slot, onRemove, preview }) {
  const t = it.data;
  const m = tandaMeta(t);
  const songNameOnly = useSongNameOnly();
  return (
    <div className={"tp-tandacard pl-tandacard tp-qdrag" + (slot.dragging ? " is-dragging" : "") + (slot.over ? " is-over" : "")}
      {...slot.handlers}>
      <div className="tp-tanda-head">
        <span className="tp-grip" title="Drag to reorder"><I.grip s={15} /></span>
        <span className="ix">{String(ix).padStart(2, "0")}</span>
        <span className="tp-now-orq" style={{ flex: 1 }}>{t.name || m.orq}</span>
        <GenreTag genre={m.genre} small />
        {m.year && <span className="tp-tag is-plain sm" title={m.era}>{m.year}</span>}
        <button className="tp-qx" onClick={(e) => { e.stopPropagation(); onRemove(); }} title="Remove from playlist"><I.x s={14} /></button>
      </div>
      {t.songs.map((s, i) => {
        const playing = preview && preview.previewId === s.id && preview.playing;
        return <PlEditorSong key={s.id + ":" + i} n={i + 1} title={songNameOnly ? cleanSongTitle(s) : s.title} dur={s.dur || "—"}
          playing={playing} onPlay={() => preview && preview.toggle(s)} preview={preview} />;
      })}
    </div>
  );
}

function PlEditorCortina({ it, slot, onRemove, preview }) {
  const c = it.data;
  const playing = preview && preview.previewId === c.id && preview.playing;
  return (
    <div className={"tp-cortina tp-qrow tp-qdrag" + (slot.dragging ? " is-dragging" : "") + (slot.over ? " is-over" : "") + (playing ? " is-now" : "")}
      {...slot.handlers}
      onClick={() => preview && preview.toggle(c)} title={previewTitle(preview, playing, "Audition this cortina")}>
      <div className="curtain"></div>
      <span className="tp-grip dark" title="Drag to reorder"><I.grip s={15} /></span>
      <span className="tp-cort-glyph">{playing ? <EQ /> : (preview && preview.viaMonitor ? <span className="tp-cuebadge"><I.headphones s={14} /></span> : <I.curtain s={17} />)}</span>
      <div className="tp-flex1">
        <div className="tp-cortina-label">{playing ? "Cortina · playing" : "Cortina"}</div>
        <div className="tp-cortina-sub">“{c.title}” · {c.orq || "Cortina"}</div>
      </div>
      <div className="tp-fade"><I.clock s={13} /> {c.dur}</div>
      <button className="tp-qx dark" onClick={(e) => { e.stopPropagation(); onRemove(); }} title="Remove from playlist"><I.x s={14} /></button>
    </div>
  );
}

// A single song in a playlist that is NOT acting as a cortina — a plain track
// row, no curtain. Mirrors the live queue's QueueSong.
function PlEditorSongItem({ it, slot, onRemove, preview }) {
  const s = it.data;
  const songNameOnly = useSongNameOnly();
  const playing = preview && preview.previewId === s.id && preview.playing;
  return (
    <div className={"tp-songcard tp-qrow tp-qdrag" + (slot.dragging ? " is-dragging" : "") + (slot.over ? " is-over" : "") + (playing ? " is-now" : "")}
      {...slot.handlers}
      onClick={() => preview && preview.toggle(s)} title={previewTitle(preview, playing, "Audition this song")}>
      <span className="tp-grip" title="Drag to reorder"><I.grip s={15} /></span>
      <span className="tp-songcard-glyph">{playing ? <EQ /> : (preview && preview.viaMonitor ? <span className="tp-cuebadge"><I.headphones s={14} /></span> : <I.note s={15} />)}</span>
      <div className="tp-flex1">
        <div className="tp-songcard-title">{songNameOnly ? cleanSongTitle(s) : s.title}</div>
        <div className="tp-songcard-sub">{s.orq || "Unknown"}{s.singer ? " · " + s.singer : ""}</div>
      </div>
      <div className="tp-fade"><I.clock s={13} /> {s.dur || "—"}</div>
      <button className="tp-qx" onClick={(e) => { e.stopPropagation(); onRemove(); }} title="Remove from playlist"><I.x s={14} /></button>
    </div>
  );
}

function PlEditorDock({ open, status, api, preview, width, onBack, onPlayAll, onDelete }) {
  const items = open.items;
  const slot = usePLReorder(api.reorder);
  const meta = playlistMeta(items);

  let tIx = 0;
  return (
    <div className="tp-queue pl-dock" style={width ? { flex: `0 0 ${width}px`, width } : undefined}>
      <div className="pl-dhead">
        <div className="pl-dhead-top">
          <button className="tp-btn pill sm pl-back" onClick={onBack} title="Back to playlists">
            <I.chev s={15} /> <span>Playlists</span>
          </button>
          <span className={"pl-saved is-" + status}>
            {status === "saving" ? "Saving…" : status === "saved" ? <><I.check s={13} /> Saved</> : "Not saved yet"}
          </span>
        </div>
        <input className="pl-name-input" value={open.name} placeholder="Name this playlist…"
          onChange={(e) => api.setName(e.target.value)} onBlur={api.flushName} />
        <div className="tv-dock-meta">
          <b>{meta.tandas}</b> {meta.tandas === 1 ? "tanda" : "tandas"}
          {meta.cortinas > 0 && <><span>·</span> <b>{meta.cortinas}</b> {meta.cortinas === 1 ? "cortina" : "cortinas"}</>}
          {items.length > 0 && <><span>·</span> <b className="tp-mono">{meta.total}</b></>}
        </div>
        <div className="pl-actions">
          <button className="tp-btn primary lg grow" onClick={onPlayAll} disabled={!items.length} title="Play this set">
            <I.play s={15} /> Play all
          </button>
          <button className="pl-del" onClick={onDelete} title="Delete playlist"><I.trash s={15} /></button>
        </div>
      </div>

      <div className="tp-q-scroll">
        {items.length === 0 && (
          <div className="pl-dock-empty">
            <div className="ic"><I.note s={24} /></div>
            <h3>Empty playlist</h3>
            <p>Add tandas &amp; cortinas from the left to build your set. Drag rows to reorder, click any song to audition.</p>
          </div>
        )}
        {items.map((it, i) => {
          if (it.type === "tanda") tIx += 1;
          const sp = slot(i);
          const prev = items[i - 1];
          const gap = it.type === "tanda" && prev && prev.type === "tanda";
          // A single song reads as a cortina only when it plays that role.
          const role = it.type === "tanda" ? "tanda" : (actsAsCortina(items, i) ? "cortina" : "song");
          const row = role === "tanda"
            ? <PlEditorTanda key={it.key} it={it} ix={tIx} slot={sp} onRemove={() => api.removeAt(i)} preview={preview} />
            : role === "cortina"
              ? <PlEditorCortina key={it.key} it={it} slot={sp} onRemove={() => api.removeAt(i)} preview={preview} />
              : <PlEditorSongItem key={it.key} it={it} slot={sp} onRemove={() => api.removeAt(i)} preview={preview} />;
          return gap
            ? <React.Fragment key={it.key}><MissingCortinaHint />{row}</React.Fragment>
            : row;
        })}
        {items.length > 0 && (
          <div className="tp-q-end">End of playlist — add more from the left</div>
        )}
      </div>
    </div>
  );
}

/* ============================ MANAGE GRID (landing) ============================ */
function PlaylistCard({ pl, onOpen, onDelete, onPlay }) {
  const meta = playlistMeta(pl.items);
  const preview = pl.items.slice(0, 6);
  const songNameOnly = useSongNameOnly();
  return (
    <div className="tv-tcard pl-card" onClick={() => onOpen(pl)} title="Open playlist">
      <div className="tv-tcard-top">
        <div className="tv-tcard-orq">
          <div className="o">{pl.name || "Untitled playlist"}</div>
          <div className="sub">
            {meta.tandas} {meta.tandas === 1 ? "tanda" : "tandas"}
            {meta.cortinas > 0 ? ` · ${meta.cortinas} ${meta.cortinas === 1 ? "cortina" : "cortinas"}` : ""}
          </div>
        </div>
        <span className="pl-card-open"><I.chev s={16} /></span>
      </div>
      <div className="tv-tcard-songs">
        {preview.map((it, i) => {
          const role = it.type === "tanda" ? "tanda" : (actsAsCortina(pl.items, i) ? "cortina" : "song");
          return (
            <div key={it.type + i} className={"tv-tcard-song pl-row-" + role}>
              <span className="n pl-typ" title={role === "tanda" ? "Tanda" : role === "cortina" ? "Cortina" : "Single song"}>
                {role === "tanda" ? <I.rows s={13} /> : role === "cortina" ? <I.curtain s={13} /> : <I.note s={13} />}
              </span>
              <span className="t">{it.type !== "tanda" ? (songNameOnly && role === "song" ? cleanSongTitle(it.data) : it.data.title) : itemTitle(it)}</span>
              <span className="d">{role === "tanda" ? it.data.songs.length + " songs" : role === "cortina" ? "Cortina" : "Song"}</span>
            </div>
          );
        })}
        {pl.items.length > 6 && (
          <div className="tv-tcard-song"><span className="n" /><span className="t pl-more">+{pl.items.length - 6} more</span><span className="d" /></div>
        )}
        {pl.items.length === 0 && (
          <div className="tv-tcard-song"><span className="t pl-more">Empty playlist</span></div>
        )}
      </div>
      <div className="tv-tcard-foot">
        <div className="tv-tcard-total"><b>{meta.total}</b></div>
        <button className="tv-tcbtn pl-play" onClick={(e) => { e.stopPropagation(); onPlay(pl); }} disabled={!pl.items.length}><I.play s={13} /> Play</button>
        <button className="tv-tcbtn" onClick={(e) => { e.stopPropagation(); onOpen(pl); }}>Open</button>
        <button className="tv-tcbtn del" onClick={(e) => { e.stopPropagation(); onDelete(pl); }} title="Delete playlist"><I.trash s={15} /></button>
      </div>
    </div>
  );
}

function PlManageGrid({ playlists, onOpen, onDelete, onPlay, onNew }) {
  if (!playlists.length) {
    return (
      <div className="tv-manage">
        <div className="tv-empty-manage">
          <div className="ic"><I.note s={26} /></div>
          <h3>No playlists yet</h3>
          <p>Save a set of tandas &amp; cortinas you can replay any night.</p>
          <button className="tp-btn primary lg" onClick={onNew}>
            <I.plus s={17} /> Build a playlist
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="tv-manage">
      <div className="tv-grid">
        {playlists.map((pl) => (
          <PlaylistCard key={pl.id} pl={pl} onOpen={onOpen} onDelete={onDelete} onPlay={onPlay} />
        ))}
        <button className="tv-newcard" onClick={onNew}>
          <span className="ic"><I.plus s={22} /></span>
          <span className="lb">New playlist</span>
        </button>
      </div>
    </div>
  );
}

/* ============================ PLAYLISTS VIEW (orchestrator) ============================ */
function PlaylistsView({ onPlay, dockWidth, onDockWidthChange }) {
  const { tandas, songs, playlists, imported } = useStore();
  // Cortina material is flagged per song (song.isCortina), independent of genre.
  const cortinas = useMemo(() => songs.filter((s) => s.isCortina), [songs]);
  const preview = usePlayer().preview;
  const { toast, flash, dismiss } = useToast();
  const { ask, modal } = useConfirm();

  // Live dock width while dragging the divider; seeded from the persisted tweak.
  const [dockW, setDockW] = useState(dockWidth || 452);
  useEffect(() => { setDockW(dockWidth || 452); }, [dockWidth]);
  const commitDockW = (w) => { if (onDockWidthChange) onDockWidthChange(w); };

  // `open` is the working copy of the playlist being edited (null = landing
  // grid). Edits mutate it locally and persist to the DB in the background.
  const [open, setOpen] = useState(null);
  const [status, setStatus] = useState("idle");   // idle · saving · saved
  const idRef = useRef(null);                       // db id of the open playlist
  const saveChain = useRef(Promise.resolve());      // serialises writes so a new
  const nameTimer = useRef(null);                   // playlist is created once

  useEffect(() => () => clearTimeout(nameTimer.current), []);

  // Persist the current name + items. Serialised through saveChain so rapid
  // edits to a brand-new playlist can't race into duplicate rows. Skips writing
  // an empty, never-saved set so the grid never fills with ghost playlists.
  const persist = useCallback((name, items) => {
    if (idRef.current == null && items.length === 0) return;
    setStatus("saving");
    saveChain.current = saveChain.current
      .then(() => Store.savePlaylist({
        id: idRef.current,
        name: (name || "").trim() || null,
        items: items.map((it) => ({ type: it.type, refId: it.data.id })),
      }))
      .then((saved) => { if (saved) idRef.current = saved.id; setStatus("saved"); })
      .catch(() => setStatus("idle"));
  }, []);

  const update = (items) => { setOpen((o) => ({ ...o, items })); persist(open.name, items); };

  const api = {
    setName: (v) => {
      setOpen((o) => ({ ...o, name: v }));
      clearTimeout(nameTimer.current);
      const items = open.items;
      nameTimer.current = setTimeout(() => persist(v, items), 600);
    },
    flushName: () => { clearTimeout(nameTimer.current); persist(open.name, open.items); },
    addItem: (type, data) => update([...open.items, { key: plKid(), type, data }]),
    removeAt: (i) => update(open.items.filter((_, j) => j !== i)),
    reorder: (from, to) => {
      if (from === to || from < 0 || to < 0) return;
      const a = open.items.slice(); const [mv] = a.splice(from, 1); a.splice(to, 0, mv);
      update(a);
    },
  };

  const openPlaylist = (pl) => {
    clearTimeout(nameTimer.current);
    saveChain.current = Promise.resolve();
    idRef.current = pl.id;
    setStatus("saved");
    setOpen({ id: pl.id, name: pl.name || "", items: pl.items.map((it) => ({ key: plKid(), type: it.type, data: it.data })) });
  };
  const newPlaylist = () => {
    clearTimeout(nameTimer.current);
    saveChain.current = Promise.resolve();
    idRef.current = null;
    setStatus("idle");
    setOpen({ id: null, name: "", items: [] });
  };
  const back = () => { clearTimeout(nameTimer.current); setOpen(null); };

  const removePlaylist = (id, name, after) => ask({
    title: "Delete this playlist?",
    message: `“${name || "Untitled playlist"}” will be removed. The tandas & cortinas in it stay in your collection.`,
    confirmLabel: "Delete playlist",
    onConfirm: () => {
      const snapshot = playlists.slice();
      Store.deletePlaylist(id);
      flash("Playlist deleted", () => Store.setPlaylistsLocal(snapshot));
      if (after) after();
    },
  });
  const deleteOpen = () => {
    const id = idRef.current;
    if (id != null) removePlaylist(id, open && open.name, () => setOpen(null));
  };
  const deletePlaylist = (pl) => removePlaylist(pl.id, pl.name);

  const playAll = () => { if (open && open.items.length) onPlay({ items: open.items }); };

  /* ---------- detail editor ---------- */
  if (open) {
    if (!imported) {
      return (
        <div className="tv">
          <div className="tv-manage">
            <div className="tv-empty-manage">
              <div className="ic"><I.folderOpen s={26} /></div>
              <h3>Import your library first</h3>
              <p>Head to the Tandas view to import music and build some tandas.</p>
            </div>
          </div>
        </div>
      );
    }
    return (
      <div className="tv">
        <div className="tv-body">
          <PlLibrary tandas={tandas} cortinas={cortinas} onAdd={api.addItem} preview={preview} />
          <PlDockResizer width={dockW} min={PL_DOCK_MIN_W} max={PL_DOCK_MAX_W}
            onResize={setDockW} onCommit={commitDockW} />
          <PlEditorDock open={open} status={status} api={api} preview={preview} width={dockW}
            onBack={back} onPlayAll={playAll} onDelete={deleteOpen} />
        </div>
        <Toast toast={toast} onDismiss={dismiss} />
        {modal}
      </div>
    );
  }

  /* ---------- landing grid ---------- */
  return (
    <div className="tv">
      <div className="tv-head">
        <div>
          <div className="tv-title">Playlists</div>
          <div className="tv-sub">Open a set to reorder, trim &amp; audition it</div>
        </div>
        <div className="tv-head-r">
          <button className="tp-btn" onClick={newPlaylist}><I.plus s={15} /> New playlist</button>
        </div>
      </div>

      <PlManageGrid playlists={playlists} onOpen={openPlaylist} onDelete={deletePlaylist}
        onPlay={onPlay} onNew={newPlaylist} />

      <Toast toast={toast} onDismiss={dismiss} />
      {modal}
    </div>
  );
}

window.PlaylistsView = PlaylistsView;
