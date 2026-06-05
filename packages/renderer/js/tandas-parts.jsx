// tandas-parts.jsx — unified library tree (folders + songs), manage grid + meta helpers
const { useState, useMemo, useEffect } = React;

/* ---------- tanda meta ---------- */
function tandaMeta(t) {
  const songs = t.songs || [];
  if (!songs.length) return { orq: "Empty tanda", genre: "tango", singer: "", decade: "", total: "0:00" };
  const orqs = [...new Set(songs.map((s) => s.orq))];
  const orq = orqs.length === 1 ? orqs[0] : "Mixed orchestras";
  const genres = [...new Set(songs.map((s) => s.genre))];
  const genre = genres.length === 1 ? genres[0] : "tango";
  const singers = [...new Set(songs.map((s) => s.singer).filter(Boolean))];
  const singer = singers.length === 1 ? singers[0] : singers.length > 1 ? "Various singers" : "";
  const years = songs.map((s) => s.year).filter(Boolean);
  const decade = years.length ? Math.floor(Math.min(...years) / 10) * 10 + "s" : "";
  return { orq, genre, singer, decade, total: tandaTotal(songs) };
}

/* The lowercased labels of a tanda's "type" tags (Tango / Vals / Milonga /
 * Cortina). This is the DJ-assigned classification — unlike tandaMeta().genre,
 * which is merely inferred from the songs' file metadata. */
function tandaTypes(t) {
  return (t.tags || []).filter((tg) => tg.cat === "type").map((tg) => (tg.label || "").toLowerCase());
}

/* ============================ TANDA LIB CARD ============================
 * One shared "browse a tanda" card, used by both the Live page's library and
 * the Playlists editor. Collapsed it's a minified summary (name, genre/tags,
 * singer · songs · length); the caret (or tapping the row) expands it to reveal
 * every song, each of which auditions on click. `onAdd` shows a +/✓ add button;
 * `preview` is the shared listen affordance (omit either to drop that feature). */
function TandaLibCard({ t, preview, onAdd, added, addTitle }) {
  const [open, setOpen] = useState(false);
  const m = tandaMeta(t);
  const hasTags = t.tags && t.tags.length > 0;
  const toggle = () => setOpen((o) => !o);
  return (
    <div className={"tp-tandax" + (open ? " is-open" : "")}>
      <div className="tp-tandax-head">
        <button className={"tp-tandax-caret" + (open ? " is-open" : "")} onClick={toggle}
          title={open ? "Hide songs" : "Show songs"} aria-expanded={open}>
          <I.chev s={14} />
        </button>
        <div className="tp-tandax-main" onClick={toggle}>
          <div className="tp-libcard-top">
            <span className="tp-libcard-orq">{t.name || m.orq}</span>
            {hasTags ? <TagPills tags={t.tags} max={3} /> : <GenreTag genre={m.genre} small />}
            {m.decade && <span className="tp-tag is-plain sm">{m.decade}</span>}
          </div>
          <div className="tp-libcard-meta">
            {m.singer ? <>{m.singer}<span className="tp-dotsep">·</span></> : null}
            {t.songs.length} {t.songs.length === 1 ? "song" : "songs"}
            <span className="tp-dotsep">·</span><span className="tp-mono">{m.total}</span>
          </div>
        </div>
        {onAdd && (
          <button className={"tp-addbtn" + (added ? " is-added" : "")}
            onClick={(e) => { e.stopPropagation(); onAdd(); }} title={addTitle || "Add tanda"}>
            {added ? <I.check s={16} /> : <I.plus s={16} />}
          </button>
        )}
      </div>
      {open && (
        <div className="tp-tandax-songs">
          {t.songs.map((s, i) => {
            const playing = preview && preview.previewId === s.id && preview.playing;
            return (
              <div key={s.id + ":" + i}
                className={"tp-songrow" + (preview ? " is-clickable" : "") + (playing ? " is-now" : "")}
                onClick={preview ? (e) => { e.stopPropagation(); preview.toggle(s); } : undefined}
                title={previewTitle(preview, playing)}>
                <span className="n"><PreviewGlyph preview={preview} playing={playing} n={i + 1} s={12} /></span>
                <span className="tt">
                  <div className="tp-song-title">{s.title}</div>
                  {(s.singer || s.year) && (
                    <div className="tp-song-meta">{[s.singer, s.year].filter(Boolean).join(" · ")}</div>
                  )}
                </span>
                <span className="tp-song-dur">{s.dur}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ============================ SONG ROW ============================
 * `library` renders the read-only variant used by the Library view: it keeps
 * the listen affordance but drops the builder drag handle and the +/add button. */
function SongRow({ s, inBuilder, onAdd, dragHandlers, dragging, isPreview, isPlaying, onPreview, previewViaMonitor, library }) {
  const isCort = s.genre === "cortina";
  return (
    <div className={"tv-song" + (isCort ? " cortina" : "") + (inBuilder ? " in-builder" : "") + (dragging ? " dragging" : "") + (isPreview ? " playing" : "")}
      draggable={!library} {...(library ? {} : dragHandlers)}>
      <button className={"play" + (isPreview && isPlaying ? " on" : "") + (previewViaMonitor ? " monitor" : "")} onClick={(e) => { e.stopPropagation(); onPreview(); }}
        title={isPreview && isPlaying ? "Pause" : previewViaMonitor ? "Listen in headphones (monitor)" : "Play preview"}>
        {isPreview && isPlaying ? <I.pause s={14} /> : (previewViaMonitor ? <I.headphones s={14} /> : <I.play s={14} />)}
      </button>
      <div className="tt">
        <div className="tv-song-title">
          {s.title}
        </div>
        <div className="tv-song-sub">{s.orq}{s.singer ? " · " + s.singer : ""}</div>
      </div>
      <span className="yr">{s.year}</span>
      <span className="du">{s.dur}</span>
      {!library && (
        <button className={"add" + (inBuilder ? " in" : "")} onClick={(e) => { e.stopPropagation(); onAdd(); }}
          title={inBuilder ? "Already in the tanda" : "Add to tanda"}>
          {inBuilder ? <I.check s={15} /> : <I.plus s={15} />}
        </button>
      )}
    </div>
  );
}

/* ============================ LIBRARY TREE ============================
 * One unified, collapsible tree: folders nest inside folders, and a folder's
 * own songs sit right beneath it. Selecting a folder is no longer a separate
 * step — you just open the branch you want and drag/add songs in place. */
function TreeNode({ node, depth, openSet, toggle, forceOpen, songProps }) {
  const kids = node.children || [];
  const songs = node.songs || [];
  const hasContent = kids.length > 0 || songs.length > 0;
  const isOpen = forceOpen || openSet.has(node.path);
  return (
    <div className="tv-tnode">
      <div className={"tv-folder-row" + (isOpen ? " open" : "") + (depth === 0 ? " root" : "")}
        onClick={() => hasContent && toggle(node.path)}
        onContextMenu={(e) => songProps.onFolderContext && songProps.onFolderContext(e, node)}>
        <span className={"caret" + (hasContent ? (isOpen ? " open" : "") : " leaf")}>
          <I.chev s={12} />
        </span>
        <span className="fic">{isOpen && hasContent ? <I.folderOpen s={15} /> : <I.folder s={15} />}</span>
        <span className="nm">{node.name}</span>
        <span className="ct">{countSongs(node)}</span>
      </div>
      {isOpen && hasContent && (
        <div className="tv-tnode-kids">
          {kids.map((c) => (
            <TreeNode key={c.path} node={c} depth={depth + 1} openSet={openSet} toggle={toggle} forceOpen={forceOpen} songProps={songProps} />
          ))}
          {songs.map((s) => (
            <SongRow key={s.id} s={s} library={songProps.library}
              inBuilder={!songProps.library && songProps.builderIds && songProps.builderIds.has(s.id)}
              onAdd={() => songProps.onAdd && songProps.onAdd(s)}
              dragHandlers={songProps.makeDrag ? songProps.makeDrag(s) : undefined} dragging={songProps.draggingId === s.id}
              isPreview={songProps.preview && songProps.preview.previewId === s.id} isPlaying={songProps.preview && songProps.preview.playing}
              onPreview={() => songProps.preview && songProps.preview.toggle(s)}
              previewViaMonitor={songProps.preview && songProps.preview.viaMonitor} />
          ))}
        </div>
      )}
    </div>
  );
}

function LibraryTree({ builderIds, onAdd, makeDrag, draggingId, preview, hint, library }) {
  const { tree } = useStore();
  const [openSet, setOpenSet] = useState(() => new Set(tree.map((n) => n.path)));
  const [q, setQ] = useState("");
  const [menu, setMenu] = useState(null);   // right-click folder menu: { node, x, y, confirm }
  const toggle = (path) => setOpenSet((s) => {
    const n = new Set(s); n.has(path) ? n.delete(path) : n.add(path); return n;
  });

  // Right-click a folder row to remove it from the library (files stay on disk).
  const closeMenu = () => setMenu(null);
  const openMenu = (e, node) => {
    e.preventDefault();
    e.stopPropagation();
    // Clamp to the viewport so the menu never opens off the right/bottom edge.
    const x = Math.min(e.clientX, window.innerWidth - 244);
    const y = Math.min(e.clientY, window.innerHeight - 150);
    setMenu({ node, x, y, confirm: false });
  };
  const confirmDelete = () => { if (menu) Store.deleteFolder(menu.node); closeMenu(); };

  useEffect(() => {
    if (!menu) return;
    const onDown = () => closeMenu();
    const onKey = (e) => { if (e.key === "Escape") closeMenu(); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("blur", onDown);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", onDown);
    };
  }, [menu]);

  // Open the root folders once the library has loaded (tree arrives async).
  useEffect(() => {
    if (tree.length) setOpenSet((s) => (s.size ? s : new Set(tree.map((n) => n.path))));
  }, [tree]);

  // Searching prunes the tree to matching folders/songs and force-opens it.
  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    if (!ql) return tree;
    const f = (node) => {
      const nameHit = node.name.toLowerCase().includes(ql);
      const songs = nameHit ? (node.songs || [])
        : (node.songs || []).filter((s) => (s.title + " " + s.orq + " " + (s.singer || "")).toLowerCase().includes(ql));
      const children = (node.children || []).map(f).filter(Boolean);
      if (nameHit || songs.length || children.length) return { ...node, songs, children };
      return null;
    };
    return tree.map(f).filter(Boolean);
  }, [q, tree]);

  const searching = !!q.trim();
  const songProps = { builderIds, onAdd, makeDrag, draggingId, preview, library, onFolderContext: openMenu };
  const menuCount = menu ? countSongs(menu.node) : 0;

  return (
    <div className="tv-tree">
      <div className="tv-tree-head">
        <label className="tp-search">
          <I.search s={15} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a folder or song…" />
        </label>
        {library
          ? (hint && <div className="tv-songs-hint">{hint}</div>)
          : <div className="tv-songs-hint"><I.drag s={13} /> {hint || "Drag songs into the builder, or tap +"}</div>}
      </div>
      <div className="tv-tree-scroll">
        {filtered.length === 0 ? (
          <div className="tp-empty">{searching ? "Nothing matches your search." : "No folders in your library yet."}</div>
        ) : (
          filtered.map((n) => (
            <TreeNode key={n.path} node={n} depth={0} openSet={openSet} toggle={toggle} forceOpen={searching} songProps={songProps} />
          ))
        )}
      </div>

      {menu && (
        <div className="tv-ctx" style={{ top: menu.y, left: menu.x }}
          onMouseDown={(e) => e.stopPropagation()} onContextMenu={(e) => e.preventDefault()}>
          <div className="tv-ctx-head">
            <span className="fic"><I.folder s={14} /></span>
            <span className="nm" title={menu.node.name}>{menu.node.name}</span>
            <span className="ct">{menuCount} song{menuCount === 1 ? "" : "s"}</span>
          </div>
          {!menu.confirm ? (
            <button className="tv-ctx-item del" onClick={() => setMenu((m) => ({ ...m, confirm: true }))}>
              <I.trash s={15} /> Remove folder from library
            </button>
          ) : (
            <div className="tv-ctx-confirm">
              <div className="tv-ctx-msg">
                Remove {menuCount} song{menuCount === 1 ? "" : "s"} from your library?
                Your files stay on disk.
              </div>
              <div className="tv-ctx-actions">
                <button className="tv-ctx-cancel" onClick={closeMenu}>Cancel</button>
                <button className="tv-ctx-del" onClick={confirmDelete}><I.trash s={14} /> Remove</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ============================ MANAGE GRID ============================ */
function TandaCard({ t, onEdit, onDelete, onTagClick, activeTagKeys, preview }) {
  const m = tandaMeta(t);
  return (
    <div className="tv-tcard">
      <div className="tv-tcard-top">
        <div className="tv-tcard-orq">
          <div className="o">{t.name || m.orq}</div>
          {(t.name || m.singer) && (
            <div className="sub">{[t.name ? m.orq : null, m.singer || null].filter(Boolean).join(" · ")}</div>
          )}
          {t.tags && t.tags.length > 0 && (
            <div className="tv-tcard-tags">
              <TagPills tags={t.tags} onClick={onTagClick} activeKeys={activeTagKeys} />
            </div>
          )}
        </div>
      </div>
      <div className="tv-tcard-songs">
        {t.songs.map((s, i) => {
          const isPlaying = preview && preview.previewId === s.id && preview.playing;
          return (
            <div key={s.id + i} className={"tv-tcard-song" + (preview ? " is-clickable" : "") + (isPlaying ? " playing" : "")}
              onClick={preview ? () => preview.toggle(s) : undefined}
              title={previewTitle(preview, isPlaying)}>
              <span className="n"><PreviewGlyph preview={preview} playing={isPlaying} n={i + 1} s={11} /></span>
              <span className="t">{s.title}</span>
              <span className="d">{s.dur}</span>
            </div>
          );
        })}
      </div>
      <div className="tv-tcard-foot">
        <div className="tv-tcard-total">{t.songs.length} songs · <b>{m.total}</b></div>
        <button className="tv-tcbtn" onClick={() => onEdit(t)}><I.pencil s={14} /> Edit</button>
        <button className="tv-tcbtn del" onClick={() => onDelete(t)} title="Delete tanda"><I.trash s={15} /></button>
      </div>
    </div>
  );
}

function ManageGrid({ tandas, onEdit, onDelete, onNew, preview }) {
  if (!tandas.length) {
    return (
      <div className="tv-manage">
        <div className="tv-empty-manage">
          <div className="ic"><I.scissor s={26} /></div>
          <h3>No tandas yet</h3>
          <p>Build your first tanda from the songs you imported.</p>
          <button className="tv-save" style={{ width: 200, margin: "0 auto" }} onClick={onNew}>
            <I.plus s={17} /> Build a tanda
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="tv-manage">
      <div className="tv-grid">
        {tandas.map((t) => <TandaCard key={t.id} t={t} onEdit={onEdit} onDelete={onDelete} preview={preview} />)}
        <button className="tv-newcard" onClick={onNew}>
          <span className="ic"><I.plus s={22} /></span>
          <span className="lb">New tanda</span>
        </button>
      </div>
    </div>
  );
}

Object.assign(window, { tandaMeta, tandaTypes, TandaLibCard, LibraryTree, ManageGrid });
