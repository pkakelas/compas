// tandas-view.jsx — the Tandas workspace: import → folder library → builder → manage
// Two builder layouts (Bench dock / Tray) toggled via Tweaks.
const { useState: useTV, useEffect: useEffTV, useRef: useRefTV } = React;

/* ---------- single-song preview, routed through the shared player ----------
 * Previewing a song here plays it through the one app-wide engine, so it shows
 * up in the transport bar and never overlaps with the live queue. */
function useSongPreview() {
  const player = usePlayer();
  return {
    previewId: player.previewId,
    playing: player.playing,
    toggle: player.previewSong,
  };
}

/* ---------- shared drag-and-drop for the builder ---------- */
function useBuilderDnD(api) {
  const [hot, setHot] = useTV(false);
  const [drag, setDrag] = useTV(null);
  const [over, setOver] = useTV(null);
  const readDrop = (e, i) => {
    const raw = e.dataTransfer.getData("text/plain") || "";
    if (raw.indexOf("idx:") === 0) {
      const from = +raw.slice(4);
      if (i == null || i >= api.length) api.moveSong(from, api.length - 1);
      else api.moveSong(from, i);
    } else if (raw.indexOf("song:") === 0) {
      const s = Store.songById(raw.slice(5));
      if (s) api.insertSong(s, i == null ? api.length : i);
    }
  };
  const dropTarget = {
    hot,
    onDragOver: (e) => { e.preventDefault(); if (!hot) setHot(true); },
    onDragLeave: (e) => { if (e.currentTarget === e.target) setHot(false); },
    onDrop: (e) => { e.preventDefault(); setHot(false); readDrop(e, null); },
  };
  const slot = (i) => ({
    dragging: drag === i, over: over === i,
    handlers: {
      draggable: true,
      onDragStart: (e) => { e.dataTransfer.setData("text/plain", "idx:" + i); e.dataTransfer.effectAllowed = "move"; setDrag(i); },
      onDragEnd: () => { setDrag(null); setOver(null); setHot(false); },
      onDragOver: (e) => { e.preventDefault(); e.stopPropagation(); if (over !== i) setOver(i); },
      onDrop: (e) => { e.preventDefault(); e.stopPropagation(); readDrop(e, i); setOver(null); setDrag(null); setHot(false); },
    },
  });
  const dropAt = (i) => ({
    onDragOver: (e) => { e.preventDefault(); },
    onDrop: (e) => { e.preventDefault(); e.stopPropagation(); readDrop(e, i); setHot(false); },
  });
  return { dropTarget, slot, dropAt };
}

function builderSummary(songs, editing) {
  const m = tandaMeta({ songs });
  return (
    <div className="tv-dock-meta">
      <b>{songs.length}</b> {songs.length === 1 ? "song" : "songs"}
      {songs.length > 0 && <><span>·</span> <b>{m.total}</b><span>·</span><GenreTagX genre={m.genre} /></>}
    </div>
  );
}

/* ============================ BUILDER · BENCH (side dock) ============================ */
function BuilderBench({ builder, api }) {
  const songs = builder.songs;
  const { dropTarget, slot, dropAt } = useBuilderDnD(api);
  const m = tandaMeta({ songs });
  const target = songs.length >= 8 ? songs.length : Math.max(4, songs.length + 1);
  const empties = [];
  for (let i = songs.length; i < target; i++) empties.push(i);

  return (
    <div className={"tv-dock" + (dropTarget.hot ? " drop-hot" : "")}>
      <div className="tv-dock-head">
        <div className="tp-eyebrow">{api.editing ? "Editing tanda" : "New tanda"}</div>
        <div className="tv-dock-title-row">
          <input className="tv-dock-name" value={builder.name} onChange={(e) => api.setName(e.target.value)}
            placeholder={m.orq !== "Empty tanda" ? m.orq : "Name this tanda…"} />
          {api.editing && <span className="tv-edit-tag">Editing</span>}
        </div>
        {builderSummary(songs, api.editing)}
      </div>

      <div className="tv-dock-scroll" {...{ onDragOver: dropTarget.onDragOver, onDragLeave: dropTarget.onDragLeave, onDrop: dropTarget.onDrop }}>
        {songs.map((s, i) => {
          const sp = slot(i);
          return (
            <div key={s.id} className={"tv-slot filled" + (sp.dragging ? " dragging" : "") + (sp.over ? " over" : "")} {...sp.handlers}>
              <span className="num">{i + 1}</span>
              <span className="gr"><I.drag s={14} /></span>
              <div className="tt">
                <div className="t">{s.title}</div>
                <div className="s">{s.orq}{s.singer ? " · " + s.singer : ""} · {s.year}</div>
              </div>
              <span className="du">{s.dur}</span>
              <button className="rm" onClick={() => api.removeAt(i)} title="Remove"><I.x s={14} /></button>
            </div>
          );
        })}
        {empties.map((i) => (
          <div key={"e" + i} className="tv-slot-empty" {...dropAt(i)}>
            <span className="num">{i + 1}</span>
            <span>{i === songs.length ? "Drop a song here, or tap + in the list" : "Drop a song here"}</span>
          </div>
        ))}
      </div>

      <div className="tv-dock-foot">
        <button className="tv-save" disabled={!songs.length} onClick={api.save}>
          <I.check s={17} /> {api.editing ? "Update tanda" : "Save tanda"}
        </button>
        <button className="tv-clear" disabled={!songs.length && !api.editing} onClick={api.clear}>
          {api.editing ? "Cancel edit" : "Clear builder"}
        </button>
      </div>
    </div>
  );
}

/* ============================ BUILDER · TRAY (bottom) ============================ */
function BuilderTray({ builder, api }) {
  const songs = builder.songs;
  const { dropTarget, slot } = useBuilderDnD(api);
  const m = tandaMeta({ songs });
  return (
    <div className={"tv-tray" + (dropTarget.hot ? " drop-hot" : "")}>
      <div className="tv-tray-l">
        <div className="tp-eyebrow">{api.editing ? "Editing tanda" : "New tanda"}</div>
        <input className="tv-tray-name" value={builder.name} onChange={(e) => api.setName(e.target.value)}
          placeholder={m.orq !== "Empty tanda" ? m.orq : "Name this tanda…"} />
        <div className="tv-tray-meta">
          <b>{songs.length}</b> {songs.length === 1 ? "song" : "songs"}
          {songs.length > 0 && <><span>·</span><b>{m.total}</b></>}
        </div>
      </div>

      <div className="tv-tray-mid" {...{ onDragOver: dropTarget.onDragOver, onDragLeave: dropTarget.onDragLeave, onDrop: dropTarget.onDrop }}>
        {songs.length === 0 ? (
          <div className="tv-tray-empty"><I.arrowDn s={18} /> Drag songs down here — or tap + on any track to add it</div>
        ) : songs.map((s, i) => {
          const sp = slot(i);
          return (
            <React.Fragment key={s.id}>
              {i > 0 && <span className="tv-tray-arrow"><I.chev s={14} /></span>}
              <div className={"tv-chip" + (sp.dragging ? " dragging" : "") + (sp.over ? " over" : "")} {...sp.handlers}>
                <span className="num">{i + 1}</span>
                <div className="tt">
                  <div className="t">{s.title}</div>
                  <div className="s">{s.orq.split(",")[0]} · {s.dur}</div>
                </div>
                <button className="rm" onClick={() => api.removeAt(i)} title="Remove"><I.x s={13} /></button>
              </div>
            </React.Fragment>
          );
        })}
      </div>

      <div className="tv-tray-r">
        <button className="tv-save" disabled={!songs.length} onClick={api.save}>
          <I.check s={16} /> {api.editing ? "Update tanda" : "Save tanda"}
        </button>
        <button className="tv-clear" disabled={!songs.length && !api.editing} onClick={api.clear}>
          {api.editing ? "Cancel edit" : "Clear"}
        </button>
      </div>
    </div>
  );
}

/* ---------- find a tree node by its path (tree identity changes on reload) ---------- */
function findNode(nodes, path) {
  for (const n of nodes) {
    if (n.path === path) return n;
    if (n.children) {
      const hit = findNode(n.children, path);
      if (hit) return hit;
    }
  }
  return null;
}

/* ============================ TANDAS VIEW (orchestrator) ============================ */
function TandasView({ layout }) {
  const { imported, tree, tandas, totalSongs, totalFolders, roots } = useStore();
  const [mode, setMode] = useTV("build");                  // build | manage
  const [sel, setSel] = useTV(null);                       // selected folder node
  const [builder, setBuilder] = useTV({ songs: [], name: "", editingId: null });
  const [draggingId, setDraggingId] = useTV(null);
  const [toast, setToast] = useTV(null);                   // { msg, action }
  const toastTimer = useRefTV(null);
  const preview = useSongPreview();

  // Keep the selected folder pointed at a live node from the current tree.
  useEffTV(() => {
    if (!tree.length) { if (sel) setSel(null); return; }
    const stillThere = sel && findNode(tree, sel.path);
    if (!stillThere) setSel(tree[0]);
    else if (stillThere !== sel) setSel(stillThere);
  }, [tree]);

  const flash = (msg, action) => {
    setToast({ msg, action });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), action ? 5000 : 2400);
  };

  /* ---- builder api ---- */
  const inBuilder = new Set(builder.songs.map((s) => s.id));
  const addSong = (s) => setBuilder((b) => b.songs.some((x) => x.id === s.id) ? b : { ...b, songs: [...b.songs, s] });
  const insertSong = (s, idx) => setBuilder((b) => {
    if (b.songs.some((x) => x.id === s.id)) return b;
    const a = b.songs.slice(); a.splice(Math.max(0, Math.min(idx, a.length)), 0, s); return { ...b, songs: a };
  });
  const moveSong = (from, to) => setBuilder((b) => {
    if (from === to || from < 0 || to < 0) return b;
    const a = b.songs.slice(); const [mv] = a.splice(from, 1); a.splice(to, 0, mv); return { ...b, songs: a };
  });
  const removeAt = (idx) => setBuilder((b) => ({ ...b, songs: b.songs.filter((_, i) => i !== idx) }));
  const clear = () => setBuilder({ songs: [], name: "", editingId: null });
  const save = () => {
    if (!builder.songs.length) return;
    const editing = !!builder.editingId;
    Store.saveTanda({
      id: builder.editingId,
      name: builder.name.trim() || null,
      songIds: builder.songs.map((s) => s.id),
    });
    flash(editing ? "Tanda updated" : "Tanda saved to your collection");
    clear();
    setMode("manage");
  };
  const api = { songs: builder.songs, length: builder.songs.length, editing: !!builder.editingId,
    setName: (v) => setBuilder((b) => ({ ...b, name: v })), addSong, insertSong, moveSong, removeAt, clear, save };

  const editTanda = (t) => { setBuilder({ songs: t.songs.slice(), name: t.name || "", editingId: t.id }); setMode("build"); };
  const newTanda = () => { clear(); setMode("build"); };
  const deleteTanda = (t) => {
    const snapshot = tandas.slice();
    Store.deleteTanda(t.id);
    flash("Tanda deleted", () => Store.setTandasLocal(snapshot));
  };

  const makeDrag = (s) => ({
    onDragStart: (e) => { e.dataTransfer.setData("text/plain", "song:" + s.id); e.dataTransfer.effectAllowed = "copy"; setDraggingId(s.id); },
    onDragEnd: () => setDraggingId(null),
  });

  const addFolder = async () => {
    const before = totalSongs;
    let lib;
    try {
      lib = await Store.importLibrary();   // opens picker + scans, appends to library
    } catch (e) {
      flash("Import failed. Please try again.");
      return;
    }
    if (!lib) return;                       // cancelled
    const added = (lib.totalSongs || 0) - before;
    flash(added > 0
      ? `Added ${added} song${added === 1 ? "" : "s"} from a new folder`
      : "That folder is already in your library");
  };

  if (!imported) return <div className="tv"><ImportScreen /></div>;

  const Builder = layout === "tray" ? BuilderTray : BuilderBench;
  const node = sel || tree[0];

  return (
    <div className="tv">
      <div className="tv-head">
        <div>
          <div className="tv-title">Tandas</div>
          <div className="tv-sub">
            <b>{totalSongs}</b> songs across <b>{totalFolders}</b> folders
            {roots && roots.length > 1 && <> in <b>{roots.length}</b> libraries</>}
          </div>
        </div>
        <div className="tv-head-r">
          <div className="tv-seg">
            <button className={mode === "build" ? "on" : ""} onClick={() => setMode("build")}>
              <I.scissor s={15} /> Build
            </button>
            <button className={mode === "manage" ? "on" : ""} onClick={() => setMode("manage")}>
              My tandas <span className="pill">{tandas.length}</span>
            </button>
          </div>
          <button className="tv-reimport" onClick={addFolder} title="Import another folder into your library">
            <I.upload s={15} /> Add folder
          </button>
        </div>
      </div>

      {mode === "build" ? (
        layout === "tray" ? (
          <div className="tv-body tray">
            <div className="tv-body" style={{ flex: 1, minHeight: 0 }}>
              <FolderTree sel={node} onSelect={setSel} />
              <SongList node={node} builderIds={inBuilder} onAdd={addSong} makeDrag={makeDrag} draggingId={draggingId} preview={preview} />
            </div>
            <Builder builder={builder} api={api} />
          </div>
        ) : (
          <div className="tv-body">
            <FolderTree sel={node} onSelect={setSel} />
            <SongList node={node} builderIds={inBuilder} onAdd={addSong} makeDrag={makeDrag} draggingId={draggingId} preview={preview} />
            <Builder builder={builder} api={api} />
          </div>
        )
      ) : (
        <ManageGrid tandas={tandas} onEdit={editTanda} onDelete={deleteTanda} onNew={newTanda} />
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

window.TandasView = TandasView;
