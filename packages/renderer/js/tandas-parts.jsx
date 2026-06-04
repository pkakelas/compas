// tandas-parts.jsx — folder tree, song list, manage grid + meta helpers
const { useState: useS, useMemo: useM } = React;

/* ---------- tanda meta ---------- */
function tandaMeta(t) {
  const songs = t.songs || [];
  if (!songs.length) return { orq: "Empty tanda", genre: "tango", singer: "", decade: "", total: "0:00" };
  const orqs = [...new Set(songs.map((s) => s.orq))];
  const orq = orqs.length === 1 ? orqs[0] : "Mixed orchestras";
  const genres = [...new Set(songs.map((s) => s.genre))];
  const genre = genres.length === 1 ? genres[0] : "tango";
  const singers = [...new Set(songs.map((s) => s.singer).filter(Boolean))];
  const singer = singers.length === 0 ? "Instrumental" : singers.length === 1 ? singers[0] : "Various singers";
  const years = songs.map((s) => s.year).filter(Boolean);
  const decade = years.length ? Math.floor(Math.min(...years) / 10) * 10 + "s" : "";
  return { orq, genre, singer, decade, total: tandaTotal(songs) };
}

/* ---------- songs under a node, grouped by leaf folder ---------- */
function groupsOf(node) {
  const groups = [];
  const walk = (n) => {
    if (n.songs && n.songs.length) groups.push({ name: n.name, path: n.path, songs: n.songs });
    if (n.children) n.children.forEach(walk);
  };
  walk(node);
  return groups;
}

/* ============================ FOLDER TREE ============================ */
function FolderNode({ node, sel, onSelect, openSet, toggle }) {
  const hasKids = !!(node.children && node.children.length);
  const isOpen = openSet.has(node.path);
  const isSel = sel && sel.path === node.path;
  return (
    <div className="tv-folder">
      <div className={"tv-folder-row" + (isSel ? " sel" : "")}
        onClick={() => { onSelect(node); if (hasKids && !isOpen) toggle(node.path); }}>
        <span className={"caret" + (hasKids ? (isOpen ? " open" : "") : " leaf")}
          onClick={(e) => { e.stopPropagation(); if (hasKids) toggle(node.path); }}>
          <I.chev s={12} />
        </span>
        <span className="fic">{hasKids && isOpen ? <I.folderOpen s={15} /> : <I.folder s={15} />}</span>
        <span className="nm">{node.name}</span>
        <span className="ct">{countSongs(node)}</span>
      </div>
      {hasKids && isOpen && (
        <div className="tv-folder-kids">
          {node.children.map((c) => (
            <FolderNode key={c.path} node={c} sel={sel} onSelect={onSelect} openSet={openSet} toggle={toggle} />
          ))}
        </div>
      )}
    </div>
  );
}

function FolderTree({ sel, onSelect }) {
  const { tree } = useStore();
  const [openSet, setOpenSet] = useS(() => new Set(tree[0] ? [tree[0].path] : []));
  const [q, setQ] = useS("");
  const toggle = (path) => setOpenSet((s) => {
    const n = new Set(s); n.has(path) ? n.delete(path) : n.add(path); return n;
  });

  // when searching, surface matching folders flat
  const matches = useM(() => {
    if (!q.trim()) return null;
    const ql = q.toLowerCase(); const out = [];
    const walk = (n) => {
      const hit = n.name.toLowerCase().includes(ql) ||
        (n.songs && n.songs.some((s) => (s.title + s.orq + s.singer).toLowerCase().includes(ql)));
      if (hit) out.push(n);
      if (n.children) n.children.forEach(walk);
    };
    tree.forEach(walk);
    return out;
  }, [q, tree]);

  return (
    <div className="tv-rail">
      <div className="tv-rail-head">
        <label className="tp-search">
          <I.search s={15} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a folder or song…" />
        </label>
      </div>
      <div className="tv-rail-scroll">
        {matches
          ? matches.map((n) => (
              <div key={n.path} className={"tv-folder-row" + (sel && sel.path === n.path ? " sel" : "")}
                onClick={() => onSelect(n)} style={{ paddingLeft: 11 }}>
                <span className="fic"><I.folder s={15} /></span>
                <span className="nm">{n.name}</span>
                <span className="ct">{countSongs(n)}</span>
              </div>
            ))
          : tree.map((n) => (
              <FolderNode key={n.path} node={n} sel={sel} onSelect={onSelect} openSet={openSet} toggle={toggle} />
            ))}
        {matches && matches.length === 0 && <div className="tp-empty">No folders match.</div>}
      </div>
    </div>
  );
}

/* ============================ SONG LIST ============================ */
function SongRow({ s, inBuilder, onAdd, dragHandlers, dragging, isPreview, isPlaying, onPreview }) {
  const isCort = s.genre === "cortina";
  return (
    <div className={"tv-song" + (isCort ? " cortina" : "") + (inBuilder ? " in-builder" : "") + (dragging ? " dragging" : "") + (isPreview ? " playing" : "")}
      draggable {...dragHandlers}>
      <button className={"play" + (isPreview && isPlaying ? " on" : "")} onClick={(e) => { e.stopPropagation(); onPreview(); }}
        title={isPreview && isPlaying ? "Pause" : "Play"}>
        {isPreview && isPlaying ? <I.pause s={14} /> : <I.play s={14} />}
      </button>
      <div className="tt">
        <div className="tv-song-title">
          {s.title}
          {!s.singer && !isCort && <span className="ipill">Instr.</span>}
        </div>
        <div className="tv-song-sub">{s.orq}{s.singer ? " · " + s.singer : ""}</div>
      </div>
      <span className="yr">{s.year}</span>
      <span className="du">{s.dur}</span>
      <button className={"add" + (inBuilder ? " in" : "")} onClick={(e) => { e.stopPropagation(); onAdd(); }}
        title={inBuilder ? "Already in the tanda" : "Add to tanda"}>
        {inBuilder ? <I.check s={15} /> : <I.plus s={15} />}
      </button>
    </div>
  );
}

function SongList({ node, builderIds, onAdd, makeDrag, draggingId, preview }) {
  const groups = useM(() => groupsOf(node), [node]);
  const showHeaders = groups.length > 1;
  return (
    <div className="tv-songs">
      <div className="tv-songs-head">
        <div className="tv-crumb">
          <I.folderOpen s={17} />
          <b>{node.name}</b>
          {node.path.includes(" / ") && <><span className="sep">·</span><span>{node.path}</span></>}
        </div>
        <div className="tv-songs-hint"><I.drag s={13} /> Drag songs into the builder, or tap +</div>
      </div>
      <div className="tv-songs-scroll">
        <div className="tv-songhead">
          <span></span><span>Track</span><span>Year</span><span>Time</span><span></span>
        </div>
        {groups.map((g) => (
          <div key={g.path}>
            {showHeaders && (
              <div className="tv-grouphdr">
                <span className="fic"><I.folder s={14} /></span>
                <span className="nm">{g.name}</span>
                <span className="ct">{g.songs.length}</span>
                <span className="ln"></span>
              </div>
            )}
            {g.songs.map((s) => (
              <SongRow key={s.id} s={s} inBuilder={builderIds.has(s.id)}
                onAdd={() => onAdd(s)} dragHandlers={makeDrag(s)} dragging={draggingId === s.id}
                isPreview={preview && preview.previewId === s.id} isPlaying={preview && preview.playing}
                onPreview={() => preview && preview.toggle(s)} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ============================ MANAGE GRID ============================ */
function GenreTagX({ genre }) {
  const lbl = { tango: "Tango", vals: "Vals", milonga: "Milonga", cortina: "Cortina" }[genre] || "Tango";
  return <span className={"tp-tag is-" + genre} style={{ height: 19, fontSize: 10, padding: "0 7px" }}>{lbl}</span>;
}

function TandaCard({ t, onEdit, onDelete }) {
  const m = tandaMeta(t);
  return (
    <div className="tv-tcard">
      <div className="tv-tcard-top">
        <div className="tv-tcard-orq">
          <div className="o">{t.name || m.orq} <GenreTagX genre={m.genre} />
            {m.decade && <span className="tp-tag is-plain" style={{ height: 19, fontSize: 10, padding: "0 7px" }}>{m.decade}</span>}</div>
          <div className="sub">{t.name ? m.orq + " · " : ""}{m.singer}</div>
        </div>
      </div>
      <div className="tv-tcard-songs">
        {t.songs.map((s, i) => (
          <div key={s.id + i} className="tv-tcard-song">
            <span className="n">{i + 1}</span>
            <span className="t">{s.title}</span>
            <span className="d">{s.dur}</span>
          </div>
        ))}
      </div>
      <div className="tv-tcard-foot">
        <div className="tv-tcard-total">{t.songs.length} songs · <b>{m.total}</b></div>
        <button className="tv-tcbtn" onClick={() => onEdit(t)}><I.pencil s={14} /> Edit</button>
        <button className="tv-tcbtn del" onClick={() => onDelete(t)} title="Delete tanda"><I.trash s={15} /></button>
      </div>
    </div>
  );
}

function ManageGrid({ tandas, onEdit, onDelete, onNew }) {
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
        {tandas.map((t) => <TandaCard key={t.id} t={t} onEdit={onEdit} onDelete={onDelete} />)}
        <button className="tv-newcard" onClick={onNew}>
          <span className="ic"><I.plus s={22} /></span>
          <span className="lb">New tanda</span>
        </button>
      </div>
    </div>
  );
}

Object.assign(window, { tandaMeta, groupsOf, FolderTree, SongList, ManageGrid, GenreTagX });
