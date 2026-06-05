// tandas-parts.jsx — unified library tree (folders + songs), manage grid + meta helpers
const { useState, useMemo, useEffect, useRef } = React;

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

/* ============================ SONG EDITOR ============================
 * The inline metadata editor that replaces a SongRow while editing. Saving
 * writes both the file's tags (on disk) and the database (via Store.updateSong),
 * so the change is durable and reflected everywhere the song appears. */
function SongEditRow({ s, onClose }) {
  const [draft, setDraft] = useState({
    title: s.title || "",
    orq: s.orq || "",
    singer: s.singer || "",
    year: s.year != null ? String(s.year) : "",
    album: s.album || "",
    genre: s.genre || "tango",
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(false);
  const set = (k) => (e) => setDraft((d) => ({ ...d, [k]: e.target.value }));

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setErr(false);
    const yearTrim = draft.year.trim();
    const yearNum = yearTrim ? parseInt(yearTrim, 10) : null;
    try {
      const updated = await Store.updateSong({
        id: s.id,
        title: draft.title.trim() || s.title,
        orq: draft.orq.trim(),
        singer: draft.singer.trim(),
        album: draft.album.trim() || null,
        year: Number.isFinite(yearNum) ? yearNum : null,
        genre: draft.genre,
      });
      if (!updated) { setErr(true); setSaving(false); return; }
      onClose();
    } catch (e) {
      setErr(true);
      setSaving(false);
    }
  };

  const onKey = (e) => {
    if (e.key === "Enter" && e.target.tagName !== "SELECT") { e.preventDefault(); save(); }
    else if (e.key === "Escape") { e.preventDefault(); if (!saving) onClose(); }
  };

  return (
    <div className="tv-song-edit" onKeyDown={onKey} onClick={(e) => e.stopPropagation()}>
      <div className="tv-song-edit-grid">
        <label className="f wide"><span>Title</span>
          <input autoFocus value={draft.title} onChange={set("title")} placeholder="Title" /></label>
        <label className="f"><span>Orchestra</span>
          <input value={draft.orq} onChange={set("orq")} placeholder="Orchestra" /></label>
        <label className="f"><span>Singer</span>
          <input value={draft.singer} onChange={set("singer")} placeholder="Instrumental" /></label>
        <label className="f"><span>Year</span>
          <input value={draft.year} onChange={set("year")} inputMode="numeric" placeholder="—" maxLength={4} /></label>
        <label className="f"><span>Genre</span>
          <select value={draft.genre} onChange={set("genre")}>
            <option value="tango">Tango</option>
            <option value="vals">Vals</option>
            <option value="milonga">Milonga</option>
            <option value="cortina">Cortina</option>
          </select></label>
        <label className="f wide"><span>Album</span>
          <input value={draft.album} onChange={set("album")} placeholder="Album" /></label>
      </div>
      <div className="tv-song-edit-foot">
        {err && <span className="tv-song-edit-err">Couldn’t save — please try again.</span>}
        <button className="tv-song-edit-cancel" onClick={onClose} disabled={saving}>Cancel</button>
        <button className="tv-song-edit-save" onClick={save} disabled={saving}>
          {saving ? "Saving…" : <><I.check s={14} /> Save</>}
        </button>
      </div>
    </div>
  );
}

/* ============================ SONG ROW ============================
 * `library` renders the read-only variant used by the Library view: it keeps
 * the listen affordance but drops the builder drag handle and the +/add button,
 * and adds a pencil to edit the song's metadata in place. */
function SongRow({ s, inBuilder, onAdd, dragHandlers, dragging, isPreview, isPlaying, onPreview, previewViaMonitor, library }) {
  const isCort = s.genre === "cortina";
  const [editing, setEditing] = useState(false);
  if (editing) return <SongEditRow s={s} onClose={() => setEditing(false)} />;
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
      {!library ? (
        <button className={"add" + (inBuilder ? " in" : "")} onClick={(e) => { e.stopPropagation(); onAdd(); }}
          title={inBuilder ? "Already in the tanda" : "Add to tanda"}>
          {inBuilder ? <I.check s={15} /> : <I.plus s={15} />}
        </button>
      ) : (
        <button className="edit" onClick={(e) => { e.stopPropagation(); setEditing(true); }}
          title="Edit song details">
          <I.pencil s={14} />
        </button>
      )}
    </div>
  );
}

/* ============================ SONG SEARCH ============================
 * One shared search engine for browsing songs — used by the Library view and
 * the Tanda builder (both render through <LibraryTree>). It blends two modes:
 *
 *   • Fuzzy free text — every bare word must match (as an ordered subsequence)
 *     somewhere in a song's combined metadata, so "disar" finds "Di Sarli" and
 *     "poemarufino" finds Poema sung by Rufino. Contiguous and word-start hits
 *     score higher, so the best matches float to the top.
 *
 *   • Scoped metadata filters — `field:value` tokens narrow to one attribute,
 *     e.g. orq:di sarli · singer:rufino · genre:vals · year:1940s · album:rca ·
 *     folder:cortinas. Years accept an exact year, a decade (1940s), a range
 *     (1935-1945) or a comparator (>1940, <=1945).
 *
 * The pieces are pure functions exported on window so any view can reuse them. */

function _norm(v) { return v == null ? "" : String(v).toLowerCase(); }

// Aliases let DJs type the field name that comes naturally to them.
const SEARCH_FIELDS = {
  title: "title", t: "title", song: "title", name: "title",
  orq: "orq", orch: "orq", orchestra: "orq", artist: "orq", by: "orq",
  singer: "singer", voz: "singer", voice: "singer", vocal: "singer", vocalist: "singer",
  genre: "genre", type: "genre", g: "genre",
  year: "year", y: "year", decade: "year",
  album: "album", alb: "album", record: "album",
  folder: "folder", dir: "folder", path: "folder",
};

// The user-facing menu of filters (label + example), shown in the help popover.
const SEARCH_FIELD_HELP = [
  { key: "orq", label: "Orchestra", example: "orq:di sarli" },
  { key: "singer", label: "Singer", example: "singer:rufino" },
  { key: "genre", label: "Genre", example: "genre:vals" },
  { key: "year", label: "Year / decade", example: "year:1940s" },
  { key: "album", label: "Album", example: "album:rca" },
  { key: "folder", label: "Folder", example: "folder:cortinas" },
];

// Split a raw query into scoped {field,value} filters + bare fuzzy words. A
// field token with an empty value (the DJ is mid-type, e.g. "orq:") is ignored
// so the list doesn't blank out before they've typed anything to match.
function parseSearch(raw) {
  const tokens = _norm(raw).trim().split(/\s+/).filter(Boolean);
  const filters = [];
  const words = [];
  for (const tok of tokens) {
    const m = tok.match(/^([a-z]+):(.*)$/);
    if (m && SEARCH_FIELDS[m[1]]) {
      if (m[2]) filters.push({ field: SEARCH_FIELDS[m[1]], value: m[2] });
    } else {
      words.push(tok);
    }
  }
  return { filters, words, active: filters.length > 0 || words.length > 0 };
}

// Ordered-subsequence fuzzy score over already-lowercased strings. Returns -1
// when `q` isn't a subsequence of `text`; otherwise a score that rewards hits at
// word boundaries and runs of consecutive characters (tighter matches win).
function fuzzyScore(q, text) {
  if (!q) return 0;
  let qi = 0, score = 0, run = 0, prev = -2;
  for (let ti = 0; ti < text.length && qi < q.length; ti++) {
    if (text[ti] === q[qi]) {
      let bonus = 1;
      const before = ti === 0 ? " " : text[ti - 1];
      if (before === " " || before === "/" || before === "·" || before === "-") bonus += 4;
      if (ti === prev + 1) { run += 1; bonus += run * 3; } else run = 0;
      score += bonus;
      prev = ti;
      qi++;
    }
  }
  return qi === q.length ? score : -1;
}

// Score a single field value against a sought string: prefer a literal
// substring (with a prefix kicker) and fall back to a fuzzy subsequence.
function scoreText(value, hay) {
  if (!hay) return -1;
  const idx = hay.indexOf(value);
  if (idx >= 0) return 14 - Math.min(idx, 8) + (idx === 0 ? 6 : 0);
  return fuzzyScore(value, hay);
}

// Year filters: exact (1940), decade (1940s), range (1935-1945) or comparators
// (>1940, >=1940, <1945, <=1945); partial digits fall back to a prefix match.
function matchYear(year, value) {
  if (!year) return false;
  let m;
  if ((m = value.match(/^(\d{4})\s*-\s*(\d{4})$/))) return year >= +m[1] && year <= +m[2];
  if ((m = value.match(/^>(=?)(\d{4})$/))) return m[1] ? year >= +m[2] : year > +m[2];
  if ((m = value.match(/^<(=?)(\d{4})$/))) return m[1] ? year <= +m[2] : year < +m[2];
  if ((m = value.match(/^(\d{2,4})s$/))) return Math.floor(year / 10) * 10 === Math.floor(+m[1] / 10) * 10;
  if ((m = value.match(/^(\d{4})$/))) return year === +m[1];
  return String(year).startsWith(value);
}

function songFieldText(song, field) {
  switch (field) {
    case "title": return _norm(song.title);
    case "orq": return _norm(song.orq);
    case "singer": return _norm(song.singer);
    case "genre": return _norm(song.genre);
    case "album": return _norm(song.album);
    case "folder": return _norm(song.folder) + " " + _norm(song.folderPath);
    default: return "";
  }
}

// The blob every bare word is fuzzy-matched against.
function songHaystack(song) {
  return [song.title, song.orq, song.singer, song.album, song.folder, song.genre,
    song.year ? String(song.year) : ""].map(_norm).join("  ");
}

// Score a song against a parsed query. Returns null when any filter or word
// fails to match (AND semantics); otherwise the summed relevance score.
function scoreSong(song, parsed) {
  let score = 0;
  for (const f of parsed.filters) {
    if (f.field === "year") { if (!matchYear(song.year, f.value)) return null; score += 6; continue; }
    const s = scoreText(f.value, songFieldText(song, f.field));
    if (s < 0) return null;
    score += s;
  }
  if (parsed.words.length) {
    const hay = songHaystack(song);
    for (const w of parsed.words) {
      const s = scoreText(w, hay);
      if (s < 0) return null;
      score += s;
    }
  }
  return score;
}

// Flat search over a song array → best matches first. Empty query = unchanged.
function searchSongs(songs, raw) {
  const parsed = parseSearch(raw);
  if (!parsed.active) return (songs || []).slice();
  const hits = [];
  for (const s of songs || []) {
    const sc = scoreSong(s, parsed);
    if (sc != null) hits.push({ s, sc });
  }
  hits.sort((a, b) => b.sc - a.sc);
  return hits.map((h) => h.s);
}

// A folder row can satisfy a query on its own — but only for bare words and
// `folder:` filters (no song-attribute filter can be met by a folder name).
// Returns true when the folder name/path matches all such terms.
function folderMatches(node, parsed) {
  if (parsed.filters.some((f) => f.field !== "folder")) return false;
  const hay = _norm(node.name) + "  " + _norm(node.path);
  for (const f of parsed.filters) if (scoreText(f.value, hay) < 0) return false;
  for (const w of parsed.words) if (scoreText(w, hay) < 0) return false;
  return true;
}

// Prune the library tree to matching folders/songs. A folder that matches by
// name keeps all its own songs; otherwise only its matching songs survive, best
// match first. Branches with any surviving content are kept (and force-opened
// by the caller). Empty query returns the tree untouched.
function searchTree(tree, raw) {
  const parsed = parseSearch(raw);
  if (!parsed.active) return tree || [];
  const prune = (node) => {
    const nameHit = folderMatches(node, parsed);
    const songs = nameHit
      ? (node.songs || [])
      : searchSongs(node.songs || [], raw);
    const children = (node.children || []).map(prune).filter(Boolean);
    if (nameHit || songs.length || children.length) return { ...node, songs, children };
    return null;
  };
  return (tree || []).map(prune).filter(Boolean);
}

/* ============================ ADVANCED SEARCH INPUT ============================
 * The shared search pill. Beyond plain text it advertises the scoped metadata
 * filters via a "Filters" popover whose chips drop a `field:` prefix straight
 * into the box, and offers a clear (×) button once there's a query. Reused by
 * the Library view and the Tanda builder so both speak the same search language. */
function AdvancedSearch({ value, onChange, placeholder }) {
  const [open, setOpen] = useState(false);
  const inputRef = useRef(null);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Drop a `field:` prefix at the end of the query, then focus the box so the
  // DJ can keep typing the value straight away.
  const insertField = (key) => {
    const base = value && !/\s$/.test(value) ? value + " " : (value || "");
    onChange(base + key + ":");
    setOpen(false);
    requestAnimationFrame(() => inputRef.current && inputRef.current.focus());
  };

  const clear = () => { onChange(""); inputRef.current && inputRef.current.focus(); };

  return (
    <div className="tp-asearch" ref={wrapRef}>
      <label className="tp-search">
        <I.search s={15} />
        <input ref={inputRef} value={value} onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder || "Search songs… (try orq:di sarli, year:1940s)"}
          onFocus={() => setOpen(true)} />
        {value ? (
          <button type="button" className="tp-asearch-clear" onClick={clear} title="Clear search">
            <I.x s={13} />
          </button>
        ) : null}
        <button type="button" className={"tp-asearch-toggle" + (open ? " is-open" : "")}
          onMouseDown={(e) => e.preventDefault()} onClick={() => setOpen((o) => !o)}
          title="Search filters">
          <I.tag s={13} /> Filters
        </button>
      </label>
      {open && (
        <div className="tp-asearch-pop" onMouseDown={(e) => e.stopPropagation()}>
          <div className="tp-asearch-pop-head">Narrow by field</div>
          <div className="tp-asearch-chips">
            {SEARCH_FIELD_HELP.map((f) => (
              <button key={f.key} type="button" className="tp-asearch-chip" onClick={() => insertField(f.key)}>
                <span className="k">{f.label}</span>
                <span className="ex">{f.example}</span>
              </button>
            ))}
          </div>
          <div className="tp-asearch-pop-foot">
            Combine freely — bare words fuzzy-match every field. e.g. <b>poema orq:canaro</b>
          </div>
        </div>
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

  // Fuzzy + metadata search prunes the tree to matching folders/songs (best
  // match first) and force-opens it. See the shared engine above.
  const filtered = useMemo(() => searchTree(tree, q), [q, tree]);

  const searching = !!q.trim();
  const songProps = { builderIds, onAdd, makeDrag, draggingId, preview, library, onFolderContext: openMenu };
  const menuCount = menu ? countSongs(menu.node) : 0;

  return (
    <div className="tv-tree">
      <div className="tv-tree-head">
        <AdvancedSearch value={q} onChange={setQ}
          placeholder="Search songs & folders… (try orq:di sarli, year:1940s)" />
        {library && hint && <div className="tv-songs-hint">{hint}</div>}
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
function TandaCard({ t, onEdit, onDelete, preview }) {
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
              <TagPills tags={t.tags} />
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

Object.assign(window, {
  tandaMeta, tandaTypes, TandaLibCard, LibraryTree, ManageGrid,
  // Shared song-search engine + input, reusable by any view (library, builder…).
  AdvancedSearch, searchSongs, searchTree, parseSearch, scoreSong, fuzzyScore,
});
