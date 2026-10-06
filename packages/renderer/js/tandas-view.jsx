// tandas-view.jsx — the Tandas workspace: import → folder library → builder → manage
const { useState, useEffect, useRef } = React;

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
  const songNameOnly = useSongNameOnly();
  // Drag & drop is the shared queue behaviour (useQueueDrop): a dragged song
  // or slot lands in the gap nearest the pointer, which eases open. The gap's
  // index counts the dragged slot too, so a move further down lands one earlier.
  const scrollRef = useRef(null);
  const dnd = useQueueDrop({
    count: songs.length, scrollRef, rows: ".tv-slot.filled",
    onReorder: (from, at) => api.moveSong(from, from < at ? at - 1 : at),
    onInsertSong: api.insertSong,
  });
  const m = tandaMeta({ songs });
  // A tanda needs a name before it can be saved. One is filled in for the DJ
  // when the songs share an orchestra or era (TandaNameSuggest); when they
  // don't, the DJ has to type one — warn until they do.
  const unnamed = songs.length > 0 && !builder.name.trim() && !suggestTandaName(songs);
  const target = songs.length >= 8 ? songs.length : Math.max(4, songs.length + 1);
  const empties = [];
  for (let i = songs.length; i < target; i++) empties.push(i);

  const dockStyle = width ? { flex: "0 0 " + width + "px", width: width } : undefined;

  return (
    <div className="tv-dock" style={dockStyle}>
      <div className="tv-dock-head">
        <div className="tv-dock-title-row">
          <label className={"tv-dock-namefield" + (unnamed ? " is-missing" : "")} title="Name this tanda">
            <I.pencil s={15} />
            <input className="tv-dock-name" value={builder.name} onChange={(e) => api.setName(e.target.value)}
              placeholder={m.orq && m.orq !== "Empty tanda" ? m.orq : "Name this tanda…"} />
          </label>
        </div>
        {unnamed && <div className="tv-name-warn" role="alert">Give this tanda a name before saving.</div>}
        <TandaNameSuggest songs={songs} name={builder.name} onApply={api.setName} />
        {builderSummary(songs)}
        <TagField tags={api.tags} onChange={api.setTags} />
        <TandaTagSuggest songs={songs} tags={api.tags} onApply={api.setTags} />
      </div>

      <div ref={scrollRef} className="tv-dock-scroll" {...dnd.list}>
        {songs.map((s, i) => {
          const sp = dnd.slot(i);
          const isPlaying = preview && preview.previewId === s.id && preview.playing;
          return (
            <React.Fragment key={s.id}>
            <DropGap open={dnd.gapOpen(i)} />
            <div className={"tv-slot filled" + (sp.dragging ? " dragging" : "") + (preview ? " clickable" : "") + (isPlaying ? " playing" : "")}
              {...sp.handlers}
              onClick={preview ? () => preview.toggle(s) : undefined}
              title={previewTitle(preview, isPlaying)}>
              <span className="num"><PreviewGlyph preview={preview} playing={isPlaying} n={i + 1} s={12} /></span>
              <span className="gr"><I.drag s={14} /></span>
              <div className="tt">
                <div className="t">{songNameOnly ? cleanSongTitle(s) : s.title}</div>
                <div className="s">{s.orq}{s.singer ? " · " + s.singer : ""} · {s.year}</div>
              </div>
              <span className="du">{s.dur}</span>
              <button className="rm" onClick={(e) => { e.stopPropagation(); api.removeAt(i); }} title="Remove"><I.x s={14} /></button>
            </div>
            </React.Fragment>
          );
        })}
        {/* The "next" empty slot is the drop target for the end; once the tanda
            has outgrown the empty slots, a gap is. */}
        {empties.length === 0 && <DropGap open={dnd.gapOpen(songs.length)} />}
        {empties.map((i) => {
          const isNext = i === songs.length;
          return (
            <div key={"e" + i} className={"tv-slot-empty" + (isNext ? " next" : " ghost") + (isNext && dnd.gapOpen(songs.length) ? " is-target" : "")}>
              <span className="num">{i + 1}</span>
              {isNext
                ? <span className="hint"><I.plus s={14} /> Drop a song here, or tap + to add</span>
                : <span className="hint">Empty</span>}
            </div>
          );
        })}
      </div>

      <div className="tv-dock-foot">
        <button className="tp-btn primary lg block" disabled={!songs.length || unnamed} onClick={api.save}
          title={unnamed ? "Name this tanda before saving" : undefined}>
          <I.check s={17} /> {api.editing ? "Update tanda" : "Save tanda"}
        </button>
        <button className="tv-clear" disabled={!songs.length && !api.editing} onClick={api.clear}>
          {api.editing ? "Cancel edit" : "Clear builder"}
        </button>
      </div>
    </div>
  );
}

/* One-time nudge introducing suggested tandas, mirroring the Smart Organize tip
 * on the Library view. Dismissal is remembered in localStorage so it shows once. */
const SUGGEST_TIP_KEY = "compas.suggestTandasTipDismissed";

function SuggestTandasTip({ suggestions, onDismiss, onBrowse }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") { e.preventDefault(); onDismiss(); } };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onDismiss]);
  // A few distinct orchestras we matched, shown as concrete chips.
  const orchestras = [];
  const seen = new Set();
  for (const t of suggestions) {
    const o = (t.tags || []).find((g) => g.cat === "orquesta");
    if (o && o.label && !seen.has(o.label)) { seen.add(o.label); orchestras.push(o.label); }
    if (orchestras.length >= 4) break;
  }
  return (
    <div className="tp-modal-scrim" onMouseDown={onDismiss}>
      <div className="sotip" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
        <button className="sotip-x" onClick={onDismiss} title="Dismiss"><I.x s={16} /></button>
        <div className="sotip-badge"><I.spark s={24} /></div>
        <div className="sotip-title">Tandas from your library</div>
        <div className="sotip-sub">
          We cross-checked your songs against classic tandas and lined up {suggestions.length} you can
          play right now — every track is one you already own.
        </div>
        {orchestras.length > 0 && (
          <div className="sotip-chips">{orchestras.map((o) => <span key={o}>{o}</span>)}</div>
        )}
        <div className="sotip-actions">
          <button className="tp-btn primary lg block" onClick={onBrowse}><I.spark s={15} /> Browse suggestions</button>
          <span className="sotip-safe"><I.check s={13} /> Save the ones you like, dismiss the rest</span>
        </div>
      </div>
    </div>
  );
}

/* ============================ TANDAS VIEW (orchestrator) ============================ */
const BUILDER_MIN_W = 300;
const BUILDER_MAX_W = 640;

function TandasView({ builderWidth, onBuilderWidthChange, tandaLayout, onTandaLayoutChange }) {
  const { imported, tandas, suggestions, totalSongs, totalFolders, roots } = useStore();
  // The Tandas section is one workspace with three sub-tabs: the builder, the
  // DJ's saved collection ("mine"), and library-matched suggestions. They share
  // this mounted component, so the builder's in-progress songs — and its library
  // tree's expand/collapse state — survive every flip between tabs. Land on the
  // saved collection, the way clicking "Tandas" always has.
  const [tab, setTab] = useState("mine");
  const goBuild = () => setTab("build");
  const goManage = () => setTab("mine");
  const [builder, setBuilder] = useState({ songs: [], name: "", tags: [], editingId: null });
  const { makeDrag, draggingId } = useLibraryDrag();
  const { toast, flash, dismiss } = useToast();
  const { ask, modal } = useConfirm();
  const player = usePlayer();
  const preview = player.preview;

  // Live dock width while dragging the divider; seeded from the persisted tweak.
  const [dockW, setDockW] = useState(builderWidth || 380);
  useEffect(() => { setDockW(builderWidth || 380); }, [builderWidth]);

  const sugg = suggestions || [];

  // One-time intro to suggested tandas (like the Smart Organize tip). Its CTA
  // jumps straight to the Suggestions tab.
  const [suggestTipDismissed, setSuggestTipDismissed] = useState(() => localStorage.getItem(SUGGEST_TIP_KEY) === "1");
  const dismissSuggestTip = () => { localStorage.setItem(SUGGEST_TIP_KEY, "1"); setSuggestTipDismissed(true); };
  const browseSuggestions = () => { setTab("suggestions"); dismissSuggestTip(); };

  // Grid (tabs) vs. list (big rows) layout for the manage view. List gives each
  // song the full row width, so long titles (often with the orquesta prepended)
  // don't truncate. The preference lives in the app-level tweaks so it's shared
  // with the Appearance settings; the header toggle below writes the same value.
  const tandaView = tandaLayout === "list" ? "list" : "grid";
  const setTandaView = (v) => onTandaLayoutChange && onTandaLayoutChange(v);

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
    if (!builder.songs.length || !builder.name.trim()) return;
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
  const playTanda = (t) => player.playTanda(t);
  // Community sharing — only offered in builds that have a Community backend.
  const community = useCommunity();
  const [sharing, setSharing] = useState(null);
  const shareTanda = (t) => setSharing(t);
  const unshareTanda = (t) => {
    ask({
      title: "Take this tanda down?",
      message: `“${t.name || "Untitled tanda"}” will be removed from the Community, along with its likes and comments. It stays in your tandas.`,
      confirmLabel: "Unshare",
      onConfirm: async () => {
        const res = await CommunityStore.unshareTanda(t.id);
        flash(res.ok ? "Removed from Community" : res.error);
      },
    });
  };

  const deleteTanda = (t) => {
    ask({
      title: "Delete this tanda?",
      message: `“${t.name || "Untitled tanda"}” will be removed from your collection.`
        + (t.sharedPostId ? " It will also be taken down from the Community." : ""),
      confirmLabel: "Delete tanda",
      onConfirm: async () => {
        // A shared tanda is taken down first, so no post outlives its tanda.
        if (t.sharedPostId) {
          const res = await CommunityStore.unshareTanda(t.id);
          if (!res.ok) { flash(res.error); return; }
        }
        const snapshot = tandas.slice();
        Store.deleteTanda(t.id);
        flash("Tanda deleted", () => Store.setTandasLocal(snapshot));
      },
    });
  };

  // Saving a suggestion adds it to "My tandas"; the suggestion card stays put on
  // the Suggestions tab and flips to a "Saved" state on the next refresh.
  const saveSuggestion = (t) => {
    const orqTag = (t.tags || []).find((g) => g.cat === "orquesta");
    const name = t.name || suggestTandaName(t.songs, orqTag && orqTag.label) || (orqTag && orqTag.label) || null;
    Store.keepSuggestion({ ...t, name });
    flash("Tanda saved to your collection");
  };
  const dismissSuggestion = (t) => Store.dismissSuggestion(t.refId);


  if (!imported) return <div className="tv"><ImportScreen /></div>;

  const commitWidth = (w) => { if (onBuilderWidthChange) onBuilderWidthChange(w); };

  // One light section-tab bar — Build · My tandas · Suggestions — heads the
  // whole workspace, so every tanda task reads as one place. Underline tabs
  // (not the heavy segmented pill) keep it reading as primary navigation.
  const sectabs = (
    <div className="tv-sectabs" role="tablist" aria-label="Tandas">
      <button className={"tv-sectab" + (tab === "build" ? " on" : "")} role="tab" aria-selected={tab === "build"}
        onClick={() => setTab("build")}>
        Build {builder.songs.length > 0 && <span className="ct">{builder.songs.length}</span>}<I.scissors s={15} />
      </button>
      <button className={"tv-sectab" + (tab === "mine" ? " on" : "")} role="tab" aria-selected={tab === "mine"}
        onClick={() => setTab("mine")}>
        My tandas {tandas.length > 0 && <span className="ct">{tandas.length}</span>}
      </button>
      <button className={"tv-sectab" + (tab === "suggestions" ? " on" : "")} role="tab" aria-selected={tab === "suggestions"}
        onClick={() => setTab("suggestions")}>
        Suggestions {sugg.length > 0 && <span className="ct">{sugg.length}</span>}
      </button>
    </div>
  );

  const subtitle = (
    <div className="tv-sub">
      {tab === "build" ? (
        <><b>{totalSongs}</b> songs across <b>{totalFolders}</b> folders
          {roots && roots.length > 1 && <> in <b>{roots.length}</b> libraries</>}</>
      ) : tab === "mine"
        ? "Tandas you've saved to your collection"
        : "Built from songs already in your library — every track is one you own"}
    </div>
  );

  // In Build the header sits over the library column only, so the builder bench
  // runs the panel's full height (one clean seam — no half-height background
  // band). In the manage tabs it spans the full width and carries the layout
  // toggle on the right.
  const header = (
    <div className="tv-head">
      <div>{sectabs}{subtitle}</div>
      {tab !== "build" && (
        <div className="tv-head-r">
          <div className="tv-viewtoggle" role="group" aria-label="Tanda layout">
            <button className={"tv-vt" + (tandaView === "grid" ? " on" : "")} onClick={() => setTandaView("grid")}
              title="Grid view" aria-pressed={tandaView === "grid"}><I.grid s={15} /></button>
            <button className={"tv-vt" + (tandaView === "list" ? " on" : "")} onClick={() => setTandaView("list")}
              title="List view" aria-pressed={tandaView === "list"}><I.rows s={15} /></button>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="tv">
      {tab === "build" ? (
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
          <ManageGrid tab={tab} tandas={tandas} suggestions={sugg} onEdit={editTanda} onDelete={deleteTanda} onNew={newTanda} onPlay={playTanda}
            onShare={community.configured ? shareTanda : undefined} onUnshare={unshareTanda}
            onSaveSuggestion={saveSuggestion} onDismissSuggestion={dismissSuggestion} onBrowseSuggestions={browseSuggestions} preview={preview} view={tandaView} />
        </>
      )}

      {tab !== "build" && !suggestTipDismissed && sugg.length > 0 && (
        <SuggestTandasTip suggestions={sugg} onDismiss={dismissSuggestTip} onBrowse={browseSuggestions} />
      )}

      <Toast toast={toast} onDismiss={dismiss} />
      {modal}
      {sharing && (
        <ShareTandaModal tanda={sharing} onClose={() => setSharing(null)}
          onShared={() => { setSharing(null); flash("Shared to Community"); }} />
      )}
    </div>
  );
}

window.TandasView = TandasView;
