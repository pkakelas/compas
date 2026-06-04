// playlists-view.jsx — the Playlists workspace: build a set from saved tandas &
// cortinas, manage saved playlists, and hand one off to the live player.
const { useState: usePL, useMemo: useMemoPL } = React;

/* ---------- local key generator for builder rows ---------- */
let _plKid = 1;
const plKid = () => "pl" + (_plKid++);

/* ---------- playlist meta helpers ---------- */
function itemSongsPL(item) {
  return item.type === "cortina" ? [item.data] : ((item.data && item.data.songs) || []);
}
function itemDurSecPL(item) {
  return itemSongsPL(item).reduce((a, s) => a + (s.durationSec || secOf(s.dur)), 0);
}
function playlistMeta(items) {
  const list = items || [];
  return {
    tandas: list.filter((i) => i.type === "tanda").length,
    cortinas: list.filter((i) => i.type === "cortina").length,
    total: fmtDur(list.reduce((a, it) => a + itemDurSecPL(it), 0)),
  };
}
function itemTitle(it) {
  return it.type === "cortina" ? it.data.title : (it.data.name || tandaMeta(it.data).orq);
}

/* ---------- internal drag-to-reorder for the playlist dock ---------- */
function usePLReorder(onReorder) {
  const [drag, setDrag] = usePL(null);
  const [over, setOver] = usePL(null);
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
function PlAddTandaCard({ t, onAdd }) {
  const m = tandaMeta(t);
  return (
    <div className="tp-libcard">
      <div className="tp-libcard-main">
        <div className="tp-libcard-top">
          <span className="tp-libcard-orq">{t.name || m.orq}</span>
          <GenreTagX genre={m.genre} />
          {m.decade && <span className="tp-tag is-plain" style={{ height: 19, fontSize: 10, padding: "0 7px" }}>{m.decade}</span>}
        </div>
        <div className="tp-libcard-meta">
          {m.singer}<span className="tp-dotsep">·</span>{t.songs.length} songs<span className="tp-dotsep">·</span>
          <span className="tp-mono">{m.total}</span>
        </div>
      </div>
      <button className="tp-addbtn" onClick={onAdd} title="Add to playlist"><I.plus s={16} /></button>
    </div>
  );
}

function PlAddCortinaRow({ c, onAdd }) {
  return (
    <div className="tp-cortrow">
      <span className="tp-cortrow-ic"><I.curtain s={15} /></span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="tp-cortrow-title">{c.title}</div>
        <div className="tp-cortrow-meta">{c.orq || "Cortina"}<span className="tp-dotsep">·</span><span className="tp-mono">{c.dur}</span></div>
      </div>
      <button className="tp-addbtn sm" onClick={onAdd} title="Add to playlist"><I.plus s={15} /></button>
    </div>
  );
}

function PlLibrary({ tandas, cortinas, onAdd }) {
  const [tab, setTab] = usePL("tandas");
  const [q, setQ] = usePL("");

  const ft = useMemoPL(() => tandas.filter((t) => {
    const m = tandaMeta(t);
    const hay = ((t.name || "") + " " + m.orq + " " + m.singer + " " + t.songs.map((s) => s.title).join(" ")).toLowerCase();
    return q.trim() === "" || hay.includes(q.toLowerCase());
  }), [tandas, q]);

  const fc = useMemoPL(() => cortinas.filter((c) =>
    q.trim() === "" || ((c.title || "") + " " + (c.orq || "") + " " + (c.folder || "")).toLowerCase().includes(q.toLowerCase())
  ), [cortinas, q]);

  return (
    <div className="tp-lib">
      <div className="tp-lib-head">
        <div>
          <div className="tp-eyebrow">Add to playlist</div>
          <div className="tp-lib-title">Choose tandas &amp; cortinas</div>
        </div>
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
          ? ft.map((t) => <PlAddTandaCard key={t.id} t={t} onAdd={() => onAdd("tanda", t)} />)
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

/* ============================ BUILDER DOCK (right) ============================ */
function PlBuilder({ builder, api }) {
  const items = builder.items;
  const slot = usePLReorder(api.reorder);
  const meta = playlistMeta(items);

  return (
    <div className="tv-dock">
      <div className="tv-dock-head">
        <div className="tp-eyebrow">{api.editing ? "Editing playlist" : "New playlist"}</div>
        <div className="tv-dock-title-row">
          <input className="tv-dock-name" value={builder.name} onChange={(e) => api.setName(e.target.value)}
            placeholder="Name this playlist…" />
          {api.editing && <span className="tv-edit-tag">Editing</span>}
        </div>
        <div className="tv-dock-meta">
          <b>{meta.tandas}</b> {meta.tandas === 1 ? "tanda" : "tandas"}
          {meta.cortinas > 0 && <><span>·</span> <b>{meta.cortinas}</b> {meta.cortinas === 1 ? "cortina" : "cortinas"}</>}
          {items.length > 0 && <><span>·</span> <b>{meta.total}</b></>}
        </div>
      </div>

      <div className="tv-dock-scroll">
        {items.length === 0 && (
          <div className="tv-slot-empty"><span>Add tandas &amp; cortinas from the left to build your set</span></div>
        )}
        {items.map((it, i) => {
          const sp = slot(i);
          const isCort = it.type === "cortina";
          const sub = isCort
            ? (it.data.orq || "Cortina") + " · " + it.data.dur
            : it.data.songs.length + " songs · " + tandaTotal(it.data.songs);
          return (
            <div key={it.key}
              className={"tv-slot filled" + (sp.dragging ? " dragging" : "") + (sp.over ? " over" : "") + (isCort ? " pl-cortina-slot" : "")}
              {...sp.handlers}>
              <span className="num">{i + 1}</span>
              <span className="gr">{isCort ? <I.curtain s={14} /> : <I.drag s={14} />}</span>
              <div className="tt">
                <div className="t">{itemTitle(it)}</div>
                <div className="s">{sub}</div>
              </div>
              <button className="rm" onClick={() => api.removeAt(i)} title="Remove"><I.x s={14} /></button>
            </div>
          );
        })}
      </div>

      <div className="tv-dock-foot">
        <button className="tv-save" disabled={!items.length} onClick={api.save}>
          <I.check s={17} /> {api.editing ? "Update playlist" : "Save playlist"}
        </button>
        <button className="tv-clear" disabled={!items.length && !api.editing} onClick={api.clear}>
          {api.editing ? "Cancel edit" : "Clear"}
        </button>
      </div>
    </div>
  );
}

/* ============================ MANAGE GRID ============================ */
function PlaylistCard({ pl, onEdit, onDelete, onPlay }) {
  const meta = playlistMeta(pl.items);
  const preview = pl.items.slice(0, 6);
  return (
    <div className="tv-tcard">
      <div className="tv-tcard-top">
        <div className="tv-tcard-orq">
          <div className="o">{pl.name || "Untitled playlist"}</div>
          <div className="sub">
            {meta.tandas} {meta.tandas === 1 ? "tanda" : "tandas"}
            {meta.cortinas > 0 ? ` · ${meta.cortinas} ${meta.cortinas === 1 ? "cortina" : "cortinas"}` : ""}
          </div>
        </div>
      </div>
      <div className="tv-tcard-songs">
        {preview.map((it, i) => (
          <div key={it.type + i} className="tv-tcard-song">
            <span className="n">{i + 1}</span>
            <span className="t">{it.type === "cortina" ? "“" + it.data.title + "”" : itemTitle(it)}</span>
            <span className="d">{it.type === "cortina" ? "Cortina" : it.data.songs.length + "×"}</span>
          </div>
        ))}
        {pl.items.length > 6 && (
          <div className="tv-tcard-song"><span className="n" /><span className="t pl-more">+{pl.items.length - 6} more</span><span className="d" /></div>
        )}
        {pl.items.length === 0 && (
          <div className="tv-tcard-song"><span className="t pl-more">Empty playlist</span></div>
        )}
      </div>
      <div className="tv-tcard-foot">
        <div className="tv-tcard-total"><b>{meta.total}</b></div>
        <button className="tv-tcbtn pl-play" onClick={() => onPlay(pl)} disabled={!pl.items.length}><I.play s={13} /> Play</button>
        <button className="tv-tcbtn" onClick={() => onEdit(pl)}><I.pencil s={14} /> Edit</button>
        <button className="tv-tcbtn del" onClick={() => onDelete(pl)} title="Delete playlist"><I.trash s={15} /></button>
      </div>
    </div>
  );
}

function PlManageGrid({ playlists, onEdit, onDelete, onPlay, onNew }) {
  if (!playlists.length) {
    return (
      <div className="tv-manage">
        <div className="tv-empty-manage">
          <div className="ic"><I.note s={26} /></div>
          <h3>No playlists yet</h3>
          <p>Save a set of tandas &amp; cortinas you can replay any night.</p>
          <button className="tv-save" style={{ width: 220, margin: "0 auto" }} onClick={onNew}>
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
          <PlaylistCard key={pl.id} pl={pl} onEdit={onEdit} onDelete={onDelete} onPlay={onPlay} />
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
function PlaylistsView({ onPlay }) {
  const { tandas, songs, playlists, imported } = useStore();
  const cortinas = useMemoPL(() => songs.filter((s) => s.genre === "cortina"), [songs]);
  const [mode, setMode] = usePL("manage");
  const [builder, setBuilder] = usePL({ items: [], name: "", editingId: null });
  const [toast, setToast] = usePL(null);
  const toastTimer = React.useRef(null);

  const flash = (msg, action) => {
    setToast({ msg, action });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), action ? 5000 : 2400);
  };

  /* ---- builder api ---- */
  const addItem = (type, data) => setBuilder((b) => ({ ...b, items: [...b.items, { key: plKid(), type, data }] }));
  const removeAt = (i) => setBuilder((b) => ({ ...b, items: b.items.filter((_, j) => j !== i) }));
  const reorder = (from, to) => setBuilder((b) => {
    if (from === to || from < 0 || to < 0) return b;
    const a = b.items.slice(); const [mv] = a.splice(from, 1); a.splice(to, 0, mv); return { ...b, items: a };
  });
  const clear = () => setBuilder({ items: [], name: "", editingId: null });
  const save = () => {
    if (!builder.items.length) return;
    const editing = !!builder.editingId;
    Store.savePlaylist({
      id: builder.editingId,
      name: builder.name.trim() || null,
      items: builder.items.map((it) => ({ type: it.type, refId: it.data.id })),
    });
    flash(editing ? "Playlist updated" : "Playlist saved");
    clear();
    setMode("manage");
  };
  const api = {
    items: builder.items, editing: !!builder.editingId,
    setName: (v) => setBuilder((b) => ({ ...b, name: v })),
    addItem, removeAt, reorder, clear, save,
  };

  const editPlaylist = (pl) => {
    setBuilder({
      items: pl.items.map((it) => ({ key: plKid(), type: it.type, data: it.data })),
      name: pl.name || "", editingId: pl.id,
    });
    setMode("build");
  };
  const newPlaylist = () => { clear(); setMode("build"); };
  const deletePlaylist = (pl) => {
    const snapshot = playlists.slice();
    Store.deletePlaylist(pl.id);
    flash("Playlist deleted", () => Store.setPlaylistsLocal(snapshot));
  };

  return (
    <div className="tv">
      <div className="tv-head">
        <div>
          <div className="tv-title">Playlists</div>
          <div className="tv-sub">Save sets of tandas &amp; cortinas, then replay them live</div>
        </div>
        <div className="tv-head-r">
          <div className="tv-seg">
            <button className={mode === "build" ? "on" : ""} onClick={() => setMode("build")}>
              <I.plus s={15} /> Build
            </button>
            <button className={mode === "manage" ? "on" : ""} onClick={() => setMode("manage")}>
              My playlists <span className="pill">{playlists.length}</span>
            </button>
          </div>
        </div>
      </div>

      {mode === "build" ? (
        !imported ? (
          <div className="tv-manage">
            <div className="tv-empty-manage">
              <div className="ic"><I.folderOpen s={26} /></div>
              <h3>Import your library first</h3>
              <p>Head to the Tandas view to import music and build some tandas.</p>
            </div>
          </div>
        ) : (
          <div className="tv-body">
            <PlLibrary tandas={tandas} cortinas={cortinas} onAdd={addItem} />
            <PlBuilder builder={builder} api={api} />
          </div>
        )
      ) : (
        <PlManageGrid playlists={playlists} onEdit={editPlaylist} onDelete={deletePlaylist}
          onPlay={onPlay} onNew={newPlaylist} />
      )}

      {toast && (
        <div className="tv-toast">
          <span className="ic"><I.check s={16} /></span>
          {toast.msg}
          {toast.action && <button onClick={() => { toast.action(); setToast(null); }}>Undo</button>}
        </div>
      )}
    </div>
  );
}

window.PlaylistsView = PlaylistsView;
