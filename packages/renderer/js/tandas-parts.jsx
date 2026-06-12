// tandas-parts.jsx — unified library tree (folders + songs), manage grid + meta helpers
const { useState, useMemo, useEffect, useRef } = React;

/* The conventional periodization of recorded tango. Shown as context next to a
 * year (never as a filter facet) so a DJ can place a recording at a glance.
 * Boundaries follow the usual DJ convention; the upper bound of each band is
 * inclusive. */
const TANGO_ERAS = [
  { max: 1925, label: "Guardia Vieja" },
  { max: 1934, label: "Guardia Nueva" },
  { max: 1955, label: "Época de Oro" },
  { max: 1979, label: "Vanguardia" },
  { max: Infinity, label: "Contemporáneo" },
];
function eraForYear(year) {
  if (!year) return "";
  for (const e of TANGO_ERAS) if (year <= e.max) return e.label;
  return "";
}

/* ---------- tanda meta ---------- */
function tandaMeta(t) {
  const songs = t.songs || [];
  if (!songs.length) return { orq: "Empty tanda", genre: "tango", singer: "", year: "", era: "", total: "0:00" };
  const orqs = [...new Set(songs.map((s) => s.orq))];
  const orq = orqs.length === 1 ? orqs[0] : "Mixed orchestras";
  const genres = [...new Set(songs.map((s) => s.genre))];
  const genre = genres.length === 1 ? genres[0] : "tango";
  const singers = [...new Set(songs.map((s) => s.singer).filter(Boolean))];
  const singer = singers.length === 1 ? singers[0] : singers.length > 1 ? "Various singers" : "";
  const years = songs.map((s) => s.year).filter(Boolean);
  // Show the exact year, or a span when a tanda mixes recordings; the era is
  // keyed off the earliest recording in the set.
  let year = "", era = "";
  if (years.length) {
    const lo = Math.min(...years), hi = Math.max(...years);
    year = lo === hi ? String(lo) : `${lo}–${hi}`;
    era = eraForYear(lo);
  }
  return { orq, genre, singer, year, era, total: tandaTotal(songs) };
}

/* The lowercased labels of a tanda's "type" tags (Tango / Vals / Milonga /
 * Cortina). This is the DJ-assigned classification — unlike tandaMeta().genre,
 * which is merely inferred from the songs' file metadata. */
function tandaTypes(t) {
  return (t.tags || []).filter((tg) => tg.cat === "type").map((tg) => (tg.label || "").toLowerCase());
}

/* A short human label for a tanda: its name, or the orchestra summary when it's
 * still unnamed (matches how cards/queue render it elsewhere). */
function tandaLabel(t) {
  return t.name || tandaMeta(t).orq;
}

/* Comma-joined, quoted tanda names with a "+N more" tail past `max`. */
function tandaNames(list, max = 2) {
  const names = list.map((t) => `“${tandaLabel(t)}”`);
  if (names.length <= max) return names.join(", ");
  return names.slice(0, max).join(", ") + ` +${names.length - max} more`;
}

/* Spells out how deleting a folder ripples into the DJ's tandas: which sets get
 * emptied (and thus removed) versus merely shortened. Rendered inside the
 * remove-folder confirmation so the consequence is clear before they commit. */
function TandaImpact({ emptied, shrunk }) {
  const e = emptied.length;
  return (
    <>
      {e > 0 && (
        <div>
          <strong>{e} tanda{e === 1 ? "" : "s"}</strong> ({tandaNames(emptied)}) will be left
          empty and removed from your collection.
        </div>
      )}
      {shrunk > 0 && (
        <div>
          {e > 0 ? "Another " : ""}<strong>{shrunk} tanda{shrunk === 1 ? "" : "s"}</strong> will
          lose {shrunk === 1 ? "a song" : "songs"} but stay.
        </div>
      )}
    </>
  );
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
  const songNameOnly = useSongNameOnly();
  const hasTags = t.tags && t.tags.length > 0;
  const toggle = () => setOpen((o) => !o);
  // On a short screen an opened tanda can be taller than the library viewport,
  // pushing its last songs out of reach. When open, cap the song list to the
  // space left in the viewport (below this card's header) and let it scroll on
  // its own. The cap equals the available height, so a tanda that already fits
  // never overflows — the scrollbar only appears when the screen is too small.
  const headRef = useRef(null);
  const songsRef = useRef(null);
  const [songsMaxH, setSongsMaxH] = useState(null);
  useEffect(() => {
    if (!open) { setSongsMaxH(null); return; }
    const songs = songsRef.current;
    const scroll = songs && songs.closest(".tp-lib-scroll");
    if (!scroll) return;
    const recompute = () => {
      const headH = headRef.current ? headRef.current.offsetHeight : 0;
      const cs = getComputedStyle(scroll);
      const padB = parseFloat(cs.paddingBottom) || 0;
      // viewport height minus this card's header and the scroll area's bottom pad
      const avail = scroll.clientHeight - headH - padB - 8;
      setSongsMaxH(Math.max(140, avail));
    };
    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(scroll);
    window.addEventListener("resize", recompute);
    return () => { ro.disconnect(); window.removeEventListener("resize", recompute); };
  }, [open]);
  return (
    <div className={"tp-tandax" + (open ? " is-open" : "")}>
      <div ref={headRef} className="tp-tandax-head">
        <button className={"tp-tandax-caret" + (open ? " is-open" : "")} onClick={toggle}
          title={open ? "Hide songs" : "Show songs"} aria-expanded={open}>
          <I.chev s={14} />
        </button>
        <div className="tp-tandax-main" onClick={toggle}>
          <div className="tp-libcard-top">
            <span className="tp-libcard-orq">{t.name || m.orq}</span>
            {hasTags ? <TagPills tags={t.tags} max={3} /> : <GenreTag genre={m.genre} small />}
            {m.year && <span className="tp-tag is-plain sm" title={m.era}>{m.year}</span>}
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
        <div ref={songsRef} className="tp-tandax-songs"
          style={songsMaxH ? { maxHeight: songsMaxH, overflowY: "auto" } : undefined}>
          {t.songs.map((s, i) => {
            const playing = preview && preview.previewId === s.id && preview.playing;
            return (
              <div key={s.id + ":" + i}
                className={"tp-songrow" + (preview ? " is-clickable" : "") + (playing ? " is-now" : "")}
                onClick={preview ? (e) => { e.stopPropagation(); preview.toggle(s); } : undefined}
                {...(preview ? clickKeys(() => preview.toggle(s)) : {})}
                title={previewTitle(preview, playing)}>
                <span className="n"><PreviewGlyph preview={preview} playing={playing} n={i + 1} s={12} /></span>
                <span className="tt">
                  <div className="tp-song-title">{songNameOnly ? cleanSongTitle(s) : s.title}</div>
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
    isCortina: !!s.isCortina,
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(false);
  const set = (k) => (e) => setDraft((d) => ({ ...d, [k]: e.target.value }));
  const setVal = (k) => (v) => setDraft((d) => ({ ...d, [k]: v }));

  // Open-ended facets (orchestra, singer) suggest values already in the library
  // so existing names stay consistent — but the DJ can always type a brand-new
  // one. Snapshot on mount; the library doesn't shift mid-edit.
  const { orqOptions, singerOptions } = useMemo(() => {
    const songs = (window.Store && window.Store.get().songs) || [];
    const orqs = new Set(), singers = new Set();
    for (const x of songs) {
      if (x.orq && x.orq.trim()) orqs.add(x.orq.trim());
      if (x.singer && x.singer.trim()) singers.add(x.singer.trim());
    }
    const cmp = (a, b) => a.localeCompare(b, undefined, { sensitivity: "base" });
    return { orqOptions: [...orqs].sort(cmp), singerOptions: [...singers].sort(cmp) };
  }, []);

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
        isCortina: draft.isCortina,
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
          <CreatableCombo value={draft.orq} onChange={setVal("orq")} options={orqOptions} placeholder="Orchestra" /></label>
        <label className="f"><span>Singer</span>
          <CreatableCombo value={draft.singer} onChange={setVal("singer")} options={singerOptions} placeholder="Instrumental" /></label>
        <label className="f"><span>Year</span>
          <input value={draft.year} onChange={set("year")} inputMode="numeric" placeholder="—" maxLength={4} /></label>
        <label className="f"><span>Genre</span>
          <select value={draft.genre} onChange={set("genre")}>
            {(() => {
              const base = window.STYLE_TYPES || ["tango", "vals", "milonga", "cortina"];
              // Keep the song's current value selectable even if it's a custom/
              // non-preset style, so editing never silently changes it.
              const opts = base.indexOf(draft.genre) === -1 && draft.genre ? base.concat([draft.genre]) : base;
              const label = window.genreLabel || ((g) => g);
              return opts.map((g) => <option key={g} value={g}>{label(g)}</option>);
            })()}
          </select></label>
        <label className="f wide"><span>Album</span>
          <input value={draft.album} onChange={set("album")} placeholder="Album" /></label>
        <label className="tv-song-edit-cortina">
          <input type="checkbox" checked={draft.isCortina}
            onChange={(e) => setDraft((d) => ({ ...d, isCortina: e.target.checked }))} />
          <span className="tv-cort-text">
            <span className="tv-cort-title"><I.curtain s={14} /> Use as cortina</span>
            <span className="tv-cort-hint">A floor-clearer between tandas — kept separate from its genre.</span>
          </span>
        </label>
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
function SongRow({ s, inBuilder, onAdd, dragHandlers, dragging, isPreview, isPlaying, onPreview, previewViaMonitor, library, editing: editingProp, onEdit, onCloseEdit, onContext, onSelect, selected }) {
  const isCort = !!s.isCortina;
  // When the DJ opts into "song name only", strip the orchestra/singer/year
  // cruft baked into the title field and show just the bare song name. The
  // orchestra & singer still appear in the sub-line below, so nothing is lost.
  const songNameOnly = useSongNameOnly();
  const displayTitle = songNameOnly ? cleanSongTitle(s) : s.title;
  // Editing is parent-controlled in the Library view (so the right-click menu's
  // "Edit song" can open the editor) and self-managed everywhere else.
  const controlled = onEdit !== undefined;
  const [editingLocal, setEditingLocal] = useState(false);
  const editing = controlled ? !!editingProp : editingLocal;
  const startEdit = () => { if (controlled) onEdit(s); else setEditingLocal(true); };
  const closeEdit = () => { if (controlled) { if (onCloseEdit) onCloseEdit(); } else setEditingLocal(false); };
  const clickTimer = useRef(null);
  const handleClick = (e) => {
    // Library rows double as a multi-select surface: shift/⌘/ctrl-clicks adjust
    // the selection (for the bulk right-click menu) and never start a preview,
    // while a plain click both selects just this song and previews it. The
    // library has no double-click action, so we preview immediately rather than
    // waiting out the dbl-click debounce — that way clicking a new song
    // deactivates the previous one at once.
    if (library) {
      if (onSelect) {
        const modifier = e.shiftKey || e.metaKey || e.ctrlKey;
        onSelect(s, e);
        if (modifier) return;
      }
      onPreview();
      return;
    }
    if (clickTimer.current) clearTimeout(clickTimer.current);
    clickTimer.current = setTimeout(() => {
      clickTimer.current = null;
      onPreview();
    }, 250);
  };
  const handleDoubleClick = (e) => {
    e.preventDefault();
    if (clickTimer.current) {
      clearTimeout(clickTimer.current);
      clickTimer.current = null;
    }
    if (!library && onAdd) onAdd();
  };
  useEffect(() => () => { if (clickTimer.current) clearTimeout(clickTimer.current); }, []);
  const rowTitle = library
    ? (isPreview && isPlaying ? "Pause" : "Play preview")
    : (inBuilder ? "Already in the tanda" : "Double-click to add to tanda · click to play preview");
  const row = (
    <div className={"tv-song clickable" + (isCort ? " cortina" : "") + (inBuilder ? " in-builder" : "") + (dragging ? " dragging" : "") + (isPreview ? " playing" : "") + (editing ? " editing" : "") + (selected ? " selected" : "")}
      draggable={!library} {...(library ? {} : dragHandlers)}
      onMouseDown={library && onSelect ? (e) => { if (e.shiftKey) e.preventDefault(); } : undefined}
      onClick={handleClick}
      onDoubleClick={library ? undefined : handleDoubleClick}
      onContextMenu={library && onContext ? (e) => onContext(e, s) : undefined}
      title={isPreview && isPlaying ? "Pause" : rowTitle}>
      <button className={"play" + (isPreview && isPlaying ? " on" : "") + (previewViaMonitor ? " monitor" : "")} onClick={(e) => { e.stopPropagation(); onPreview(); }}
        title={isPreview && isPlaying ? "Pause" : previewViaMonitor ? "Pre-listen in headphones" : "Play preview"}>
        {isPreview && isPlaying ? <I.pause s={14} /> : (previewViaMonitor ? <I.headphones s={14} /> : <I.play s={14} />)}
      </button>
      <div className="tt">
        <div className="tv-song-title">
          {displayTitle}{isCort && <CortinaBadge />}
        </div>
        <div className="tv-song-sub">{s.orq}{s.singer ? " · " + s.singer : (isInstrumental(s) ? <> · <i className="tv-inst">Instrumental</i></> : "")}</div>
      </div>
      <span className="yr">{s.year}</span>
      <span className="du">{s.dur}</span>
      {!library ? (
        <button className={"add" + (inBuilder ? " in" : "")} onClick={(e) => { e.stopPropagation(); onAdd(); }}
          title={inBuilder ? "Already in the tanda" : "Add to tanda"}>
          {inBuilder ? <I.check s={15} /> : <I.plus s={15} />}
        </button>
      ) : (
        <button className={"edit" + (editing ? " on" : "")} onClick={(e) => { e.stopPropagation(); editing ? closeEdit() : startEdit(); }}
          title="Edit song details">
          <I.pencil s={14} />
        </button>
      )}
    </div>
  );
  if (!editing) return row;
  // The editor opens below the song rather than replacing it, so the track
  // stays in view while its metadata is edited.
  return (
    <>
      {row}
      <SongEditRow s={s} onClose={closeEdit} />
    </>
  );
}

/* ============================ SONG SEARCH ============================
 * Shared search for the Library view and Tanda builder (<LibraryTree>):
 *
 *   • Free text — fuzzy match across title, orchestra, singer, album, folder,
 *     genre and year ("disar" → Di Sarli, "poema rufino" → Poema by Rufino).
 *   • Dropdown filters — orchestra, singer, style and year picked from the
 *     library; each dropdown narrows to values that still match the others.
 *     Combined with free text (all must match).
 *
 * Pure functions are exported on window so any view can reuse them. */

function _norm(v) { return v == null ? "" : String(v).toLowerCase(); }

// An instrumental recording carries no singer credit. We surface it as its own
// label in listings and as a pickable value in the singer filter. (Cortinas are
// excluded — they're interludes, not instrumental tango.)
const INSTRUMENTAL = "Instrumental";
function isInstrumental(song) { return !song.isCortina && !(song.singer || "").trim(); }

const EMPTY_SEARCH = { text: "", orq: "", singer: "", genre: "", year: "" };

function buildSearchQuery(filters) {
  const words = _norm(filters.text || "").trim().split(/\s+/).filter(Boolean);
  const structured = [];
  if (filters.orq) structured.push({ field: "orq", value: _norm(filters.orq), exact: true });
  if (filters.singer === INSTRUMENTAL) structured.push({ field: "singer", instrumental: true });
  else if (filters.singer) structured.push({ field: "singer", value: _norm(filters.singer), exact: true });
  if (filters.genre) structured.push({ field: "genre", value: _norm(filters.genre), exact: true });
  if (filters.year) structured.push({ field: "year", value: String(filters.year), exact: true });
  return { words, filters: structured, active: words.length > 0 || structured.length > 0 };
}

function _isBoundary(ch) {
  return ch === " " || ch === "/" || ch === "·" || ch === "-";
}

function _words(text) {
  return text.split(/[\s/·-]+/).filter(Boolean);
}

// Score for matching `len` leading characters of a single word: a word-start
// bonus plus a growing run bonus, so longer (tighter) prefix hits win.
function _prefixScore(len) {
  let s = 5; // 1 base + 4 word-boundary bonus for the first character
  for (let r = 1; r < len; r++) s += 1 + 3 * r;
  return s;
}

// Word-prefix subsequence score over already-lowercased strings. The query must
// be coverable by an ordered set of word-prefixes (each matched chunk starts a
// word in `text`); letters lifted from the middle of a word never count. This
// keeps useful fuzzy matches like "disar"→"di sarli" and "poemarufino"→"Poema …
// Rufino" while rejecting the scattered mid-word noise that previously made a
// short query (e.g. "demare") match almost every song in a large library.
// Returns -1 when no such cover exists, otherwise the best (highest) score.
function fuzzyScore(q, text) {
  if (!q) return 0;
  const words = _words(text);
  const memo = new Map();
  const best = (qi, wi) => {
    if (qi >= q.length) return 0;
    if (wi >= words.length) return -1;
    const key = qi * 4096 + wi;
    const cached = memo.get(key);
    if (cached !== undefined) return cached;
    // Option 1: don't use this word at all.
    let res = best(qi, wi + 1);
    // Option 2: consume a leading prefix of this word from the query.
    const w = words[wi];
    let lcp = 0;
    while (lcp < w.length && qi + lcp < q.length && w[lcp] === q[qi + lcp]) lcp++;
    for (let len = 1; len <= lcp; len++) {
      // A single-character chunk taken from the middle of a multi-letter word is
      // the signature of a scattered, low-quality match — only allow it when it
      // finishes the query (the DJ is still typing the last word).
      if (len === 1 && w.length > 1 && qi + 1 !== q.length) continue;
      const rest = best(qi + len, wi + 1);
      if (rest < 0) continue;
      const sc = _prefixScore(len) + rest;
      if (sc > res) res = sc;
    }
    memo.set(key, res);
    return res;
  };
  return best(0, 0);
}

// Score a single field value against a sought string. A literal substring
// always outranks a fuzzy subsequence; a hit at a word start (and especially at
// the very beginning) ranks highest, and earlier positions edge out later ones.
function scoreText(value, hay) {
  if (!hay) return -1;
  const idx = hay.indexOf(value);
  if (idx >= 0) {
    const atWord = idx === 0 || _isBoundary(hay[idx - 1]);
    let score = 40 - Math.min(idx, 8);
    if (atWord) score += 20;
    if (idx === 0) score += 10;
    return score;
  }
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

// Score a song against a query. Returns null when any filter or word fails (AND
// semantics); otherwise the summed relevance score.
function scoreSong(song, query) {
  let score = 0;
  for (const f of query.filters) {
    if (f.field === "year") {
      if (f.exact ? song.year !== +f.value : !matchYear(song.year, f.value)) return null;
      score += 6;
      continue;
    }
    if (f.field === "genre") {
      if (_norm(song.genre) !== f.value) return null;
      score += 6;
      continue;
    }
    if (f.instrumental) {
      if (!isInstrumental(song)) return null;
      score += 20;
      continue;
    }
    if (f.exact) {
      if (songFieldText(song, f.field) !== f.value) return null;
      score += 20;
      continue;
    }
    const s = scoreText(f.value, songFieldText(song, f.field));
    if (s < 0) return null;
    score += s;
  }
  if (query.words.length) {
    const hay = songHaystack(song);
    for (const w of query.words) {
      const s = scoreText(w, hay);
      if (s < 0) return null;
      score += s;
    }
  }
  return score;
}

// Flat search over a song array → best matches first. Empty query = unchanged.
function searchSongs(songs, queryOrFilters) {
  const query = queryOrFilters.active !== undefined ? queryOrFilters : buildSearchQuery(queryOrFilters);
  if (!query.active) return (songs || []).slice();
  const hits = [];
  for (const s of songs || []) {
    const sc = scoreSong(s, query);
    if (sc != null) hits.push({ s, sc });
  }
  hits.sort((a, b) => b.sc - a.sc);
  return hits.map((h) => h.s);
}

// A folder row can satisfy a text-only query when every word matches its name/path.
function folderMatches(node, query) {
  if (query.filters.length) return false;
  const hay = _norm(node.name) + "  " + _norm(node.path);
  for (const w of query.words) if (scoreText(w, hay) < 0) return false;
  return query.words.length > 0;
}

// Prune the library tree to matching folders/songs. A folder that matches by
// name keeps all its own songs; otherwise only its matching songs survive, best
// match first. Branches with any surviving content are kept (and force-opened
// by the caller). Empty query returns the tree untouched.
function searchTree(tree, queryOrFilters) {
  const query = queryOrFilters.active !== undefined ? queryOrFilters : buildSearchQuery(queryOrFilters);
  if (!query.active) return tree || [];
  const prune = (node) => {
    const nameHit = folderMatches(node, query);
    const songs = nameHit
      ? (node.songs || [])
      : searchSongs(node.songs || [], query);
    const children = (node.children || []).map(prune).filter(Boolean);
    if (nameHit || songs.length || children.length) return { ...node, songs, children };
    return null;
  };
  return (tree || []).map(prune).filter(Boolean);
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

/* Debounce a fast-changing value (the search box) so the heavy prune/sort only
 * runs once typing settles — keeps a 2k+ song library responsive per keystroke. */
function useDebounced(value, delay) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}

/* ---------- sort ---------- */
const SORTS = [
  { key: "relevance", label: "Best match" },
  { key: "title", label: "Title A–Z" },
  { key: "orq", label: "Orchestra A–Z" },
  { key: "year_desc", label: "Year (new→old)" },
  { key: "year_asc", label: "Year (old→new)" },
  { key: "dur_desc", label: "Longest first" },
];

// Sort order for the style dropdown, keyed by the shared genreLabel() output.
const GENRE_ORDER = { Tango: 0, Vals: 1, Milonga: 2, Cortina: 3 };

function cmpStr(a, b) { return _norm(a).localeCompare(_norm(b)); }
function songSecs(s) { return s.durationSec != null ? s.durationSec : secOf(s.dur); }

// The comparator for a chosen sort. "relevance" keeps the search engine's
// best-first order while a query is active, and falls back to Title A–Z when
// there's nothing to rank against (so the default browse reads alphabetically).
function songComparator(sort, hasQuery) {
  switch (sort) {
    case "title": return (a, b) => cmpStr(a.title, b.title);
    case "orq": return (a, b) => cmpStr(a.orq, b.orq) || cmpStr(a.title, b.title);
    case "year_desc": return (a, b) => (b.year || 0) - (a.year || 0) || cmpStr(a.title, b.title);
    case "year_asc": return (a, b) => (a.year || 0) - (b.year || 0) || cmpStr(a.title, b.title);
    case "dur_desc": return (a, b) => songSecs(b) - songSecs(a);
    default: return hasQuery ? null : (a, b) => cmpStr(a.title, b.title);
  }
}

// Does a song match the active dropdown filters?
// out (used when building that field's option list from the other selections).
function songMatchesDropdownFilters(song, filters, omit) {
  if (omit !== "orq" && filters.orq && (song.orq || "").trim() !== filters.orq) return false;
  if (omit !== "singer" && filters.singer === INSTRUMENTAL) { if (!isInstrumental(song)) return false; }
  else if (omit !== "singer" && filters.singer && (song.singer || "").trim() !== filters.singer) return false;
  if (omit !== "genre" && filters.genre && song.genre !== filters.genre) return false;
  if (omit !== "year" && filters.year && String(song.year || "") !== String(filters.year)) return false;
  return true;
}

// Unique orchestra / singer / style / year values for dropdowns. Each list is
// scoped to songs that match the other active dropdown filters. When
// `includeCortinas` is false, cortina songs contribute nothing to the option
// lists — so a DJ browsing the normal repertoire never sees a floor-clearer's
// orchestra/singer/year offered as a filter. They can still surface those songs
// by browsing the tree or searching for them by text.
function buildFilterOptions(songs, filters = EMPTY_SEARCH, includeCortinas = true) {
  const cmp = (a, b) => a.localeCompare(b, undefined, { sensitivity: "base" });
  const orqs = new Set(), singers = new Set(), genres = new Set(), years = new Set();
  for (const s of songs || []) {
    if (!includeCortinas && s.isCortina) continue;
    if (songMatchesDropdownFilters(s, filters, "orq") && s.orq && s.orq.trim()) orqs.add(s.orq.trim());
    if (songMatchesDropdownFilters(s, filters, "singer")) {
      if (s.singer && s.singer.trim()) singers.add(s.singer.trim());
      else if (isInstrumental(s)) singers.add(INSTRUMENTAL);
    }
    if (songMatchesDropdownFilters(s, filters, "genre") && s.genre) genres.add(s.genre);
    if (songMatchesDropdownFilters(s, filters, "year") && s.year) years.add(String(s.year));
  }
  return {
    orchestras: [...orqs].sort(cmp),
    singers: [...singers].sort((a, b) => a === INSTRUMENTAL ? -1 : b === INSTRUMENTAL ? 1 : cmp(a, b)),
    genres: [...genres].sort((a, b) =>
      ((GENRE_ORDER[genreLabel(a)] ?? 99) - (GENRE_ORDER[genreLabel(b)] ?? 99)) || cmp(genreLabel(a), genreLabel(b)))
      .map((g) => ({ value: g, label: genreLabel(g) })),
    years: [...years].sort((a, b) => parseInt(b, 10) - parseInt(a, 10)),
  };
}

// Drop dropdown values that no longer exist after another filter changed — or
// after cortinas were hidden, which retires any selection that only a cortina
// song satisfied.
function sanitizeFilters(filters, songs, includeCortinas = true) {
  let next = null;
  let again = true;
  while (again) {
    again = false;
    const cur = next || filters;
    for (const [key, listKey, valOf] of [
      ["orq", "orchestras", (o) => o],
      ["singer", "singers", (o) => o],
      ["genre", "genres", (o) => o.value],
      ["year", "years", (o) => o],
    ]) {
      if (!cur[key]) continue;
      const allowed = buildFilterOptions(songs, { ...cur, [key]: "" }, includeCortinas)[listKey].map(valOf);
      if (!allowed.includes(cur[key])) {
        if (!next) next = { ...filters };
        next[key] = "";
        again = true;
      }
    }
  }
  return next || filters;
}

const PICK_LIST_CAP = 1000;
const PICK_SEARCH_MIN = 8; // hide in-panel search for short lists (style, etc.)

function normalizePickOptions(options) {
  return (options || []).map((o) => {
    const val = typeof o === "string" ? o : o.value;
    const lab = typeof o === "string" ? o : o.label;
    return { value: val, label: lab || val };
  });
}

/* Searchable filter dropdown — shared by orchestra, singer, style and year. */
function SearchableSelect({ placeholder, value, onChange, options, disabled, allLabel }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const rootRef = useRef(null);
  const searchRef = useRef(null);
  const menuRef = useRef(null);

  const normalized = useMemo(() => normalizePickOptions(options), [options]);
  const showSearch = normalized.length > PICK_SEARCH_MIN;
  const resetLabel = allLabel || ("All " + placeholder.toLowerCase() + "s");
  const selectedLabel = value
    ? (normalized.find((o) => o.value === value)?.label || value)
    : placeholder;

  const filtered = useMemo(() => {
    const q = _norm(query).trim();
    let list = normalized;
    if (q) list = list.filter((o) => _norm(o.label).includes(q) || _norm(o.value).includes(q));
    return list.slice(0, PICK_LIST_CAP);
  }, [normalized, query]);

  const items = useMemo(() => {
    const rows = filtered.map((o) => ({ ...o, clear: false }));
    if (value) rows.unshift({ value: "", label: resetLabel, clear: true });
    return rows;
  }, [filtered, value, resetLabel]);

  const q = query.trim();

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open) { setQuery(""); setActive(0); return; }
    requestAnimationFrame(() => {
      if (showSearch) searchRef.current && searchRef.current.focus();
      else menuRef.current && menuRef.current.focus();
    });
  }, [open, showSearch]);

  useEffect(() => { setActive(0); }, [query]);

  const close = () => setOpen(false);
  const pick = (val) => { onChange(val); close(); };

  const onListKey = (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (items.length ? (a + 1) % items.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (items.length ? (a - 1 + items.length) % items.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const row = items[active];
      if (row) pick(row.value);
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  };

  const toggle = () => {
    if (disabled) return;
    setOpen((o) => !o);
  };

  const clear = (e) => {
    e.stopPropagation();
    e.preventDefault();
    onChange("");
    close();
  };

  return (
    <div className={"tv-pick" + (value ? " is-active" : "") + (open ? " is-open" : "") + (disabled ? " is-disabled" : "")}
      ref={rootRef}>
      <div className="tv-pick-trigger">
        <button type="button" className="tv-pick-main" onClick={toggle} disabled={disabled}
          aria-expanded={open} aria-haspopup="listbox" aria-label={placeholder}>
          <span className={"tv-pick-label" + (value ? "" : " is-ph")}>{selectedLabel}</span>
          <span className="tv-pick-chev"><I.arrowDn s={13} /></span>
        </button>
        {value ? (
          <button type="button" className="tv-pick-clear" onClick={clear} title={`Clear ${placeholder.toLowerCase()}`}>
            <I.x s={11} />
          </button>
        ) : null}
      </div>
      {open && !disabled ? (
        <div className={"tv-pick-menu" + (showSearch ? "" : " is-compact")} ref={menuRef}
          tabIndex={-1} onKeyDown={onListKey} onMouseDown={(e) => e.preventDefault()}>
          {showSearch ? (
            <label className="tv-pick-search">
              <I.search s={14} />
              <input ref={searchRef} value={query} onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onListKey} placeholder={`Search ${placeholder.toLowerCase()}…`} />
            </label>
          ) : null}
          <div className="tv-pick-list" role="listbox">
            {items.map((o, i) => (
              <button key={o.clear ? "__all" : o.value} type="button"
                className={"tv-pick-opt" + (i === active ? " active" : "") + (o.value === value ? " picked" : "") + (o.clear ? " clear" : "")}
                onMouseEnter={() => setActive(i)} onClick={() => pick(o.value)}>
                <span className="tv-pick-opt-t">{o.label}</span>
                {o.value === value && !o.clear ? <span className="tv-pick-opt-ok"><I.check s={14} /></span> : null}
              </button>
            ))}
            {!items.length ? (
              <div className="tv-pick-empty">{q ? "No matches" : `No ${placeholder.toLowerCase()}s yet`}</div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* A creatable combo-box for the song editor's open-ended facets (orchestra,
 * singer). Unlike SearchableSelect, the text field *is* the value — whatever
 * the DJ types is kept verbatim — while the dropdown merely suggests values
 * already in the library, so existing names get reused (and stay spelled the
 * same) instead of being re-typed by hand. */
function CreatableCombo({ value, onChange, options, placeholder }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const rootRef = useRef(null);

  const q = _norm(value).trim();
  // Suggest values that match what's typed, minus an exact hit (no point
  // offering the value already in the field). Empty field lists everything.
  const filtered = useMemo(() => {
    let list = options || [];
    if (q) list = list.filter((o) => _norm(o).includes(q) && _norm(o) !== q);
    return list.slice(0, PICK_LIST_CAP);
  }, [options, q]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => { setActive(-1); }, [value]);

  const pick = (val) => { onChange(val); setActive(-1); setOpen(false); };

  // The editor's form-level handler saves on Enter and closes on Escape, so we
  // only swallow those keys while the dropdown is actively steering them
  // (choosing a suggestion / dismissing the list); otherwise they bubble up.
  const onKey = (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) { setOpen(true); return; }
      setActive((a) => (filtered.length ? Math.min(a + 1, filtered.length - 1) : -1));
    } else if (e.key === "ArrowUp") {
      if (!open) return;
      e.preventDefault();
      setActive((a) => Math.max(a - 1, -1));
    } else if (e.key === "Enter") {
      if (open && active >= 0 && filtered[active]) { e.preventDefault(); e.stopPropagation(); pick(filtered[active]); }
    } else if (e.key === "Escape") {
      if (open) { e.preventDefault(); e.stopPropagation(); setOpen(false); }
    }
  };

  return (
    <div className={"tv-combo" + (open ? " is-open" : "")} ref={rootRef}>
      <input value={value} placeholder={placeholder} autoComplete="off"
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)} onKeyDown={onKey} />
      {open && filtered.length ? (
        <div className="tv-pick-menu tv-combo-menu" onMouseDown={(e) => e.preventDefault()}>
          <div className="tv-pick-list" role="listbox">
            {filtered.map((o, i) => (
              <button key={o} type="button"
                className={"tv-pick-opt" + (i === active ? " active" : "")}
                onMouseEnter={() => setActive(i)} onClick={() => pick(o)}>
                <span className="tv-pick-opt-t">{o}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* Inline picker shown inside the bulk right-click menu for setting the
 * orchestra or singer on many songs at once. Lists the values already in the
 * library, lets the DJ type a brand-new one (custom entry), and offers a
 * "clear" row (Instrumental for singers, no orchestra otherwise). Mirrors the
 * "Set genre" chips, but as a searchable list since these facets are open-ended. */
function BulkValuePicker({ field, options, count, onPick, onBack }) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const searchRef = useRef(null);
  const isSinger = field === "singer";
  const noun = isSinger ? "singer" : "orchestra";

  useEffect(() => { requestAnimationFrame(() => searchRef.current && searchRef.current.focus()); }, []);
  useEffect(() => { setActive(0); }, [query]);

  const q = query.trim();
  const filtered = useMemo(() => {
    const n = _norm(q);
    let list = options || [];
    if (n) list = list.filter((o) => _norm(o).includes(n));
    return list.slice(0, PICK_LIST_CAP);
  }, [options, q]);

  // Clear row first, then a "use what I typed" row when the query isn't already
  // an exact existing value, then the matching library values.
  const rows = useMemo(() => {
    const r = [{ value: "", label: isSinger ? "Instrumental (no singer)" : "No orchestra", clear: true }];
    const exact = q && (options || []).some((o) => _norm(o) === _norm(q));
    if (q && !exact) r.push({ value: q, label: `Use “${q}”`, custom: true });
    for (const o of filtered) r.push({ value: o, label: o });
    return r;
  }, [filtered, q, options, isSinger]);

  const onKey = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => (rows.length ? (a + 1) % rows.length : 0)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => (rows.length ? (a - 1 + rows.length) % rows.length : 0)); }
    else if (e.key === "Enter") { e.preventDefault(); const row = rows[active]; if (row) onPick(row.value); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onBack(); }
  };

  return (
    <div className="tv-ctx-picker">
      <div className="tv-ctx-pickhead">
        <button className="tv-ctx-back" onClick={onBack} title="Back"><I.chev s={14} /></button>
        <span className="ttl">Set {noun}</span>
        <span className="ct">{count}</span>
      </div>
      <label className="tv-pick-search">
        <I.search s={14} />
        <input ref={searchRef} value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={onKey}
          placeholder={`Search or type a ${noun}…`} />
      </label>
      <div className="tv-pick-list" role="listbox">
        {rows.map((o, i) => (
          <button key={(o.clear ? "__clear" : o.custom ? "__custom" : "v:") + o.value} type="button"
            className={"tv-pick-opt" + (i === active ? " active" : "") + (o.clear ? " clear" : "")}
            onMouseEnter={() => setActive(i)} onClick={() => onPick(o.value)}>
            <span className="tv-pick-opt-t">{o.label}</span>
            {o.custom ? <span className="tv-pick-opt-ok"><I.plus s={13} /></span> : null}
          </button>
        ))}
        {filtered.length === 0 && !q ? (
          <div className="tv-pick-empty">No {noun}s yet — type one above.</div>
        ) : null}
      </div>
    </div>
  );
}

/* Search + filter toolbar for the library tree. */
function SongSearchBar({ filters, onChange, options, sort, setSort, searching, countLabel,
  showCollapse, collapseOpen, onCollapse, includeCortinas, onToggleCortinas }) {
  const inputRef = useRef(null);
  const set = (key, val) => onChange({ ...filters, [key]: val });
  const clearText = () => { set("text", ""); inputRef.current && inputRef.current.focus(); };
  const clearFilters = () => onChange({ ...filters, orq: "", singer: "", genre: "", year: "" });
  const hasFilters = !!(filters.orq || filters.singer || filters.genre || filters.year);
  const anyDropdown = hasFilters;
  const sorts = searching ? SORTS : SORTS.filter((s) => s.key !== "relevance");

  return (
    <div className="tv-searchbar">
      <label className="tp-search tv-search-input">
        <I.search s={15} />
        <input ref={inputRef} value={filters.text}
          onChange={(e) => set("text", e.target.value)}
          placeholder="Search title, orchestra, singer…" />
        {filters.text ? (
          <button type="button" className="tv-search-clear" onClick={clearText} title="Clear search">
            <I.x s={13} />
          </button>
        ) : null}
      </label>
      <div className="tv-search-toolbar">
        <div className="tv-search-filters">
          <SearchableSelect placeholder="Orchestra" allLabel="All orchestras" value={filters.orq}
            onChange={(v) => set("orq", v)} options={options.orchestras}
            disabled={anyDropdown && options.orchestras.length === 0} />
          <SearchableSelect placeholder="Singer" allLabel="All singers" value={filters.singer}
            onChange={(v) => set("singer", v)} options={options.singers}
            disabled={anyDropdown && options.singers.length === 0} />
          <SearchableSelect placeholder="Style" allLabel="All styles" value={filters.genre}
            onChange={(v) => set("genre", v)} options={options.genres}
            disabled={anyDropdown && options.genres.length === 0} />
          <SearchableSelect placeholder="Year" allLabel="All years" value={filters.year}
            onChange={(v) => set("year", v)} options={options.years}
            disabled={anyDropdown && options.years.length === 0} />
          {hasFilters ? (
            <button type="button" className="tv-search-reset" onClick={clearFilters}>Clear filters</button>
          ) : null}
        </div>
        <div className="tv-search-actions">
          {onToggleCortinas ? (
            <button type="button" className="tv-cortina-toggle" data-on={includeCortinas ? "1" : "0"}
              role="switch" aria-checked={!!includeCortinas} onClick={() => onToggleCortinas(!includeCortinas)}
              title={includeCortinas
                ? "Cortinas are shown in the filter lists"
                : "Cortinas are hidden from the filter lists"}>
              <I.curtain s={14} /> Include cortinas
            </button>
          ) : null}
          {showCollapse ? (
            <button type="button" className="tv-collapse" onClick={onCollapse}>
              <I.chev s={12} /> {collapseOpen ? "Collapse" : "Expand"}
            </button>
          ) : null}
          <label className="tv-sort">
            <select value={sort} onChange={(e) => setSort(e.target.value)} title="Sort songs" aria-label="Sort">
              {sorts.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </label>
          {countLabel ? <span className="tv-count">{countLabel}</span> : null}
        </div>
      </div>
    </div>
  );
}

// Fixed row heights (px), enforced in CSS on .tv-vwin children so the windowing
// arithmetic is exact. Rows are single-line, so heights never vary at runtime.
const INDENT = 18;
const ROW_H = { song: 60, folder: 40, root: 46, group: 46 };
function rowHeight(r) {
  if (r.kind === "song") return ROW_H.song;
  if (r.kind === "group") return ROW_H.group;
  return r.depth === 0 ? ROW_H.root : ROW_H.folder;
}
// True when a folder has songs and every one (across subfolders) is a cortina —
// drives both the right-click toggle label and the cortina marker on the row.
function folderAllCortina(node) {
  let any = false, all = true;
  const walk = (n) => {
    (n.songs || []).forEach((s) => { any = true; if (!s.isCortina) all = false; });
    (n.children || []).forEach(walk);
  };
  if (node) walk(node);
  return any && all;
}

// Small marker shown on cortina songs/folders so a DJ can spot floor-clearers
// at a glance — reuses the curtain icon from the Live tab.
function CortinaBadge() {
  return <span className="tv-cortina-badge" title="Cortina"><I.curtain s={15} /></span>;
}

function FolderRowFlat({ node, depth, isOpen, onToggle, onContext }) {
  const hasContent = (node.children && node.children.length > 0) || (node.songs && node.songs.length > 0);
  return (
    <div className={"tv-folder-row" + (isOpen ? " open" : "") + (depth === 0 ? " root" : "")}
      style={{ marginLeft: depth * INDENT }}
      onClick={() => hasContent && onToggle(node.path)}
      onContextMenu={(e) => onContext && onContext(e, node)}>
      <span className={"caret" + (hasContent ? (isOpen ? " open" : "") : " leaf")}><I.chev s={12} /></span>
      <span className="fic">{isOpen && hasContent ? <I.folderOpen s={15} /> : <I.folder s={15} />}</span>
      <span className="nm">{node.name}{folderAllCortina(node) && <CortinaBadge />}</span>
      <span className="ct">{countSongs(node)}</span>
    </div>
  );
}

/* ============================ LIBRARY BROWSER ============================
 * Shared folder-tree song browser for Library, Builder, and Live: search,
 * dropdown filters, sort, and a windowed list for large libraries. */
function LibraryBrowser({ filters, setFilters, query, preview, onFolderContext, onSongContext, editingId, onSongEdit, onCloseEdit, library, builderIds, onAdd, makeDrag, draggingId, hint, selectedIds, setSelectedIds, anchorRef, includeCortinas, onToggleCortinas }) {
  const { tree, songs } = useStore();
  const scrollRef = useRef(null);
  const [sort, setSort] = useState("title");
  // When the DJ has opted into "collapse folders by default", a fresh tree
  // starts with every folder closed; otherwise the top-level folders open.
  const collapseDefault = useCollapseFoldersByDefault();
  const [openSet, setOpenSet] = useState(() => collapseDefault ? new Set() : new Set(tree.map((n) => n.path)));
  const filterOptions = useMemo(() => buildFilterOptions(songs, filters, includeCortinas), [songs, filters, includeCortinas]);
  const setFiltersSafe = (next) => setFilters(sanitizeFilters(next, songs, includeCortinas));

  // Seed the open state once the tree has loaded (it arrives async). With
  // collapse-by-default on we leave it closed; otherwise open the top level.
  useEffect(() => {
    if (collapseDefault) return;
    if (tree.length) setOpenSet((s) => (s.size ? s : new Set(tree.map((n) => n.path))));
  }, [tree, collapseDefault]);

  // The views stay mounted as the DJ navigates, so flipping the setting won't
  // remount this browser — re-seed the open state the moment it changes (skip
  // the initial mount, already handled by the seeds above).
  const collapseInit = useRef(true);
  useEffect(() => {
    if (collapseInit.current) { collapseInit.current = false; return; }
    setOpenSet(collapseDefault ? new Set() : new Set(tree.map((n) => n.path)));
  }, [collapseDefault]);

  const searching = query.active;

  useEffect(() => {
    setSort((s) => {
      if (searching) return s === "title" ? "relevance" : s;
      return s === "relevance" ? "title" : s;
    });
  }, [searching]);

  const toggle = (key) => setOpenSet((s) => {
    const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n;
  });

  const model = useMemo(() => {
    const rows = [];
    const openable = [];
    const pruned = searchTree(tree, query);
    const cmp = songComparator(sort, searching);
    const walk = (nodes, depth) => {
      for (const node of nodes) {
        const kids = node.children || [];
        const list = node.songs || [];
        const hasContent = kids.length > 0 || list.length > 0;
        if (hasContent) openable.push(node.path);
        const isOpen = searching || openSet.has(node.path);
        rows.push({ kind: "folder", key: "f:" + node.path, node, depth, isOpen });
        if (isOpen && hasContent) {
          walk(kids, depth + 1);
          const ordered = cmp ? list.slice().sort(cmp) : list;
          for (const s of ordered) rows.push({ kind: "song", key: "s:" + s.id, song: s, depth: depth + 1 });
        }
      }
    };
    walk(pruned, 0);
    const songCount = pruned.reduce((a, n) => a + countSongs(n), 0);
    const folderCount = rows.reduce((a, r) => a + (r.kind === "folder" ? 1 : 0), 0);
    return { rows, songCount, groupCount: folderCount, openable, noun: "folders" };
  }, [tree, query, sort, openSet, searching]);

  const rows = model.rows;

  /* ---- multi-select (library only) ----
   * Selection is keyed by song id and lifted to LibraryTree so the right-click
   * menu can act on it. Range selection (shift) walks the songs in the order
   * they're shown here, so the anchor→target span matches what the eye sees. */
  const songOrder = useMemo(
    () => rows.filter((r) => r.kind === "song").map((r) => String(r.song.id)),
    [rows],
  );
  const onSongSelect = (song, e) => {
    if (!setSelectedIds) return;
    const id = String(song.id);
    const additive = e.metaKey || e.ctrlKey;
    if (e.shiftKey && anchorRef.current != null) {
      const a = songOrder.indexOf(String(anchorRef.current));
      const b = songOrder.indexOf(id);
      if (a !== -1 && b !== -1) {
        const [lo, hi] = a <= b ? [a, b] : [b, a];
        const span = songOrder.slice(lo, hi + 1);
        setSelectedIds((prev) => {
          const n = new Set(additive ? prev : []);
          span.forEach((x) => n.add(x));
          return n;
        });
        return;
      }
    }
    if (additive) {
      setSelectedIds((prev) => {
        const n = new Set(prev);
        n.has(id) ? n.delete(id) : n.add(id);
        return n;
      });
      anchorRef.current = id;
      return;
    }
    setSelectedIds(new Set([id]));
    anchorRef.current = id;
  };

  /* ---- virtualization: render only the rows in view ----
   * Rows are single-line and their heights are enforced by CSS (see ROW_H +
   * the .tv-vwin rules), so we can place them by arithmetic with no per-row
   * measurement — that keeps the math exact and avoids any layout feedback. */
  const [scrollTop, setScrollTop] = useState(0);
  const [vh, setVh] = useState(800);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => setScrollTop(el.scrollTop);
    const ro = new ResizeObserver(() => setVh(el.clientHeight));
    ro.observe(el);
    el.addEventListener("scroll", onScroll, { passive: true });
    setScrollTop(el.scrollTop); setVh(el.clientHeight);
    return () => { el.removeEventListener("scroll", onScroll); ro.disconnect(); };
  }, []);

  // Whenever the row set changes shape (mode / sort / query), jump back to top.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    setScrollTop(0);
  }, [sort, query]);

  const offsets = useMemo(() => {
    const arr = new Float64Array(rows.length + 1);
    for (let i = 0; i < rows.length; i++) arr[i + 1] = arr[i] + rowHeight(rows[i]);
    return arr;
  }, [rows]);
  const total = offsets[rows.length] || 0;

  const OVERSCAN = 8;
  let start = 0, end = rows.length;
  { let lo = 0, hi = rows.length; while (lo < hi) { const m = (lo + hi) >> 1; if (offsets[m + 1] <= scrollTop) lo = m + 1; else hi = m; } start = lo; }
  { let lo = start, hi = rows.length; const bottom = scrollTop + vh; while (lo < hi) { const m = (lo + hi) >> 1; if (offsets[m] < bottom) lo = m + 1; else hi = m; } end = lo; }
  start = Math.max(0, start - OVERSCAN);
  end = Math.min(rows.length, end + OVERSCAN);
  const slice = rows.slice(start, end);
  const offsetY = offsets[start] || 0;

  const anyOpen = model.openable.some((k) => openSet.has(k));
  const toggleAll = () => setOpenSet(anyOpen ? new Set() : new Set(model.openable));

  const countLabel = model.songCount === 0
    ? (searching ? "No matches" : "")
    : searching
      ? `${model.songCount} song${model.songCount === 1 ? "" : "s"}`
      : `${model.songCount} song${model.songCount === 1 ? "" : "s"} · ${model.groupCount} ${model.noun}`;

  const renderRow = (r) => {
    if (r.kind === "folder") {
      return <div className="tv-vrow" key={r.key}>
        <FolderRowFlat node={r.node} depth={r.depth} isOpen={r.isOpen} onToggle={toggle} onContext={onFolderContext} />
      </div>;
    }
    const s = r.song;
    return <div className="tv-vrow" key={r.key} style={{ marginLeft: r.depth * INDENT }}>
      <SongRow s={s} library={library}
        editing={library && editingId === s.id} onEdit={library ? onSongEdit : undefined} onCloseEdit={onCloseEdit}
        onContext={library ? onSongContext : undefined}
        onSelect={library ? onSongSelect : undefined}
        selected={library && selectedIds ? selectedIds.has(String(s.id)) : false}
        inBuilder={!library && builderIds && builderIds.has(s.id)}
        onAdd={() => onAdd && onAdd(s)}
        dragHandlers={!library && makeDrag ? makeDrag(s) : undefined}
        dragging={draggingId === s.id}
        isPreview={preview && preview.previewId === s.id} isPlaying={preview && preview.playing}
        onPreview={() => preview && preview.toggle(s)} previewViaMonitor={preview && preview.viaMonitor} />
    </div>;
  };

  return (
    <>
      <div className="tv-tree-head">
        <SongSearchBar filters={filters} onChange={setFiltersSafe} options={filterOptions}
          sort={sort} setSort={setSort} searching={searching} countLabel={countLabel}
          showCollapse={!searching && rows.length > 0} collapseOpen={anyOpen} onCollapse={toggleAll}
          includeCortinas={includeCortinas} onToggleCortinas={onToggleCortinas} />
        {hint && <div className="tv-songs-hint">{hint}</div>}
      </div>
      <div className="tv-treewrap">
        <div className="tv-tree-scroll" ref={scrollRef}>
          {rows.length === 0 ? (
            <div className="tp-empty">{searching ? "Nothing matches your search." : "No folders in your library yet."}</div>
          ) : (
            <div className="tv-vtotal" style={{ height: total }}>
              <div className="tv-vwin" style={{ transform: `translateY(${offsetY}px)` }}>
                {slice.map((r) => renderRow(r))}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function LibraryTree({ builderIds, onAdd, makeDrag, draggingId, preview, hint, library }) {
  const { tandas, songs } = useStore();
  const [filters, setFilters] = useState(EMPTY_SEARCH);
  // Cortinas are floor-clearers, not repertoire — by default their orchestras,
  // singers and years stay out of the filter dropdowns so they don't clutter a
  // DJ's browsing. Turning this on folds them back in. Cortina songs themselves
  // are always in the tree and always findable by text search, regardless.
  const [includeCortinas, setIncludeCortinas] = useState(false);
  // When cortinas are hidden again, retire any active filter that only a cortina
  // satisfied, so the tree doesn't sit on a now-invisible selection.
  useEffect(() => {
    setFilters((f) => sanitizeFilters(f, songs, includeCortinas));
  }, [includeCortinas, songs]);
  const debouncedText = useDebounced(filters.text, 150);
  const query = useMemo(() => buildSearchQuery({
    text: debouncedText,
    orq: filters.orq,
    singer: filters.singer,
    genre: filters.genre,
    year: filters.year,
  }), [debouncedText, filters.orq, filters.singer, filters.genre, filters.year]);
  const [menu, setMenu] = useState(null);   // right-click menu: { kind, node?/song?, ids?, x, y }
  const [bulkField, setBulkField] = useState(null); // bulk menu sub-picker: null | "orq" | "singer"
  const [editingId, setEditingId] = useState(null); // song whose editor is open
  // Multi-select for the library: a Set of (string) song ids, with an anchor
  // for shift-range selection. Lives here so the right-click menu can act on it.
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const anchorRef = useRef(null);
  const clearSelection = () => { setSelectedIds(new Set()); anchorRef.current = null; };
  const byId = useMemo(() => {
    const m = new Map();
    for (const s of songs || []) m.set(String(s.id), s);
    return m;
  }, [songs]);
  // Distinct orchestras/singers already in the library, for the bulk set-value
  // pickers (the DJ can also type a new one). INSTRUMENTAL isn't a real singer
  // name — it's the "no singer" state, offered as the picker's clear row.
  const bulkOpts = useMemo(() => buildFilterOptions(songs), [songs]);
  const { ask, modal } = useConfirm();

  // Clamp to the viewport so the menu never opens off the right/bottom edge.
  // The bulk song menu is taller (genre row + extra item), so it reserves more.
  const menuPos = (e, h = 180) => ({
    x: Math.min(e.clientX, window.innerWidth - 244),
    y: Math.min(e.clientY, window.innerHeight - h),
  });
  // Right-click a folder row to remove it from the library (files stay on disk).
  const closeMenu = () => { setMenu(null); setBulkField(null); };
  const openMenu = (e, node) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ kind: "folder", node, ...menuPos(e) });
  };
  // Right-click a song row: edit, flag as cortina, or remove it from the library.
  // If the row is part of a multi-selection, the menu acts on the whole set;
  // otherwise the selection collapses to just the clicked song (single mode).
  const openSongMenu = (e, song) => {
    e.preventDefault();
    e.stopPropagation();
    const id = String(song.id);
    let ids;
    if (selectedIds.has(id) && selectedIds.size > 1) {
      ids = [...selectedIds];
    } else {
      ids = [id];
      setSelectedIds(new Set([id]));
      anchorRef.current = id;
    }
    setMenu({ kind: "song", song, ids, ...menuPos(e, ids.length > 1 ? 380 : 180) });
  };
  // Closing the menu first, then confirming in the shared modal, keeps the flow
  // consistent with deleting tandas and playlists.
  const requestDelete = (node) => {
    const n = countSongs(node);
    // Removing these songs cascades into tandas: a tanda built entirely from
    // this folder is emptied and auto-deleted by the main process, while a
    // mixed tanda just loses these tracks. Warn about both up front so the DJ
    // isn't surprised to find a set gone or silently shortened.
    const delIds = new Set(collectSongIds(node).map(String));
    const affected = (tandas || []).filter((t) =>
      t.songs.some((s) => delIds.has(String(s.id))));
    const emptied = affected.filter((t) =>
      t.songs.every((s) => delIds.has(String(s.id))));
    const shrunk = affected.length - emptied.length;
    closeMenu();
    ask({
      title: "Remove this folder?",
      message: (
        <>
          <div>Remove {n} song{n === 1 ? "" : "s"} from your library? Your files stay on disk.</div>
          {affected.length > 0 && (
            <div className="tp-modal-note">
              <TandaImpact emptied={emptied} shrunk={shrunk} />
            </div>
          )}
        </>
      ),
      confirmLabel: "Remove folder",
      onConfirm: () => Store.deleteFolder(node),
    });
  };

  // Same cascade story as folders, scoped to one or more selected songs.
  const requestDeleteSongs = (ids, oneTitle) => {
    const list = (ids || []).map(String);
    const n = list.length;
    if (!n) return;
    const delIds = new Set(list);
    const affected = (tandas || []).filter((t) =>
      t.songs.some((s) => delIds.has(String(s.id))));
    const emptied = affected.filter((t) =>
      t.songs.every((s) => delIds.has(String(s.id))));
    const shrunk = affected.length - emptied.length;
    closeMenu();
    ask({
      title: n === 1 ? "Delete this song?" : `Delete ${n} songs?`,
      message: (
        <>
          <div>
            {n === 1 && oneTitle
              ? <>Remove “{oneTitle}” from your library? Your file stays on disk.</>
              : <>Remove {n} songs from your library? Your files stay on disk.</>}
          </div>
          {affected.length > 0 && (
            <div className="tp-modal-note">
              <TandaImpact emptied={emptied} shrunk={shrunk} />
            </div>
          )}
        </>
      ),
      confirmLabel: n === 1 ? "Delete song" : `Delete ${n} songs`,
      onConfirm: () => { Store.deleteSongs(list); clearSelection(); },
    });
  };

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

  // Escape clears the selection even when no menu is open.
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") setSelectedIds((s) => (s.size ? new Set() : s)); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const isFolder = menu && menu.kind === "folder";
  const menuCount = isFolder ? countSongs(menu.node) : 0;
  // Are the folder's songs already cortinas? Drives the toggle's label/action.
  const folderIsCortina = isFolder ? folderAllCortina(menu.node) : false;
  // Song menu: bulk when more than one row is selected.
  const songIds = menu && menu.kind === "song" ? menu.ids : [];
  const multi = songIds.length > 1;
  const selAllCortina = songIds.length > 0 && songIds.every((id) => byId.get(String(id))?.isCortina);
  const genreOpts = (window.STYLE_TYPES || ["tango", "vals", "milonga", "cortina"]).filter((g) => g !== "cortina");
  const genreLabel = window.genreLabel || ((g) => g);
  const ctxMenu = menu && (
    <div className="tv-ctx" style={{ top: menu.y, left: menu.x }}
      onMouseDown={(e) => e.stopPropagation()} onContextMenu={(e) => e.preventDefault()}>
      {menu.kind === "folder" ? (
        <>
          <div className="tv-ctx-head">
            <span className="fic"><I.folder s={14} /></span>
            <span className="nm" title={menu.node.name}>{menu.node.name}</span>
            <span className="ct">{menuCount} song{menuCount === 1 ? "" : "s"}</span>
          </div>
          <button className="tv-ctx-item" onClick={() => { const n = menu.node; closeMenu(); Store.setFolderCortina(n, !folderIsCortina); }}>
            <I.curtain s={15} /> {folderIsCortina ? "Unmark as cortinas" : "Mark folder as cortinas"}
          </button>
          <button className="tv-ctx-item del" onClick={() => requestDelete(menu.node)}>
            <I.trash s={15} /> Remove folder from library
          </button>
        </>
      ) : multi ? (
        bulkField ? (
          <BulkValuePicker
            field={bulkField}
            count={songIds.length}
            options={bulkField === "orq"
              ? bulkOpts.orchestras
              : bulkOpts.singers.filter((s) => s !== INSTRUMENTAL)}
            onBack={() => setBulkField(null)}
            onPick={(value) => {
              const ids = songIds, field = bulkField;
              closeMenu();
              Store.applySmartOrganize(ids.map((id) => ({ id, [field]: value })));
            }}
          />
        ) : (
        <>
          <div className="tv-ctx-head">
            <span className="fic"><I.note s={14} /></span>
            <span className="nm">{songIds.length} songs selected</span>
          </div>
          <div className="tv-ctx-label">Set genre</div>
          <div className="tv-ctx-genres">
            {genreOpts.map((g) => (
              <button key={g} className="tv-ctx-genre"
                onClick={() => { const ids = songIds; closeMenu(); Store.setSongGenres(ids.map((id) => ({ id, genre: g }))); }}>
                {genreLabel(g)}
              </button>
            ))}
          </div>
          <button className="tv-ctx-item" onClick={() => setBulkField("orq")}>
            <I.wave s={15} /> Set orchestra…
          </button>
          <button className="tv-ctx-item" onClick={() => setBulkField("singer")}>
            <I.note s={15} /> Set singer…
          </button>
          <button className="tv-ctx-item" onClick={() => { const ids = songIds; closeMenu(); Store.setSongCortina(ids, !selAllCortina); }}>
            <I.curtain s={15} /> {selAllCortina ? "Unmark as cortinas" : "Mark as cortinas"}
          </button>
          <button className="tv-ctx-item del" onClick={() => requestDeleteSongs(songIds)}>
            <I.trash s={15} /> Delete {songIds.length} songs
          </button>
        </>
        )
      ) : (
        <>
          <div className="tv-ctx-head">
            <span className="fic"><I.note s={14} /></span>
            <span className="nm" title={menu.song.title}>{menu.song.title}</span>
          </div>
          <button className="tv-ctx-item" onClick={() => { const id = menu.song.id; closeMenu(); setEditingId(id); }}>
            <I.pencil s={15} /> Edit song
          </button>
          <button className="tv-ctx-item" onClick={() => { const sg = menu.song; closeMenu(); Store.setSongCortina([sg.id], !sg.isCortina); }}>
            <I.curtain s={15} /> {menu.song.isCortina ? "Unmark as cortina" : "Flag as cortina"}
          </button>
          <button className="tv-ctx-item del" onClick={() => requestDeleteSongs([menu.song.id], menu.song.title)}>
            <I.trash s={15} /> Delete song
          </button>
        </>
      )}
    </div>
  );

  return (
    <div className="tv-tree">
      <LibraryBrowser filters={filters} setFilters={setFilters} query={query} preview={preview} onFolderContext={openMenu}
        onSongContext={openSongMenu} editingId={editingId} onSongEdit={(s) => setEditingId(s.id)} onCloseEdit={() => setEditingId(null)}
        library={library} builderIds={builderIds} onAdd={onAdd} makeDrag={makeDrag}
        draggingId={draggingId} hint={hint}
        selectedIds={library ? selectedIds : undefined} setSelectedIds={library ? setSelectedIds : undefined} anchorRef={anchorRef}
        includeCortinas={includeCortinas} onToggleCortinas={setIncludeCortinas} />
      {ctxMenu}
      {modal}
    </div>
  );
}

/* ============================ TANDA SEARCH ============================
 * Search saved tandas (and suggestions) by the same facets a DJ thinks in:
 *
 *   • Free text — fuzzy match across the tanda name, its orchestras/singers
 *     and every song title (reuses scoreText from the song search).
 *   • Dropdown filters — orquesta, singer, type and year, each drawn from the
 *     tandas on screen; every dropdown narrows to values that still match the
 *     others. Combined with free text (all must match).
 *
 * A tanda is multi-song, so a facet matches when *any* of its songs qualifies
 * (e.g. a Di Sarli tanda matches the "Di Sarli" orchestra filter). "Type" is
 * the DJ-assigned classification when present, falling back to the songs'
 * genres. */

const EMPTY_TANDA_SEARCH = { text: "", orq: "", singer: "", type: "", year: "", mood: "" };

// Orchestras the tanda draws on. Prefer the songs' own orq, but fall back to the
// tanda's "orquesta" tag for libraries not yet Smart-Organized — there the songs
// carry no artist metadata and the orchestra lives on the tanda (this is also
// what the cards display), so without it the orchestra filter would miss them.
function tandaOrqList(t) {
  const fromSongs = [...new Set((t.songs || []).map((s) => (s.orq || "").trim()).filter(Boolean))];
  if (fromSongs.length) return fromSongs;
  return [...new Set((t.tags || []).filter((g) => g.cat === "orquesta").map((g) => (g.label || "").trim()).filter(Boolean))];
}
function tandaSingerList(t) { return [...new Set((t.songs || []).map((s) => (s.singer || "").trim()).filter(Boolean))]; }
function tandaYearList(t) { return [...new Set((t.songs || []).map((s) => s.year).filter(Boolean).map(String))]; }
// Type values are lowercased so they line up with the song-genre vocabulary and
// render through genreLabel(); prefer the DJ's "type" tags, else infer from genre.
function tandaTypeList(t) {
  const tags = tandaTypes(t);
  if (tags.length) return tags;
  return [...new Set((t.songs || []).map((s) => (s.genre || "").toLowerCase()).filter(Boolean))];
}
// Mood is purely a DJ-assigned tag (Rhythmic / Lyrical / Dramatic …) — no
// song-level fallback, and kept in its original case for display.
function tandaMoodList(t) {
  return [...new Set((t.tags || []).filter((g) => g.cat === "mood").map((g) => (g.label || "").trim()).filter(Boolean))];
}

// Everything a bare search word is fuzzy-matched against for a tanda.
function tandaHaystack(t) {
  const m = tandaMeta(t);
  const parts = [t.name, m.orq, m.singer];
  for (const s of t.songs || []) parts.push(s.title, s.orq, s.singer);
  for (const tg of t.tags || []) parts.push(tg.label);
  return parts.map(_norm).filter(Boolean).join("  ");
}

// Does a tanda satisfy the active dropdown filters? `omit` drops one facet (used
// when building that facet's option list from the others' selections).
function tandaMatchesDropdownFilters(t, filters, omit) {
  if (omit !== "orq" && filters.orq && !tandaOrqList(t).includes(filters.orq)) return false;
  if (omit !== "singer" && filters.singer && !tandaSingerList(t).includes(filters.singer)) return false;
  if (omit !== "type" && filters.type && !tandaTypeList(t).includes(filters.type)) return false;
  if (omit !== "year" && filters.year && !tandaYearList(t).includes(String(filters.year))) return false;
  if (omit !== "mood" && filters.mood && !tandaMoodList(t).includes(filters.mood)) return false;
  return true;
}

// Unique orquesta / singer / type / year values for the tanda dropdowns, each
// scoped to tandas that match the other active filters.
function buildTandaFilterOptions(tandas, filters = EMPTY_TANDA_SEARCH) {
  const cmp = (a, b) => a.localeCompare(b, undefined, { sensitivity: "base" });
  const orqs = new Set(), singers = new Set(), types = new Set(), years = new Set(), moods = new Set();
  for (const t of tandas || []) {
    if (tandaMatchesDropdownFilters(t, filters, "orq")) tandaOrqList(t).forEach((o) => orqs.add(o));
    if (tandaMatchesDropdownFilters(t, filters, "singer")) tandaSingerList(t).forEach((s) => singers.add(s));
    if (tandaMatchesDropdownFilters(t, filters, "type")) tandaTypeList(t).forEach((v) => types.add(v));
    if (tandaMatchesDropdownFilters(t, filters, "year")) tandaYearList(t).forEach((y) => years.add(y));
    if (tandaMatchesDropdownFilters(t, filters, "mood")) tandaMoodList(t).forEach((mo) => moods.add(mo));
  }
  return {
    orchestras: [...orqs].sort(cmp),
    singers: [...singers].sort(cmp),
    types: [...types].sort((a, b) =>
      ((GENRE_ORDER[genreLabel(a)] ?? 99) - (GENRE_ORDER[genreLabel(b)] ?? 99)) || cmp(genreLabel(a), genreLabel(b)))
      .map((v) => ({ value: v, label: genreLabel(v) })),
    years: [...years].sort((a, b) => parseInt(b, 10) - parseInt(a, 10)),
    moods: [...moods].sort(cmp),
  };
}

function tandaSearchActive(filters) {
  return !!(_norm(filters.text || "").trim() || filters.orq || filters.singer || filters.type || filters.year || filters.mood);
}

// Alphabetical comparator for the tandas listing, keyed off the same label the
// cards show (the DJ's name, or the orchestra summary when still unnamed).
const byTandaLabel = (a, b) =>
  tandaLabel(a).localeCompare(tandaLabel(b), undefined, { sensitivity: "base", numeric: true });

// Filter + rank tandas. The listing is always sorted alphabetically by name;
// a text query overrides that to rank best match first.
function searchTandas(tandas, filters = EMPTY_TANDA_SEARCH) {
  const list = tandas || [];
  if (!tandaSearchActive(filters)) return list.slice().sort(byTandaLabel);
  const words = _norm(filters.text || "").trim().split(/\s+/).filter(Boolean);
  const hits = [];
  for (const t of list) {
    if (!tandaMatchesDropdownFilters(t, filters)) continue;
    let score = 0, ok = true;
    if (words.length) {
      const hay = tandaHaystack(t);
      for (const w of words) {
        const s = scoreText(w, hay);
        if (s < 0) { ok = false; break; }
        score += s;
      }
    }
    if (ok) hits.push({ t, score });
  }
  if (words.length) hits.sort((a, b) => b.score - a.score);
  else hits.sort((a, b) => byTandaLabel(a.t, b.t));
  return hits.map((h) => h.t);
}

// Drop dropdown values that no longer exist after another filter changed.
function sanitizeTandaFilters(filters, tandas) {
  let next = null, again = true;
  while (again) {
    again = false;
    const cur = next || filters;
    for (const [key, listKey, valOf] of [
      ["orq", "orchestras", (o) => o],
      ["singer", "singers", (o) => o],
      ["type", "types", (o) => o.value],
      ["year", "years", (o) => o],
      ["mood", "moods", (o) => o],
    ]) {
      if (!cur[key]) continue;
      const allowed = buildTandaFilterOptions(tandas, { ...cur, [key]: "" })[listKey].map(valOf);
      if (!allowed.includes(cur[key])) {
        if (!next) next = { ...filters };
        next[key] = "";
        again = true;
      }
    }
  }
  return next || filters;
}

/* Search + filter toolbar for the manage view's tanda grid/list. Mirrors the
 * library's SongSearchBar but over tanda facets (no sort — tandas keep DJ order). */
function TandaSearchBar({ filters, onChange, options, countLabel }) {
  const inputRef = useRef(null);
  const set = (key, val) => onChange({ ...filters, [key]: val });
  const clearText = () => { set("text", ""); inputRef.current && inputRef.current.focus(); };
  const clearFilters = () => onChange({ ...filters, orq: "", singer: "", type: "", year: "", mood: "" });
  const hasFilters = !!(filters.orq || filters.singer || filters.type || filters.year || filters.mood);
  return (
    <div className="tv-searchbar">
      <label className="tp-search tv-search-input">
        <I.search s={15} />
        <input ref={inputRef} value={filters.text}
          onChange={(e) => set("text", e.target.value)}
          placeholder="Search tandas by name, orchestra, singer…" />
        {filters.text ? (
          <button type="button" className="tv-search-clear" onClick={clearText} title="Clear search">
            <I.x s={13} />
          </button>
        ) : null}
      </label>
      <div className="tv-search-toolbar">
        <div className="tv-search-filters">
          <SearchableSelect placeholder="Orchestra" allLabel="All orchestras" value={filters.orq}
            onChange={(v) => set("orq", v)} options={options.orchestras}
            disabled={hasFilters && options.orchestras.length === 0} />
          <SearchableSelect placeholder="Singer" allLabel="All singers" value={filters.singer}
            onChange={(v) => set("singer", v)} options={options.singers}
            disabled={hasFilters && options.singers.length === 0} />
          <SearchableSelect placeholder="Type" allLabel="All types" value={filters.type}
            onChange={(v) => set("type", v)} options={options.types}
            disabled={hasFilters && options.types.length === 0} />
          <SearchableSelect placeholder="Year" allLabel="All years" value={filters.year}
            onChange={(v) => set("year", v)} options={options.years}
            disabled={hasFilters && options.years.length === 0} />
          <SearchableSelect placeholder="Mood" allLabel="All moods" value={filters.mood}
            onChange={(v) => set("mood", v)} options={options.moods}
            disabled={hasFilters && options.moods.length === 0} />
          {hasFilters ? (
            <button type="button" className="tv-search-reset" onClick={clearFilters}>Clear filters</button>
          ) : null}
        </div>
        <div className="tv-search-actions">
          {countLabel ? <span className="tv-count">{countLabel}</span> : null}
        </div>
      </div>
    </div>
  );
}

/* ============================ MANAGE GRID ============================ */
function TandaCard({ t, onEdit, onDelete, onPlay, preview, suggested, onSave, onDismiss }) {
  const m = tandaMeta(t);
  const songNameOnly = useSongNameOnly();
  const viaMonitor = preview && preview.viaMonitor;
  // Suggestions have no stored name, so generate a DJ-style one from their songs
  // (same helper the builder offers). The orquesta tag is the fallback orchestra
  // for libraries that haven't been Smart-Organized. Saved tandas keep their name.
  const orqTag = suggested ? (t.tags || []).find((g) => g.cat === "orquesta") : null;
  const displayName = suggested
    ? (suggestTandaName(t.songs, orqTag && orqTag.label) || (orqTag && orqTag.label) || m.orq)
    : (t.name || m.orq);
  const showSub = !suggested && (t.name || m.singer);
  return (
    <div className={"tv-tcard" + (suggested ? " suggested" : "")}>
      <div className="tv-tcard-top">
        <div className="tv-tcard-orq">
          {suggested && (
            <div className={"tv-suggest-pill" + (t.saved ? " is-saved" : "")}
              title={t.saved ? "Already in your tandas" : "Suggested from songs in your library — save it to keep, or dismiss it"}>
              {t.saved ? "Saved" : "Suggested"}
            </div>
          )}
          <div className="o">{displayName}</div>
          {showSub && (
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
              <span className="t">{songNameOnly ? cleanSongTitle(s) : s.title}</span>
              <span className="d">{s.dur}</span>
            </div>
          );
        })}
      </div>
      <div className="tv-tcard-foot">
        <div className="tv-tcard-total">{t.songs.length} songs · <b>{m.total}</b></div>
        {onPlay && (
          <button className="tv-tcbtn pl-play" onClick={(e) => { e.stopPropagation(); onPlay(t); }} disabled={!t.songs.length}
            title={viaMonitor ? "Pre-listen to full tanda in headphones" : "Play this tanda"}>
            {viaMonitor ? <I.headphones s={13} /> : <I.play s={13} />} Play tanda
          </button>
        )}
        {suggested ? (
          <>
            {t.saved ? (
              <span className="tv-tcbtn save is-saved" title="Already in your tandas"><I.check s={14} /> Saved</span>
            ) : (
              <button className="tv-tcbtn save" onClick={() => onSave(t)} title="Save this tanda to your collection"><I.check s={14} /> Save</button>
            )}
            <button className="tv-tcbtn del" onClick={() => onDismiss(t)} title="Dismiss this suggestion"><I.x s={15} /></button>
          </>
        ) : (
          <>
            <button className="tv-tcbtn" onClick={() => onEdit(t)}><I.pencil s={14} /> Edit</button>
            <button className="tv-tcbtn del" onClick={() => onDelete(t)} title="Delete tanda"><I.trash s={15} /></button>
          </>
        )}
      </div>
    </div>
  );
}

/* Full-width list row — an alternative to the grid card for when long song
 * titles (often with the orquesta/year prepended) get truncated in the narrow
 * columns. Here each song gets the full row width, so it reads in full. */
function TandaListItem({ t, onEdit, onDelete, onPlay, preview, suggested, onSave, onDismiss }) {
  const m = tandaMeta(t);
  const songNameOnly = useSongNameOnly();
  const viaMonitor = preview && preview.viaMonitor;
  const orqTag = suggested ? (t.tags || []).find((g) => g.cat === "orquesta") : null;
  const displayName = suggested
    ? (suggestTandaName(t.songs, orqTag && orqTag.label) || (orqTag && orqTag.label) || m.orq)
    : (t.name || m.orq);
  const sub = suggested ? null : [t.name ? m.orq : null, m.singer || null].filter(Boolean).join(" · ");
  return (
    <div className={"tv-litem" + (suggested ? " suggested" : "")}>
      <div className="tv-litem-head">
        <div className="tv-litem-id">
          {suggested && (
            <span className={"tv-suggest-pill" + (t.saved ? " is-saved" : "")}
              title={t.saved ? "Already in your tandas" : "Suggested from songs in your library — save it to keep, or dismiss it"}>
              {t.saved ? "Saved" : "Suggested"}
            </span>
          )}
          <div className="tv-litem-name">{displayName}</div>
          {sub && <div className="tv-litem-sub">{sub}</div>}
          {t.tags && t.tags.length > 0 && <TagPills tags={t.tags} />}
        </div>
        <div className="tv-litem-meta">{t.songs.length} {t.songs.length === 1 ? "song" : "songs"} · <b>{m.total}</b></div>
        <div className="tv-litem-actions">
          {onPlay && (
            <button className="tv-tcbtn pl-play" onClick={(e) => { e.stopPropagation(); onPlay(t); }} disabled={!t.songs.length}
              title={viaMonitor ? "Pre-listen to full tanda in headphones" : "Play this tanda"}>
              {viaMonitor ? <I.headphones s={13} /> : <I.play s={13} />} Play
            </button>
          )}
          {suggested ? (
            <>
              {t.saved ? (
                <span className="tv-tcbtn save is-saved" title="Already in your tandas"><I.check s={14} /> Saved</span>
              ) : (
                <button className="tv-tcbtn save" onClick={() => onSave(t)} title="Save this tanda to your collection"><I.check s={14} /> Save</button>
              )}
              <button className="tv-tcbtn del" onClick={() => onDismiss(t)} title="Dismiss this suggestion"><I.x s={15} /></button>
            </>
          ) : (
            <>
              <button className="tv-tcbtn" onClick={() => onEdit(t)}><I.pencil s={14} /> Edit</button>
              <button className="tv-tcbtn del" onClick={() => onDelete(t)} title="Delete tanda"><I.trash s={15} /></button>
            </>
          )}
        </div>
      </div>
      <div className="tv-litem-songs">
        {t.songs.map((s, i) => {
          const isPlaying = preview && preview.previewId === s.id && preview.playing;
          return (
            <div key={s.id + i} className={"tv-lsong" + (preview ? " is-clickable" : "") + (isPlaying ? " playing" : "")}
              onClick={preview ? () => preview.toggle(s) : undefined}
              title={previewTitle(preview, isPlaying)}>
              <span className="n"><PreviewGlyph preview={preview} playing={isPlaying} n={i + 1} s={11} /></span>
              <span className="t">{songNameOnly ? cleanSongTitle(s) : s.title}</span>
              <span className="d">{s.dur}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ManageGrid({ tab = "mine", tandas, suggestions, onEdit, onDelete, onNew, onPlay, onSaveSuggestion, onDismissSuggestion, onBrowseSuggestions, preview, view = "grid" }) {
  const suggs = suggestions || [];
  const list = view === "list";
  const wrapCls = list ? "tv-list" : "tv-grid";

  // Search state is kept per-tab so switching tabs starts fresh. The source is
  // whichever collection this tab shows; filtering runs over it client-side.
  const source = tab === "suggestions" ? suggs : tandas;
  const [filters, setFilters] = useState(EMPTY_TANDA_SEARCH);
  useEffect(() => { setFilters(EMPTY_TANDA_SEARCH); }, [tab]);
  const debouncedText = useDebounced(filters.text, 150);
  const dropFilters = [filters.orq, filters.singer, filters.type, filters.year, filters.mood];
  const options = useMemo(() => buildTandaFilterOptions(source, filters), [source, ...dropFilters]);
  const setFiltersSafe = (next) => setFilters(sanitizeTandaFilters(next, source));
  const activeFilters = useMemo(() => ({ ...filters, text: debouncedText }), [debouncedText, ...dropFilters]);
  const filtered = useMemo(() => searchTandas(source, activeFilters), [source, activeFilters]);
  const searching = tandaSearchActive(activeFilters);
  const countLabel = searching
    ? (filtered.length ? `${filtered.length} tanda${filtered.length === 1 ? "" : "s"}` : "No matches")
    : "";

  // Pinned, non-scrolling header (same class the library search uses) so the
  // search/filter bar stays on top while the grid scrolls beneath it.
  const searchBar = (
    <div className="tv-tree-head">
      <TandaSearchBar filters={filters} onChange={setFiltersSafe} options={options} countLabel={countLabel} />
    </div>
  );
  const noMatch = (
    <div className="tp-empty">No tandas match your search.</div>
  );

  // ---- Suggestions tab ----
  if (tab === "suggestions") {
    if (!suggs.length) {
      return (
        <div className="tv-manage">
          <div className="tv-empty-manage">
            <div className="ic"><I.spark s={26} /></div>
            <h3>No suggestions yet</h3>
            <p>We build these by matching classic tandas against your library. Import more music — or run Smart Organize so we can read your orchestras and years — and they'll show up here.</p>
          </div>
        </div>
      );
    }
    const Item = list ? TandaListItem : TandaCard;
    return (
      <>
        {searchBar}
        <div className="tv-manage">
          {filtered.length ? (
            <div className={wrapCls}>
              {filtered.map((t) => (
                <Item key={t.id} t={t} onPlay={onPlay} preview={preview}
                  suggested onSave={onSaveSuggestion} onDismiss={onDismissSuggestion} />
              ))}
            </div>
          ) : noMatch}
        </div>
      </>
    );
  }

  // ---- My tandas tab ----
  if (!tandas.length) {
    return (
      <div className="tv-manage">
        <div className="tv-empty-manage">
          <div className="ic"><I.scissor s={26} /></div>
          <h3>No tandas yet</h3>
          <p>Build your first tanda from the songs you imported{suggs.length ? ", or start from a suggestion" : ""}.</p>
          <div className="tv-empty-actions">
            <button className="tp-btn primary lg" onClick={onNew}><I.plus s={17} /> Build a tanda</button>
            {suggs.length > 0 && (
              <button className="tp-btn lg" onClick={onBrowseSuggestions}><I.spark s={16} /> Browse {suggs.length} suggestion{suggs.length === 1 ? "" : "s"}</button>
            )}
          </div>
        </div>
      </div>
    );
  }
  if (list) {
    return (
      <>
        {searchBar}
        <div className="tv-manage">
          {filtered.length ? (
            <div className="tv-list">
              {filtered.map((t) => <TandaListItem key={t.id} t={t} onEdit={onEdit} onDelete={onDelete} onPlay={onPlay} preview={preview} />)}
              {!searching && <button className="tv-newrow" onClick={onNew}><I.plus s={17} /> New tanda</button>}
            </div>
          ) : noMatch}
        </div>
      </>
    );
  }
  return (
    <>
      {searchBar}
      <div className="tv-manage">
        {filtered.length ? (
          <div className="tv-grid">
            {filtered.map((t) => <TandaCard key={t.id} t={t} onEdit={onEdit} onDelete={onDelete} onPlay={onPlay} preview={preview} />)}
            {!searching && (
              <button className="tv-newcard" onClick={onNew}>
                <span className="ic"><I.plus s={22} /></span>
                <span className="lb">New tanda</span>
              </button>
            )}
          </div>
        ) : noMatch}
      </div>
    </>
  );
}

Object.assign(window, {
  tandaMeta, tandaTypes, TandaLibCard, LibraryTree, ManageGrid,
  SongSearchBar, searchSongs, searchTree, buildSearchQuery, scoreSong, fuzzyScore, EMPTY_SEARCH,
  TandaSearchBar, searchTandas, buildTandaFilterOptions, EMPTY_TANDA_SEARCH,
});
