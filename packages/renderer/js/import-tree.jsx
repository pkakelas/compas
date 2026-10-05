// import-tree.jsx — the detailed import / re-type tool.
//
// Shows a folder tree and lets the DJ optionally set a style (Mixed / Tango /
// Vals / Milonga / Kizomba / … / custom) per folder, plus a separate "Cortina"
// flag (cortina is a usage flag, not a genre). Setting either cascades to all
// subfolders; any subfolder can override. On import, folders left unset default
// to Mixed — for libraries organized by orchestra rather than by style — and
// each song in them takes the style its own genre tag names, if any. Mixed set
// by the DJ is a choice like any other: it holds whatever the tags say.
// Used in two modes:
//   • "import": a freshly-scanned (not-yet-saved) folder → commit with a
//     per-folder style map.
//   • "retype": the existing library → update the styles of existing songs.
const { useState, useMemo, useEffect, useRef } = React;

/* ---------- build a retype tree from the live library songs ---------- */
function buildRetypeTree(songs) {
  const roots = new Map(); // root path -> node
  const rootLabel = (r) => { const p = (r || "").split(/[\\/]/).filter(Boolean); return p[p.length - 1] || r || tr("importTree.libraryFallback"); };
  const ensureRoot = (r) => {
    if (!roots.has(r)) roots.set(r, { key: r + "::", name: rootLabel(r), path: "", count: 0, genres: new Set(), songs: [], childMap: new Map(), children: [] });
    return roots.get(r);
  };
  for (const s of songs || []) {
    const root = ensureRoot(s.root);
    const segs = s.folderPath ? s.folderPath.split(" / ") : [];
    let node = root; node.count++; node.genres.add(s.genre);
    let acc = "";
    for (const seg of segs) {
      acc = acc ? acc + " / " + seg : seg;
      let child = node.childMap.get(seg);
      if (!child) {
        child = { key: s.root + "::" + acc, name: seg, path: acc, count: 0, genres: new Set(), songs: [], childMap: new Map(), children: [] };
        node.childMap.set(seg, child); node.children.push(child);
      }
      child.count++; child.genres.add(s.genre);
      node = child;
    }
    node.songs.push({ id: s.id, genre: s.genre, isCortina: !!s.isCortina }); // song lives in its leaf folder
  }
  // True only when the folder has songs and every one (incl. subfolders) is a
  // cortina — mirrors how the style guess shows a value only when it's uniform.
  const allCortina = (n) => {
    let any = false, all = true;
    const walk = (m) => {
      (m.songs || []).forEach((s) => { any = true; if (!s.isCortina) all = false; });
      (m.children || []).forEach(walk);
    };
    walk(n);
    return any && all;
  };
  // finalize: guess = the common current style (if uniform), sort children,
  // cortina = whether the folder is currently all-cortina.
  const finalize = (n) => {
    n.guess = n.genres.size === 1 ? [...n.genres][0] : null;
    n.cortina = allCortina(n);
    n.children.sort((a, b) => a.name.localeCompare(b.name));
    n.children.forEach(finalize);
  };
  const list = [...roots.values()];
  list.forEach(finalize);
  return list;
}

/* ---------- a small style picker popover ---------- */
function TypePicker({ resolved, explicit, onPick, onClear }) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState("");
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);
  const pick = (t) => { onPick(t); setOpen(false); setCustom(""); };
  return (
    <div className="it-pick" ref={ref}>
      {resolved ? (
        <button className={"it-pickbtn tp-tag " + genreClass(resolved) + (explicit ? " explicit" : " inherited")}
          onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
          title={explicit ? tr("importTree.pickerExplicitTitle") : tr("importTree.pickerInheritedTitle")}>
          {genreLabel(resolved)}{!explicit ? <span className="it-inh">{tr("importTree.inheritedBadge")}</span> : null}
          <I.chev s={11} />
        </button>
      ) : (
        <button className="it-pickbtn it-unset"
          onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
          title={tr("importTree.pickerUnsetTitle")}>
          {tr("importTree.setStyle")} <I.chev s={11} />
        </button>
      )}
      {open && (
        <div className="it-pop" onMouseDown={(e) => e.stopPropagation()}>
          <div className="it-pop-grid">
            {STYLE_TYPES.map((t) => (
              <button key={t} className={"tp-tag " + genreClass(t) + (resolved === t ? " on" : "")} onClick={() => pick(t)}>
                {genreLabel(t)}
              </button>
            ))}
          </div>
          <div className="it-pop-custom">
            <input value={custom} placeholder={tr("importTree.customStylePlaceholder")} onChange={(e) => setCustom(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && custom.trim()) pick(custom.trim().toLowerCase()); }} />
            <button disabled={!custom.trim()} onClick={() => custom.trim() && pick(custom.trim().toLowerCase())}>{tr("importTree.customStyleSet")}</button>
          </div>
          {explicit && <button className="it-pop-clear" onClick={() => { onClear(); setOpen(false); }}>{tr("importTree.clearInherit")}</button>}
        </div>
      )}
    </div>
  );
}

/* ---------- recursive tree row ---------- */
function TreeRow({ node, depth, openSet, toggle, resolvedMap, assignments, onPick, onClear,
                  showCortina, cortinaMap, onToggleCortina }) {
  const hasKids = node.children && node.children.length > 0;
  const isOpen = openSet.has(node.key);
  const r = resolvedMap.get(node.key) || {};
  const cr = (cortinaMap && cortinaMap.get(node.key)) || {};
  return (
    <div className="it-node">
      <div className="it-row" style={{ paddingLeft: 8 + depth * 18 }}>
        <button className={"it-caret" + (hasKids ? (isOpen ? " open" : "") : " leaf")} onClick={() => hasKids && toggle(node.key)}>
          <I.chev s={12} />
        </button>
        <span className="it-fic">{isOpen && hasKids ? <I.folderOpen s={15} /> : <I.folder s={15} />}</span>
        <span className="it-name" title={node.name}>{node.name || tr("importTree.rootName")}</span>
        <span className="it-count">{node.count}</span>
        {showCortina && (
          <button className={"it-cortbtn" + (cr.resolved ? " on" : "")}
            onClick={(e) => { e.stopPropagation(); onToggleCortina(node.key, !cr.resolved); }}
            title={cr.resolved
              ? (cr.explicit ? tr("importTree.cortinaUnflagTitle") : tr("importTree.cortinaUnflagInheritedTitle"))
              : tr("importTree.cortinaFlagTitle")}>
            <I.curtain s={13} /> {tr("importTree.cortinas")}
          </button>
        )}
        <TypePicker resolved={r.resolved} explicit={!!assignments[node.key]}
          onPick={(t) => onPick(node.key, t)} onClear={() => onClear(node.key)} />
      </div>
      {isOpen && hasKids && (
        <div className="it-kids">
          {node.children.map((c) => (
            <TreeRow key={c.key} node={c} depth={depth + 1} openSet={openSet} toggle={toggle}
              resolvedMap={resolvedMap} assignments={assignments} onPick={onPick} onClear={onClear}
              showCortina={showCortina} cortinaMap={cortinaMap} onToggleCortina={onToggleCortina} />
          ))}
        </div>
      )}
    </div>
  );
}

function ImportTreeModal({ mode, roots, onCancel, onConfirm }) {
  const [assignments, setAssignments] = useState({});      // node.key -> style
  const [cortinaAssign, setCortinaAssign] = useState({});  // node.key -> bool (explicit cortina flag)
  const [openSet, setOpenSet] = useState(() => {
    const s = new Set();
    const seed = (n, d) => { if (d < 2) s.add(n.key); (n.children || []).forEach((c) => seed(c, d + 1)); };
    (roots || []).forEach((r) => seed(r, 0));
    return s;
  });
  const [busy, setBusy] = useState(false);

  // Resolve every node top-down: explicit-on-self > inherited explicit ancestor
  // > the folder's own guess > import default (Mixed) / unset on re-type.
  // Guesses do NOT cascade (only explicit assignments do).
  const importDefault = mode === "import" ? (IMPORT_DEFAULT_STYLE || "mixed") : null;
  const resolvedMap = useMemo(() => {
    const map = new Map();
    const walk = (n, inherited) => {
      const explicit = assignments[n.key] || null;
      const resolved = explicit || inherited || n.guess || importDefault;
      map.set(n.key, { resolved, chosen: explicit || inherited || null, explicit: !!explicit, inherited: !explicit && !!(inherited || (resolved && resolved === n.guess) || (importDefault && resolved === importDefault)) });
      const childInherited = explicit || inherited; // guesses don't propagate
      (n.children || []).forEach((c) => walk(c, childInherited));
    };
    (roots || []).forEach((r) => walk(r, null));
    return map;
  }, [assignments, roots, importDefault]);

  // Cortina is a usage flag (separate from style), offered in both import and
  // re-type. Resolve it top-down like the style: an explicit toggle cascades to
  // subfolders; the per-folder guess (node.cortina — folder name on import, or
  // the folder's current state on re-type) only applies to its own folder.
  const showCortina = true;
  const cortinaMap = useMemo(() => {
    const map = new Map();
    const walk = (n, inherited) => {
      const hasExplicit = Object.prototype.hasOwnProperty.call(cortinaAssign, n.key);
      const explicit = hasExplicit ? cortinaAssign[n.key] : undefined;
      let resolved;
      if (explicit !== undefined) resolved = explicit;
      else if (inherited !== undefined) resolved = inherited;
      else resolved = !!n.cortina;
      map.set(n.key, { resolved, explicit: explicit !== undefined });
      const childInherited = explicit !== undefined ? explicit : inherited;
      (n.children || []).forEach((c) => walk(c, childInherited));
    };
    (roots || []).forEach((r) => walk(r, undefined));
    return map;
  }, [cortinaAssign, roots]);

  const toggle = (key) => setOpenSet((s) => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n; });
  const onPick = (key, t) => setAssignments((a) => ({ ...a, [key]: t }));
  const onClear = (key) => setAssignments((a) => { const n = { ...a }; delete n[key]; return n; });
  const onToggleCortina = (key, val) => setCortinaAssign((a) => ({ ...a, [key]: val }));

  // Stats + the payload for confirm.
  const { explicitFolders, changeCount, build } = useMemo(() => {
    let explicit = 0;
    const visit = (n, fn) => { fn(n); (n.children || []).forEach((c) => visit(c, fn)); };
    (roots || []).forEach((r) => visit(r, (n) => { if ((resolvedMap.get(n.key) || {}).explicit) explicit++; }));

    if (mode === "import") {
      const types = {};
      const cortinas = {};
      let typed = 0;
      (roots || []).forEach((r) => visit(r, (n) => {
        // Send a style only where the DJ chose one (here or on a parent) or
        // the folder's name gives one. A folder with neither is left out, so
        // its songs go by their own genre tag.
        const res = (resolvedMap.get(n.key) || {}).chosen || folderNameStyle(n);
        if (res) { types[n.path] = res; typed++; }
        // Send the resolved cortina flag for every folder so it overrides the
        // scanner's folder-name guess with exactly what the DJ sees.
        cortinas[n.path] = !!(cortinaMap.get(n.key) || {}).resolved;
      }));
      return { explicitFolders: explicit, changeCount: typed, build: () => ({ types, cortinas }) };
    }
    // retype: collect song genre changes (only where a style is resolved) plus
    // cortina-flag changes (songs whose flag differs from the resolved value).
    const updates = [];
    const cortinaOn = [];
    const cortinaOff = [];
    (roots || []).forEach((r) => visit(r, (n) => {
      const res = (resolvedMap.get(n.key) || {}).resolved;
      const wantCortina = !!(cortinaMap.get(n.key) || {}).resolved;
      for (const s of n.songs || []) {
        if (res && s.genre !== res) updates.push({ id: s.id, genre: res });
        if (!!s.isCortina !== wantCortina) (wantCortina ? cortinaOn : cortinaOff).push(s.id);
      }
    }));
    const changeCount = updates.length + cortinaOn.length + cortinaOff.length;
    return { explicitFolders: explicit, changeCount, build: () => ({ updates, cortinaOn, cortinaOff }) };
  }, [resolvedMap, cortinaMap, roots, mode]);

  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    try { await onConfirm(build()); } finally { setBusy(false); }
  };

  const isImport = mode === "import";
  return (
    <div className="so-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onCancel(); }}>
      <div className="so-modal it-modal" role="dialog" aria-modal="true" aria-label={tr("importTree.dialogLabel")}>
        <header className="so-head">
          <div className="so-head-l">
            <span className="so-head-ic"><I.folderOpen s={17} /></span>
            <div>
              <div className="so-head-title">{isImport ? tr("importTree.importHeading") : tr("importTree.retypeHeading")}</div>
              <div className="so-head-sub">{isImport
                ? tr("importTree.importSub")
                : tr("importTree.retypeSub")}</div>
            </div>
          </div>
          <button className="so-x" onClick={onCancel} disabled={busy} title={tr("importTree.close")}><I.x s={16} /></button>
        </header>

        <div className="so-body">
          <div className="it-hint">
            <span className="it-hint-ic"><I.folderOpen s={15} /></span>
            <div>{isImport
              ? trx("importTree.importHint", { b: (s) => <b>{s}</b> })
              : trx("importTree.retypeHint", { b: (s) => <b>{s}</b> })}</div>
          </div>
          <div className="so-scroll it-scroll">
            {(roots || []).map((r) => (
              <TreeRow key={r.key} node={r} depth={0} openSet={openSet} toggle={toggle}
                resolvedMap={resolvedMap} assignments={assignments} onPick={onPick} onClear={onClear}
                showCortina={showCortina} cortinaMap={cortinaMap} onToggleCortina={onToggleCortina} />
            ))}
          </div>
        </div>

        <footer className="so-foot">
          <div className="so-foot-note">
            {isImport
              ? (explicitFolders > 0
                  ? <><I.check s={13} /> {tr("importTree.footExplicitFolders", { count: explicitFolders })}</>
                  : <><I.check s={13} /> {tr("importTree.footNoExplicit")}</>)
              : <><I.check s={13} /> {tr("importTree.footRetype")}</>}
          </div>
          <div className="so-foot-actions">
            <button className="tp-btn" onClick={onCancel} disabled={busy}>{tr("common.cancel")}</button>
            <button className="tp-btn primary" onClick={confirm} disabled={busy || (!isImport && changeCount === 0)}>
              {busy ? (isImport ? tr("importTree.importing") : tr("importTree.applying"))
                    : isImport ? tr("importTree.import") : tr("importTree.applyChanges", { count: changeCount })}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

/* ---------- one shared import flow for every entry point ----------
 * Encapsulates: open the OS picker + scan (preview) → show the tree tool →
 * commit with the chosen per-folder styles. Used by the Library, the Tanda
 * builder/manager and the first-run screen so the import experience is
 * identical everywhere and lives in exactly one place. */
/* The style a folder's own name gives it on import. "Mixed" doesn't count: it
 * says nothing about any one song. */
function folderNameStyle(n) {
  return n.guess && n.guess !== "mixed" ? n.guess : null;
}

/* The choices the import review would submit untouched: every folder whose
 * name gives a style gets it (the rest go by each song's genre tag), and the
 * cortina flag cascades from a cortina-named folder to everything inside it. */
function defaultImportChoices(root) {
  const types = {};
  const cortinas = {};
  const walk = (n, parentCortina) => {
    const style = folderNameStyle(n);
    if (style) types[n.path] = style;
    const c = !!(n.cortina || parentCortina);
    cortinas[n.path] = c;
    (n.children || []).forEach((k) => walk(k, c));
  };
  walk(root, false);
  return { types, cortinas };
}

function useFolderImport(flash) {
  const [tree, setTree] = useState(null);
  const [scanning, setScanning] = useState(false);

  const say = (msg) => { if (flash) flash(msg); };

  // Second step for an import started from a playlist file: with its folders
  // now in the library, resolve the playlist itself. The confirmation modal is
  // rendered by the app shell (see PlaylistImportHost), so it survives this
  // screen going away.
  const continueWithPlaylist = (playlist) => {
    if (playlist) Store.beginPlaylistImport(playlist.path);
  };

  // `source` (optional): a dropped path skips the OS picker; "playlist" opens
  // the playlist picker instead of the folder picker.
  const begin = async (source) => {
    if (tree || scanning) return;
    setScanning(true);
    let node;
    try { node = await Store.previewImport(typeof source === "string" ? source : undefined); }
    catch (e) { setScanning(false); say(tr("importTree.importFailed")); return; }
    setScanning(false);
    if (!node) return;                                   // cancelled
    if (node.playlist && !node.count) {
      // No new folders to bring in: the songs are already in the library, or
      // the playlist came from another computer and its paths don't exist
      // here. Either way the playlist step still matches by filename and
      // title, and says so itself when nothing is found.
      Store.cancelImport();
      continueWithPlaylist(node.playlist);
      return;
    }
    if (!node.count) { say(tr("importTree.noAudioFound")); Store.cancelImport(); return; }
    if (node.playlist) {
      // Importing a playlist: skip the folder-types step. Its folders come in
      // with the same defaults the review would show (each folder's own style
      // guess, else Mixed; cortina folders flagged), and styles can be set
      // later from the Library. The DJ only sees the playlist confirmation.
      setScanning(true);
      const { types, cortinas } = defaultImportChoices(node);
      let lib = null;
      try { lib = await Store.commitImport(types, cortinas); } catch (_e) { lib = null; }
      setScanning(false);
      if (lib) continueWithPlaylist(node.playlist);
      else say(tr("importTree.importFailed"));
      return;
    }
    setTree(node);
  };
  const cancel = () => { setTree(null); Store.cancelImport(); };
  const confirm = async (payload) => {
    const { types, cortinas } = payload || {};
    const before = (Store.get().totalSongs) || 0;
    const playlist = tree && tree.playlist;
    setTree(null);
    const lib = await Store.commitImport(types, cortinas);
    if (lib && !playlist) {
      const added = (lib.totalSongs || 0) - before;
      say(added > 0
        ? tr("importTree.addedSongs", { count: added })
        : tr("importTree.alreadyInLibrary"));
    }
    if (lib && playlist) continueWithPlaylist(playlist);
  };

  const beginPlaylist = () => begin("playlist");

  const modal = tree
    ? <ImportTreeModal mode="import" roots={[tree]} onCancel={cancel} onConfirm={confirm} />
    : null;
  return { begin, beginPlaylist, scanning, modal };
}

/* Renders the pending playlist-import confirmation (Store.playlistImport)
 * wherever the app shell mounts it; `onDone` runs after a successful import
 * (the shell uses it to jump to the Playlists view). */
function PlaylistImportHost({ onDone }) {
  const { playlistImport } = useStore();
  if (!playlistImport) return null;
  const confirm = async (name) => {
    const saved = await Store.importPlaylistCommit(name);
    if (saved && onDone) onDone(saved);
  };
  return <PlImportModal preview={playlistImport} onConfirm={confirm} onCancel={() => Store.cancelPlaylistImport()} />;
}

window.ImportTreeModal = ImportTreeModal;
window.buildRetypeTree = buildRetypeTree;
window.useFolderImport = useFolderImport;
window.PlaylistImportHost = PlaylistImportHost;
