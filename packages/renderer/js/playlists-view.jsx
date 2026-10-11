// playlists-view.jsx — the Playlists workspace. The landing is a grid of saved
// sets; opening one drops you into a live-style editor (a rich queue you can
// reorder, trim, add to, and audition) that auto-saves as you work.
const { useState, useMemo, useRef, useEffect, useCallback } = React;

/* ---------- local key generator for editor rows ---------- */
let _plKid = 1;
const plKid = () => "pl" + (_plKid++);

/* ---------- playlist meta helpers ---------- */
// itemSongs + queueDurationSec are shared with the live player (window globals).
// What a playlist item is shown and counted as. A single-song item is a
// cortina only when it plays that role (see actsAsCortina — the song's own
// isCortina flag doesn't decide it); other single songs are loose. One rule for
// the editor's rows, its header counts and the playlist cards, matching Live.
function plItemRole(items, i) {
  if (items[i].type === "tanda") return "tanda";
  return actsAsCortina(items, i) ? "cortina" : "song";
}
function playlistMeta(items) {
  const list = items || [];
  let cortinas = 0, loose = 0;
  list.forEach((it, i) => {
    const role = plItemRole(list, i);
    if (role === "cortina") cortinas += 1; else if (role === "song") loose += 1;
  });
  return {
    tandas: list.filter((i) => i.type === "tanda").length,
    cortinas,
    loose,
    songs: list.reduce((a, it) => a + itemSongs(it).length, 0),
    total: fmtDur(queueDurationSec(list)),
  };
}
function itemTitle(it) {
  return it.type === "cortina" ? it.data.title : (it.data.name || tandaMeta(it.data).orq);
}
// Wraps the count of a "<b>{count}</b> tandas" message (trx).
const plBold = (s) => <b>{s}</b>;

/* ============================ ADD LIBRARY (left) ============================ */
function PlAddCortinaRow({ c, onAdd, makeDrag, draggingId }) {
  const songTitle = useSongTitle();
  return (
    <div className={"tp-cortrow" + (draggingId === c.id ? " is-dragging" : "")} draggable {...makeDrag(c)}>
      <span className="tp-cortrow-ic"><I.curtain s={15} /></span>
      <div className="tp-flex1">
        <div className="tp-cortrow-title">{songTitle(c)}</div>
        <div className="tp-cortrow-meta">{c.orq || tr("playlists.cortina")}<span className="tp-dotsep">·</span><span className="tp-mono">{c.dur}</span></div>
      </div>
      <button className="tp-addbtn sm" onClick={onAdd} title={tr("playlists.addToPlaylist")}><I.plus s={15} /></button>
    </div>
  );
}

const PL_NO_IDS = new Set();

function PlLibrary({ tandas, cortinas, onAdd, makeDrag, draggingId, preview }) {
  const [tab, setTab] = useState("tandas");
  const [q, setQ] = useState("");

  const ft = useMemo(() => tandas.filter((t) => {
    const m = tandaMeta(t);
    const hay = ((t.name || "") + " " + m.orq + " " + m.singer + " " + t.songs.map((s) => s.title).join(" ")).toLowerCase();
    return q.trim() === "" || hay.includes(q.toLowerCase());
  }), [tandas, q, I18N.locale]);

  const fc = useMemo(() => cortinas.filter((c) =>
    q.trim() === "" || ((c.title || "") + " " + (c.orq || "") + " " + (c.folder || "")).toLowerCase().includes(q.toLowerCase())
  ), [cortinas, q]);

  return (
    <div className="tp-lib">
      <div className="tp-lib-head">
        <div className="tv-title">{tr("playlists.addItems")}</div>
        <div className="tp-tabs">
          <button className={"tp-tab" + (tab === "tandas" ? " is-on" : "")} onClick={() => setTab("tandas")}>{tr("playlists.tabTandas")}</button>
          <button className={"tp-tab" + (tab === "cortinas" ? " is-on" : "")} onClick={() => setTab("cortinas")}>{tr("playlists.tabCortinas")}</button>
          <button className={"tp-tab" + (tab === "library" ? " is-on" : "")} onClick={() => setTab("library")}>{tr("playlists.tabSongs")}</button>
        </div>
      </div>

      {tab === "library" ? (
        // The same folders+songs tree as the Live tab's picker. Tapping + on a
        // song appends it to the playlist; dragging it drops it at an exact spot.
        <LibraryTree builderIds={PL_NO_IDS} onAdd={(s) => onAdd("cortina", s)} makeDrag={makeDrag}
          draggingId={draggingId} preview={preview} />
      ) : (
        <React.Fragment>
          <div className="tp-lib-controls">
            <label className="tp-search">
              <I.search s={16} />
              <input value={q} onChange={(e) => setQ(e.target.value)}
                placeholder={tab === "tandas" ? tr("playlists.searchTandas") : tr("playlists.searchCortinas")} />
            </label>
          </div>

          <div className="tp-lib-scroll">
            {tab === "tandas"
              ? ft.map((t) => <TandaLibCard key={t.id} t={t} preview={preview}
                  onAdd={() => onAdd("tanda", t)} addTitle={tr("playlists.addToPlaylist")}
                  drag={makeDrag(t, "tanda")} dragging={draggingId === "tanda:" + t.id} />)
              : fc.map((c) => <PlAddCortinaRow key={c.id} c={c} onAdd={() => onAdd("cortina", c)}
                  makeDrag={makeDrag} draggingId={draggingId} />)}
            {tab === "tandas" && ft.length === 0 && (
              <div className="tp-empty">{tandas.length ? tr("playlists.noTandasMatch") : tr("playlists.noTandasYet")}</div>
            )}
            {tab === "cortinas" && fc.length === 0 && (
              <div className="tp-empty">{cortinas.length ? tr("playlists.noCortinasMatch") : tr("playlists.noCortinasFound")}</div>
            )}
          </div>
        </React.Fragment>
      )}
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
    <div className="tv-resizer" onMouseDown={start} title={tr("playlists.resizeHint")}>
      <span className="grip" />
    </div>
  );
}

/* ============================ EDITOR QUEUE (right) ============================
 * The same visual language as the live queue: tandas read as full cards with
 * their song list, cortinas as the calm dark band. Rows are draggable to
 * reorder and library songs drop in at an exact spot (useQueueDrop, shared
 * with the live queue), every song auditions on click, and the × trims an item. */
function PlEditorSong({ n, title, dur, playing, onPlay, preview }) {
  return (
    <div className={"tp-songrow is-clickable" + (playing ? " is-now" : "")}
      onClick={(e) => { e.stopPropagation(); onPlay(); }} {...clickKeys(onPlay)}
      title={previewTitle(preview, playing, tr("playlists.auditionSong"))}>
      <span className="n"><PreviewGlyph preview={preview} playing={playing} n={n} s={12} /></span>
      <span className="tt"><div className="tp-song-title">{title}</div></span>
      <span className="tp-song-dur">{dur}</span>
    </div>
  );
}

function PlEditorTanda({ it, ix, slot, onRemove, preview }) {
  const t = it.data;
  const m = tandaMeta(t);
  const songTitle = useSongTitle();
  return (
    <div className={"tp-tandacard pl-tandacard tp-qdrag" + (slot.dragging ? " is-dragging" : "")}
      {...slot.handlers}>
      <div className="tp-tanda-head">
        <span className="tp-grip" title={tr("playlists.dragToReorder")}><I.grip s={15} /></span>
        <span className="ix">{String(ix).padStart(2, "0")}</span>
        <span className="tp-now-orq pl-tname">{t.name || m.orq}</span>
        <GenreTag genre={m.genre} small />
        {m.year && <span className="tp-tag is-plain sm" title={m.era}>{m.year}</span>}
        <button className="tp-qx" onClick={(e) => { e.stopPropagation(); onRemove(); }} title={tr("playlists.removeFromPlaylist")}><I.x s={14} /></button>
      </div>
      {t.songs.map((s, i) => {
        const playing = preview && preview.previewId === s.id && preview.playing;
        return <PlEditorSong key={s.id + ":" + i} n={i + 1} title={songTitle(s)} dur={s.dur || "—"}
          playing={playing} onPlay={() => preview && preview.toggle(s)} preview={preview} />;
      })}
      {t.inCollection === false && (
        <button className="pl-keep" onClick={(e) => { e.stopPropagation(); Store.keepTanda(t.id); }}
          title={tr("playlists.keepTandaHint")}>
          <I.plus s={13} /> {tr("playlists.keepTanda")}
        </button>
      )}
    </div>
  );
}

function PlEditorCortina({ it, slot, onRemove, preview }) {
  const c = it.data;
  const songTitle = useSongTitle();
  const playing = preview && preview.previewId === c.id && preview.playing;
  return (
    <div className={"tp-cortina tp-qrow tp-qdrag" + (slot.dragging ? " is-dragging" : "") + (playing ? " is-now" : "")}
      {...slot.handlers}
      onClick={() => preview && preview.toggle(c)} title={previewTitle(preview, playing, tr("playlists.auditionCortina"))}>
      <div className="curtain"></div>
      <span className="tp-grip dark" title={tr("playlists.dragToReorder")}><I.grip s={15} /></span>
      <span className="tp-cort-glyph">{playing ? <EQ /> : (preview && preview.viaMonitor ? <span className="tp-cuebadge"><I.headphones s={14} /></span> : <I.curtain s={17} />)}</span>
      <div className="tp-flex1">
        <div className="tp-cortina-label">{playing ? tr("playlists.cortinaPlaying") : tr("playlists.cortina")}</div>
        <div className="tp-cortina-sub">{tr("playlists.cortinaSub", { title: songTitle(c), artist: c.orq || tr("playlists.cortina") })}</div>
      </div>
      <div className="tp-fade"><I.clock s={13} /> {c.dur}</div>
      <button className="tp-qx dark" onClick={(e) => { e.stopPropagation(); onRemove(); }} title={tr("playlists.removeFromPlaylist")}><I.x s={14} /></button>
    </div>
  );
}

// A single song in a playlist that is NOT acting as a cortina — a plain track
// row, no curtain. Mirrors the live queue's QueueSong.
function PlEditorSongItem({ it, slot, onRemove, preview }) {
  const s = it.data;
  const songTitle = useSongTitle();
  const playing = preview && preview.previewId === s.id && preview.playing;
  return (
    <div className={"tp-songcard tp-qrow tp-qdrag" + (slot.dragging ? " is-dragging" : "") + (playing ? " is-now" : "")}
      {...slot.handlers}
      onClick={() => preview && preview.toggle(s)} title={previewTitle(preview, playing, tr("playlists.auditionSong"))}>
      <span className="tp-grip" title={tr("playlists.dragToReorder")}><I.grip s={15} /></span>
      <span className="tp-songcard-glyph">{playing ? <EQ /> : (preview && preview.viaMonitor ? <span className="tp-cuebadge"><I.headphones s={14} /></span> : <I.note s={15} />)}</span>
      <div className="tp-flex1">
        <div className="tp-songcard-title">{songTitle(s)}</div>
        <div className="tp-songcard-sub">{s.orq || tr("playlists.unknownArtist")}{s.singer ? " · " + s.singer : ""}</div>
      </div>
      <div className="tp-fade"><I.clock s={13} /> {s.dur || "—"}</div>
      <button className="tp-qx" onClick={(e) => { e.stopPropagation(); onRemove(); }} title={tr("playlists.removeFromPlaylist")}><I.x s={14} /></button>
    </div>
  );
}

function PlEditorDock({ open, status, api, preview, width, onBack, onPlayAll, onDelete, onExport }) {
  const items = open.items;
  const scrollRef = useRef(null);
  const dnd = useQueueDrop({ count: items.length, scrollRef, onReorder: api.reorder,
    onInsertSong: api.insertSong, onInsertItem: api.insertRef });
  const slot = dnd.slot;
  const meta = playlistMeta(items);

  let tIx = 0;
  return (
    <div className="tp-queue pl-dock" style={width ? { flex: `0 0 ${width}px`, width } : undefined}>
      <div className="pl-dhead">
        <div className="pl-dhead-top">
          <button className="tp-btn pill sm pl-back" onClick={onBack} title={tr("playlists.backToPlaylists")}>
            <I.chev s={15} /> <span>{tr("playlists.title")}</span>
          </button>
          <div className="pl-dhead-r">
            <span className={"pl-saved is-" + status}>
              {status === "saving" ? tr("playlists.saving") : status === "saved" ? <><I.check s={13} /> {tr("playlists.saved")}</> : tr("playlists.notSavedYet")}
            </span>
            {items.length > 0 && status !== "idle" && (
              <button className="tp-btn ghost sm pl-export" onClick={onExport}
                title={tr("playlists.exportHint")}>
                <I.download s={14} /> {tr("playlists.export")}
              </button>
            )}
          </div>
        </div>
        <input className="pl-name-input" value={open.name} placeholder={tr("playlists.namePlaceholder")}
          onChange={(e) => api.setName(e.target.value)} onBlur={api.flushName} />
        <div className="tv-dock-meta">
          {trx("playlists.tandaCountBold", { count: meta.tandas, b: plBold })}
          {meta.cortinas > 0 && <><span>·</span> {trx("playlists.cortinaCountBold", { count: meta.cortinas, b: plBold })}</>}
          {meta.loose > 0 && <><span>·</span> {trx("playlists.songCountBold", { count: meta.loose, b: plBold })}</>}
          {items.length > 0 && <><span>·</span> <b className="tp-mono">{meta.total}</b></>}
        </div>
        <div className="pl-actions">
          <button className="tp-btn primary lg grow" onClick={onPlayAll} disabled={!items.length} title={tr("playlists.playSetHint")}>
            <I.play s={15} /> {tr("playlists.playAll")}
          </button>
          <button className="pl-del" onClick={onDelete} title={tr("playlists.deletePlaylist")}><I.trash s={15} /></button>
        </div>
      </div>

      <div ref={scrollRef} className="tp-q-scroll" {...dnd.list}>
        {items.length === 0 && <DropGap open={dnd.gapOpen(0)} />}
        {items.length === 0 && (
          <div className="pl-dock-empty">
            <div className="ic"><I.note s={24} /></div>
            <h3>{tr("playlists.emptyPlaylist")}</h3>
            <p>{tr("playlists.emptyHint")}</p>
          </div>
        )}
        {items.map((it, i) => {
          if (it.type === "tanda") tIx += 1;
          const sp = slot(i);
          const prev = items[i - 1];
          const gap = it.type === "tanda" && prev && prev.type === "tanda";
          const role = plItemRole(items, i);
          const row = role === "tanda"
            ? <PlEditorTanda key={it.key} it={it} ix={tIx} slot={sp} onRemove={() => api.removeAt(i)} preview={preview} />
            : role === "cortina"
              ? <PlEditorCortina key={it.key} it={it} slot={sp} onRemove={() => api.removeAt(i)} preview={preview} />
              : <PlEditorSongItem key={it.key} it={it} slot={sp} onRemove={() => api.removeAt(i)} preview={preview} />;
          return (
            <React.Fragment key={it.key}>
              <DropGap open={dnd.gapOpen(i)} />
              {gap && <MissingCortinaHint />}
              {row}
            </React.Fragment>
          );
        })}
        {items.length > 0 && <DropGap open={dnd.gapOpen(items.length)} />}
        {items.length > 0 && (
          <div className="tp-q-end">{tr("playlists.endOfPlaylist")}</div>
        )}
      </div>
    </div>
  );
}

/* ============================ MANAGE GRID (landing) ============================ */
/* ---------- import preview: what an M3U/M3U8 would become ---------- */
// Shows the tandas + cortinas the importer inferred, which songs it couldn't
// find, and lets the DJ rename before anything is written.
function PlImportModal({ preview, onConfirm, onCancel }) {
  const [name, setName] = useState(preview.name || "");
  const [busy, setBusy] = useState(false);
  const songTitle = useSongTitle();
  const tandas = preview.items.filter((it) => it.type === "tanda");
  const cortinas = preview.items.length - tandas.length;
  const nothing = preview.items.length === 0;

  const confirm = async () => {
    if (nothing || busy) return;
    setBusy(true);
    try { await onConfirm(name); } finally { setBusy(false); }
  };
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") { e.preventDefault(); onCancel(); }
      else if (e.key === "Enter" && e.target.tagName !== "TEXTAREA") { e.preventDefault(); confirm(); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  let tIx = 0;
  return (
    <div className="tp-modal-scrim" onMouseDown={onCancel}>
      <div className="tp-modal pl-imp" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
        <div className="tp-modal-icon accent"><I.upload s={20} /></div>
        <div className="tp-modal-title">{tr("playlists.importTitle")}</div>
        <div className="tp-modal-msg">
          {nothing
            ? tr("playlists.importNothing")
            : cortinas > 0
              ? trx("playlists.importSummaryBoth", {
                  tandas: trx("playlists.tandaCountBold", { count: tandas.length, b: plBold }),
                  cortinas: trx("playlists.cortinaCountBold", { count: cortinas, b: plBold }),
                })
              : trx("playlists.tandaCountBold", { count: tandas.length, b: plBold })}
        </div>
        {!nothing && (
          <input className="pl-name-input pl-imp-name" value={name} placeholder={tr("playlists.namePlaceholder")}
            onChange={(e) => setName(e.target.value)} autoFocus />
        )}
        {!nothing && (
          <div className="pl-imp-list">
            {preview.items.map((it, i) => it.type === "tanda" ? (
              <div className="pl-imp-row" key={i}>
                <span className="pl-imp-n">{++tIx}</span>
                <span className="pl-imp-main">
                  <span className="pl-imp-title">{it.tanda.name || tr("playlists.importTandaFallback", { n: tIx })}</span>
                  <span className="pl-imp-songs">
                    {it.tanda.songs.map(songTitle).join(" · ")}
                  </span>
                  {(it.tanda.existingTandaId || it.tanda.missing.length > 0) && (
                    <span className="pl-imp-sub">
                      {it.tanda.existingTandaId && tr("playlists.importAlreadySaved")}
                      {it.tanda.existingTandaId && it.tanda.missing.length > 0 && " · "}
                      {it.tanda.missing.length > 0 && <span className="pl-imp-miss">{tr("playlists.importNotFound", { count: it.tanda.missing.length })}</span>}
                    </span>
                  )}
                </span>
                <span className="pl-imp-tags">{(it.tanda.tags || []).slice(0, 3).map((t) => <span key={t.cat + t.label} className="tp-tag sm is-other">{t.label}</span>)}</span>
              </div>
            ) : (
              <div className="pl-imp-row is-cortina" key={i}>
                <span className="pl-imp-n"><I.curtain s={12} /></span>
                <span className="pl-imp-main"><span className="pl-imp-title">{songTitle(it.song)}</span><span className="pl-imp-sub">{tr("playlists.importRowCortina")}</span></span>
              </div>
            ))}
          </div>
        )}
        {preview.missing.length > 0 && (
          <div className="tp-modal-note pl-imp-note">
            <strong>{tr("playlists.importMissing", { count: preview.missing.length })}</strong>
            {preview.missing.slice(0, 6).map((m, i) => <span key={i} className="pl-imp-missrow">{m}</span>)}
            {preview.missing.length > 6 && <span className="pl-imp-missrow">{tr("playlists.importMoreMissing", { count: preview.missing.length - 6 })}</span>}
          </div>
        )}
        <div className="tp-modal-actions">
          <button className="tp-modal-cancel" onClick={onCancel}>{tr("common.cancel")}</button>
          <button className="tp-modal-confirm accent" onClick={confirm} disabled={nothing || busy}>
            <I.check s={14} /> {busy ? tr("playlists.importing") : tr("playlists.importConfirm")}
          </button>
        </div>
      </div>
    </div>
  );
}

function PlaylistCard({ pl, onOpen, onDelete, onPlay, onExport }) {
  const meta = playlistMeta(pl.items);
  const preview = pl.items.slice(0, 6);
  const songTitle = useSongTitle();
  return (
    <div className="tv-tcard pl-card" onClick={() => onOpen(pl)} title={tr("playlists.openPlaylist")}>
      <div className="tv-tcard-top">
        <div className="tv-tcard-orq">
          <div className="o">{pl.name || tr("playlists.untitled")}</div>
          <div className="sub">
            {tr("playlists.tandaCount", { count: meta.tandas })}
            {meta.cortinas > 0 ? " · " + tr("playlists.cortinaCount", { count: meta.cortinas }) : ""}
            {meta.loose > 0 ? " · " + tr("playlists.songCount", { count: meta.loose }) : ""}
          </div>
        </div>
        <span className="pl-card-open"><I.chev s={16} /></span>
      </div>
      <div className="tv-tcard-songs">
        {preview.map((it, i) => {
          const role = plItemRole(pl.items, i);
          return (
            <div key={it.type + i} className={"tv-tcard-song pl-row-" + role}>
              <span className="n pl-typ" title={role === "tanda" ? tr("playlists.rowTanda") : role === "cortina" ? tr("playlists.cortina") : tr("playlists.rowSingleSong")}>
                {role === "tanda" ? <I.rows s={13} /> : role === "cortina" ? <I.curtain s={13} /> : <I.note s={13} />}
              </span>
              <span className="t">{it.type !== "tanda" ? songTitle(it.data) : itemTitle(it)}</span>
              <span className="d">{role === "tanda" ? tr("playlists.songCount", { count: it.data.songs.length }) : role === "cortina" ? tr("playlists.cortina") : tr("playlists.rowSong")}</span>
            </div>
          );
        })}
        {pl.items.length > 6 && (
          <div className="tv-tcard-song"><span className="n" /><span className="t pl-more">{tr("playlists.moreItems", { count: pl.items.length - 6 })}</span><span className="d" /></div>
        )}
        {pl.items.length === 0 && (
          <div className="tv-tcard-song"><span className="t pl-more">{tr("playlists.emptyPlaylist")}</span></div>
        )}
      </div>
      <div className="tv-tcard-foot">
        <div className="tv-tcard-total"><b>{meta.total}</b></div>
        <button className="tv-tcbtn pl-play" onClick={(e) => { e.stopPropagation(); onPlay(pl); }} disabled={!pl.items.length}><I.play s={13} /> {tr("playlists.play")}</button>
        <button className="tv-tcbtn" onClick={(e) => { e.stopPropagation(); onOpen(pl); }}>{tr("playlists.open")}</button>
        <button className="tv-tcbtn del" onClick={(e) => { e.stopPropagation(); onExport(pl); }} disabled={!pl.items.length}
          title={tr("playlists.exportHint")}><I.download s={15} /></button>
        <button className="tv-tcbtn del" onClick={(e) => { e.stopPropagation(); onDelete(pl); }} title={tr("playlists.deletePlaylist")}><I.trash s={15} /></button>
      </div>
    </div>
  );
}

function PlManageGrid({ playlists, onOpen, onDelete, onPlay, onNew, onExport }) {
  if (!playlists.length) {
    return (
      <div className="tv-manage">
        <div className="tv-empty-manage">
          <div className="ic"><I.note s={26} /></div>
          <h3>{tr("playlists.noPlaylistsYet")}</h3>
          <p>{tr("playlists.noPlaylistsHint")}</p>
          <button className="tp-btn primary lg" onClick={onNew}>
            <I.plus s={17} /> {tr("playlists.buildPlaylist")}
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="tv-manage">
      <div className="tv-grid">
        {playlists.map((pl) => (
          <PlaylistCard key={pl.id} pl={pl} onOpen={onOpen} onDelete={onDelete} onPlay={onPlay} onExport={onExport} />
        ))}
        <button className="tv-newcard" onClick={onNew}>
          <span className="ic"><I.plus s={22} /></span>
          <span className="lb">{tr("playlists.newPlaylist")}</span>
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

  // Drag source for the library's songs, cortinas and tandas — the same payload
  // the Live tab uses, read off the drop by the editor queue.
  const { makeDrag, draggingId } = useLibraryDrag();

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
    // Insert an item in front of row `at` — used when something from the
    // library is dropped onto the editor.
    insertAt: (type, data, at) => {
      const a = open.items.slice(); a.splice(at, 0, { key: plKid(), type, data });
      update(a);
    },
    // A dropped song goes in as a single-song item, like the Live queue does.
    insertSong: (song, at) => api.insertAt("cortina", song, at),
    // A dropped tanda card arrives as its kind and id.
    insertRef: (kind, id, at) => {
      const t = kind === "tanda" && tandas.find((x) => String(x.id) === id);
      if (t) api.insertAt("tanda", t, at);
    },
    removeAt: (i) => update(open.items.filter((_, j) => j !== i)),
    // Move row `from` so it lands in front of row `to` (items.length = the end).
    // Removing `from` first shifts later rows down by one, so a downward move
    // targets `to - 1` to avoid landing past the target.
    reorder: (from, to) => {
      const at = from < to ? to - 1 : to;
      if (from < 0 || to < 0 || at === from) return;
      const a = open.items.slice(); const [mv] = a.splice(from, 1); a.splice(at, 0, mv);
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
    title: tr("playlists.deleteTitle"),
    message: tr("playlists.deleteMessage", { name: name || tr("playlists.untitled") }),
    confirmLabel: tr("playlists.deletePlaylist"),
    onConfirm: () => {
      const snapshot = playlists.slice();
      Store.deletePlaylist(id);
      flash(tr("playlists.deleted"), () => Store.setPlaylistsLocal(snapshot));
      if (after) after();
    },
  });
  const deleteOpen = () => {
    const id = idRef.current;
    if (id != null) removePlaylist(id, open && open.name, () => setOpen(null));
  };
  const deletePlaylist = (pl) => removePlaylist(pl.id, pl.name);

  const playAll = () => { if (open && open.items.length) onPlay({ items: open.items }); };

  /* ---------- M3U exchange ---------- */
  const exportPlaylist = async (id) => {
    let path = null;
    try { path = await window.compas.exportPlaylist(id); } catch (_e) { path = null; }
    if (path) flash(tr("playlists.exportSaved", { file: path.split(/[\\/]/).pop() }));
  };
  const exportOpen = async () => {
    // Flush a pending rename first so the file carries the current name.
    clearTimeout(nameTimer.current);
    persist(open.name, open.items);
    await saveChain.current.catch(() => {});
    if (idRef.current != null) exportPlaylist(idRef.current);
  };
  // Importing a playlist goes through the shared import flow: folders its
  // songs live in are brought into the library first (if needed), then the
  // playlist confirmation is shown by the app shell.
  const imp = useFolderImport(flash);

  /* ---------- detail editor ---------- */
  if (open) {
    if (!imported) {
      return (
        <div className="tv">
          <div className="tv-manage">
            <div className="tv-empty-manage">
              <div className="ic"><I.folderOpen s={26} /></div>
              <h3>{tr("playlists.importLibraryFirst")}</h3>
              <p>{tr("playlists.importLibraryFirstHint")}</p>
            </div>
          </div>
        </div>
      );
    }
    return (
      <div className="tv">
        <div className="tv-body">
          <PlLibrary tandas={tandas} cortinas={cortinas} onAdd={api.addItem}
            makeDrag={makeDrag} draggingId={draggingId} preview={preview} />
          <PlDockResizer width={dockW} min={PL_DOCK_MIN_W} max={PL_DOCK_MAX_W}
            onResize={setDockW} onCommit={commitDockW} />
          <PlEditorDock open={open} status={status} api={api} preview={preview} width={dockW}
            onBack={back} onPlayAll={playAll} onDelete={deleteOpen} onExport={exportOpen} />
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
          <div className="tv-title">{tr("playlists.title")}</div>
          <div className="tv-sub">{tr("playlists.subtitle")}</div>
        </div>
        <div className="tv-head-r">
          <button className="tp-btn" onClick={imp.beginPlaylist} disabled={imp.scanning}
            title={tr("playlists.importHint")}><I.upload s={15} /> {imp.scanning ? tr("playlists.reading") : tr("playlists.importPlaylist")}</button>
          <button className="tp-btn" onClick={newPlaylist}><I.plus s={15} /> {tr("playlists.newPlaylist")}</button>
        </div>
      </div>

      <PlManageGrid playlists={playlists} onOpen={openPlaylist} onDelete={deletePlaylist}
        onPlay={onPlay} onNew={newPlaylist} onExport={(pl) => exportPlaylist(pl.id)} />

      <Toast toast={toast} onDismiss={dismiss} />
      {modal}
      {imp.modal}
    </div>
  );
}

window.PlaylistsView = PlaylistsView;
window.PlImportModal = PlImportModal;
