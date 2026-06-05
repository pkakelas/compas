// tandas-view.jsx — the Tandas workspace: import → folder library → builder → manage
const { useState, useEffect, useRef } = React;

/* ---------- single-song preview, routed through the shared player ----------
 * Previewing a song here plays it through the one app-wide engine, so it shows
 * up in the transport bar and never overlaps with the live queue. */
function useSongPreview() {
  // Unified listen affordance — routes to the monitor card when cueing is on,
  // otherwise through the shared engine (see PlayerProvider).
  return usePlayer().preview;
}

/* ---------- shared drag-and-drop for the builder ---------- */
function useBuilderDnD(api) {
  const [hot, setHot] = useState(false);
  const [drag, setDrag] = useState(null);
  const [over, setOver] = useState(null);
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

function builderSummary(songs) {
  const m = tandaMeta({ songs });
  return (
    <div className="tv-dock-meta">
      <b>{songs.length}</b> {songs.length === 1 ? "song" : "songs"}
      {songs.length > 0 && <><span>·</span> <b>{m.total}</b><span>·</span><GenreTag genre={m.genre} small /></>}
    </div>
  );
}

/* ---------- draggable divider between the library and the bench dock ----------
 * Dragging left widens the dock (it's pinned to the right); dragging right
 * gives the library more room. Width is clamped and committed on release. */
function BuilderResizer({ width, min, max, onResize, onCommit }) {
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
    <div className="tv-resizer" onMouseDown={start} title="Drag to resize the builder">
      <span className="grip" />
    </div>
  );
}

/* ============================ BUILDER · BENCH (side dock) ============================ */
function BuilderBench({ builder, api, width, preview }) {
  const songs = builder.songs;
  const { dropTarget, slot, dropAt } = useBuilderDnD(api);
  const m = tandaMeta({ songs });
  const target = songs.length >= 8 ? songs.length : Math.max(4, songs.length + 1);
  const empties = [];
  for (let i = songs.length; i < target; i++) empties.push(i);

  const dockStyle = width ? { flex: "0 0 " + width + "px", width: width } : undefined;

  return (
    <div className={"tv-dock" + (dropTarget.hot ? " drop-hot" : "")} style={dockStyle}>
      <div className="tv-dock-head">
        <div className="tp-eyebrow">{api.editing ? "Editing tanda" : "New tanda"}</div>
        <div className="tv-dock-title-row">
          <input className="tv-dock-name" value={builder.name} onChange={(e) => api.setName(e.target.value)}
            placeholder={m.orq !== "Empty tanda" ? m.orq : "Name this tanda…"} />
          {api.editing && <span className="tv-edit-tag">Editing</span>}
        </div>
        {builderSummary(songs)}
        <TagField tags={api.tags} onChange={api.setTags} />
      </div>

      <div className="tv-dock-scroll" {...{ onDragOver: dropTarget.onDragOver, onDragLeave: dropTarget.onDragLeave, onDrop: dropTarget.onDrop }}>
        {songs.map((s, i) => {
          const sp = slot(i);
          const isPlaying = preview && preview.previewId === s.id && preview.playing;
          return (
            <div key={s.id} className={"tv-slot filled" + (sp.dragging ? " dragging" : "") + (sp.over ? " over" : "") + (preview ? " clickable" : "") + (isPlaying ? " playing" : "")}
              {...sp.handlers}
              onClick={preview ? () => preview.toggle(s) : undefined}
              title={previewTitle(preview, isPlaying)}>
              <span className="num"><PreviewGlyph preview={preview} playing={isPlaying} n={i + 1} s={12} /></span>
              <span className="gr"><I.drag s={14} /></span>
              <div className="tt">
                <div className="t">{s.title}</div>
                <div className="s">{s.orq}{s.singer ? " · " + s.singer : ""} · {s.year}</div>
              </div>
              <span className="du">{s.dur}</span>
              <button className="rm" onClick={(e) => { e.stopPropagation(); api.removeAt(i); }} title="Remove"><I.x s={14} /></button>
            </div>
          );
        })}
        {empties.map((i) => {
          const isNext = i === songs.length;
          return (
            <div key={"e" + i} className={"tv-slot-empty" + (isNext ? " next" : " ghost")} {...dropAt(i)}>
              <span className="num">{i + 1}</span>
              {isNext
                ? <span className="hint"><I.plus s={14} /> Drop a song here, or tap + to add</span>
                : <span className="hint">Empty</span>}
            </div>
          );
        })}
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

/* ============================ TANDAS VIEW (orchestrator) ============================ */
const BUILDER_MIN_W = 300;
const BUILDER_MAX_W = 640;

function TandasView({ mode = "build", onNavigate, builderWidth, onBuilderWidthChange }) {
  const { imported, tandas, totalSongs, totalFolders, roots } = useStore();
  const goBuild = () => onNavigate && onNavigate("Builder");
  const goManage = () => onNavigate && onNavigate("Tandas");
  const [builder, setBuilder] = useState({ songs: [], name: "", tags: [], editingId: null });
  const [draggingId, setDraggingId] = useState(null);
  const { toast, flash, dismiss } = useToast();
  const preview = useSongPreview();

  // Live dock width while dragging the divider; seeded from the persisted tweak.
  const [dockW, setDockW] = useState(builderWidth || 380);
  useEffect(() => { setDockW(builderWidth || 380); }, [builderWidth]);

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
  const clear = () => setBuilder({ songs: [], name: "", tags: [], editingId: null });
  const save = () => {
    if (!builder.songs.length) return;
    const editing = !!builder.editingId;
    Store.saveTanda({
      id: builder.editingId,
      name: builder.name.trim() || null,
      songIds: builder.songs.map((s) => s.id),
      tags: builder.tags,
    });
    flash(editing ? "Tanda updated" : "Tanda saved to your collection");
    clear();
    goManage();
  };
  const api = { songs: builder.songs, length: builder.songs.length, editing: !!builder.editingId,
    tags: builder.tags,
    setName: (v) => setBuilder((b) => ({ ...b, name: v })),
    setTags: (v) => setBuilder((b) => ({ ...b, tags: v })),
    addSong, insertSong, moveSong, removeAt, clear, save };

  const editTanda = (t) => { setBuilder({ songs: t.songs.slice(), name: t.name || "", tags: (t.tags || []).slice(), editingId: t.id }); goBuild(); };
  const newTanda = () => { clear(); goBuild(); };
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

  const commitWidth = (w) => { if (onBuilderWidthChange) onBuilderWidthChange(w); };

  // The view header sits over the library column only, so the builder dock can
  // run the full height of the workspace (its left hairline reads as one clean
  // seam instead of starting partway down beneath a full-width header).
  const header = (
    <div className="tv-head">
      <div className="tv-head-l">
        <div className="tv-head-badge">{mode === "build" ? <I.scissor s={20} /> : <I.note s={19} />}</div>
        <div className="tv-head-text">
          <div className="tv-title">{mode === "build" ? "Tanda builder" : "My tandas"}</div>
          <div className="tv-sub">
            {mode === "build" ? (
              <><b>{totalSongs}</b> songs across <b>{totalFolders}</b> folders
                {roots && roots.length > 1 && <> in <b>{roots.length}</b> libraries</>}</>
            ) : (
              <><b>{tandas.length}</b> {tandas.length === 1 ? "tanda" : "tandas"} in your collection</>
            )}
          </div>
        </div>
      </div>
      <div className="tv-head-r">
        {mode === "build" && (
          <button className="tv-reimport" onClick={addFolder} title="Import another folder into your library">
            <I.upload s={16} /> Add folder
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div className="tv">
      {mode === "build" ? (
        <div className="tv-body">
          <div className="tv-main">
            {header}
            <LibraryTree builderIds={inBuilder} onAdd={addSong} makeDrag={makeDrag} draggingId={draggingId} preview={preview} />
          </div>
          <BuilderResizer width={dockW} min={BUILDER_MIN_W} max={BUILDER_MAX_W}
            onResize={setDockW} onCommit={commitWidth} />
          <BuilderBench builder={builder} api={api} width={dockW} preview={preview} />
        </div>
      ) : (
        <>
          {header}
          <ManageGrid tandas={tandas} onEdit={editTanda} onDelete={deleteTanda} onNew={newTanda} preview={preview} />
        </>
      )}

      <Toast toast={toast} onDismiss={dismiss} />
    </div>
  );
}

window.TandasView = TandasView;
