// import-tree.jsx — the detailed import / re-type tool.
//
// Shows a folder tree and lets the DJ optionally set a style (Mixed / Tango /
// Vals / Milonga / Cortina / Kizomba / … / custom) per folder. Setting a
// folder cascades to all its subfolders; any subfolder can override. On import,
// folders left unset default to Mixed — for libraries organized by orchestra
// rather than by style. Used in two modes:
//   • "import": a freshly-scanned (not-yet-saved) folder → commit with a
//     per-folder style map.
//   • "retype": the existing library → update the styles of existing songs.
const { useState, useMemo, useEffect, useRef } = React;

/* ---------- build a retype tree from the live library songs ---------- */
function buildRetypeTree(songs) {
  const roots = new Map(); // root path -> node
  const rootLabel = (r) => { const p = (r || "").split(/[\\/]/).filter(Boolean); return p[p.length - 1] || r || "Library"; };
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
    node.songs.push({ id: s.id, genre: s.genre }); // song lives in its leaf folder
  }
  // finalize: guess = the common current style (if uniform), sort children
  const finalize = (n) => {
    n.guess = n.genres.size === 1 ? [...n.genres][0] : null;
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
          title={explicit ? "Set on this folder — click to change" : "Inherited / guessed — click to set on this folder"}>
          {genreLabel(resolved)}{!explicit ? <span className="it-inh">·inherited</span> : null}
          <I.chev s={11} />
        </button>
      ) : (
        <button className="it-pickbtn it-unset"
          onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
          title="Choose a style for this folder">
          Set style <I.chev s={11} />
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
            <input value={custom} placeholder="Custom style…" onChange={(e) => setCustom(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && custom.trim()) pick(custom.trim().toLowerCase()); }} />
            <button disabled={!custom.trim()} onClick={() => custom.trim() && pick(custom.trim().toLowerCase())}>Set</button>
          </div>
          {explicit && <button className="it-pop-clear" onClick={() => { onClear(); setOpen(false); }}>Clear (inherit)</button>}
        </div>
      )}
    </div>
  );
}

/* ---------- recursive tree row ---------- */
function TreeRow({ node, depth, openSet, toggle, resolvedMap, assignments, onPick, onClear }) {
  const hasKids = node.children && node.children.length > 0;
  const isOpen = openSet.has(node.key);
  const r = resolvedMap.get(node.key) || {};
  return (
    <div className="it-node">
      <div className="it-row" style={{ paddingLeft: 8 + depth * 18 }}>
        <button className={"it-caret" + (hasKids ? (isOpen ? " open" : "") : " leaf")} onClick={() => hasKids && toggle(node.key)}>
          <I.chev s={12} />
        </button>
        <span className="it-fic">{isOpen && hasKids ? <I.folderOpen s={15} /> : <I.folder s={15} />}</span>
        <span className="it-name" title={node.name}>{node.name || "(root)"}</span>
        <span className="it-count">{node.count}</span>
        <TypePicker resolved={r.resolved} explicit={!!assignments[node.key]}
          onPick={(t) => onPick(node.key, t)} onClear={() => onClear(node.key)} />
      </div>
      {isOpen && hasKids && (
        <div className="it-kids">
          {node.children.map((c) => (
            <TreeRow key={c.key} node={c} depth={depth + 1} openSet={openSet} toggle={toggle}
              resolvedMap={resolvedMap} assignments={assignments} onPick={onPick} onClear={onClear} />
          ))}
        </div>
      )}
    </div>
  );
}

function ImportTreeModal({ mode, roots, onCancel, onConfirm }) {
  const [assignments, setAssignments] = useState({});      // node.key -> style
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
      map.set(n.key, { resolved, explicit: !!explicit, inherited: !explicit && !!(inherited || (resolved && resolved === n.guess) || (importDefault && resolved === importDefault)) });
      const childInherited = explicit || inherited; // guesses don't propagate
      (n.children || []).forEach((c) => walk(c, childInherited));
    };
    (roots || []).forEach((r) => walk(r, null));
    return map;
  }, [assignments, roots, importDefault]);

  const toggle = (key) => setOpenSet((s) => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n; });
  const onPick = (key, t) => setAssignments((a) => ({ ...a, [key]: t }));
  const onClear = (key) => setAssignments((a) => { const n = { ...a }; delete n[key]; return n; });

  // Stats + the payload for confirm.
  const { explicitFolders, changeCount, build } = useMemo(() => {
    let explicit = 0;
    const visit = (n, fn) => { fn(n); (n.children || []).forEach((c) => visit(c, fn)); };
    (roots || []).forEach((r) => visit(r, (n) => { if ((resolvedMap.get(n.key) || {}).explicit) explicit++; }));

    if (mode === "import") {
      const types = {};
      let typed = 0;
      (roots || []).forEach((r) => visit(r, (n) => {
        const res = (resolvedMap.get(n.key) || {}).resolved;
        if (res) { types[n.path] = res; typed++; }
      }));
      return { explicitFolders: explicit, changeCount: typed, build: () => types };
    }
    // retype: collect song genre changes (only where a style is resolved)
    const updates = [];
    (roots || []).forEach((r) => visit(r, (n) => {
      const res = (resolvedMap.get(n.key) || {}).resolved;
      if (!res) return;
      for (const s of n.songs || []) if (s.genre !== res) updates.push({ id: s.id, genre: res });
    }));
    return { explicitFolders: explicit, changeCount: updates.length, build: () => updates };
  }, [resolvedMap, roots, mode]);

  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    try { await onConfirm(build()); } finally { setBusy(false); }
  };

  const isImport = mode === "import";
  return (
    <div className="so-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onCancel(); }}>
      <div className="so-modal it-modal" role="dialog" aria-modal="true" aria-label="Set folder types">
        <header className="so-head">
          <div className="so-head-l">
            <span className="so-head-ic"><I.folderOpen s={17} /></span>
            <div>
              <div className="so-head-title">{isImport ? "Import — set folder types (optional)" : "Re-type folders"}</div>
              <div className="so-head-sub">{isImport
                ? "Orchestra folders with tangos, vals and milongas together can stay Mixed — set a style only where your library is sorted by type."
                : "Pick a style per folder. It applies to every folder below — override any subfolder."}</div>
            </div>
          </div>
          <button className="so-x" onClick={onCancel} disabled={busy} title="Close"><I.x s={16} /></button>
        </header>

        <div className="so-body">
          <div className="it-hint">
            <span className="it-hint-ic"><I.folderOpen s={15} /></span>
            <div>{isImport
              ? <>Set the genre for each folder so your library is easy to search later. Use <b>Set style</b> on any folder that holds a single genre — e.g. a <b>Vals</b> or <b>Milonga</b> folder — and it applies to everything inside it. Any folder you leave unset stays <b>Mixed</b>.</>
              : <>Pick a style for each folder using the <b>Set style</b> button on the right.
                It applies to every folder inside it — click a subfolder to give it a different style.</>}</div>
          </div>
          <div className="so-scroll it-scroll">
            {(roots || []).map((r) => (
              <TreeRow key={r.key} node={r} depth={0} openSet={openSet} toggle={toggle}
                resolvedMap={resolvedMap} assignments={assignments} onPick={onPick} onClear={onClear} />
            ))}
          </div>
        </div>

        <footer className="so-foot">
          <div className="so-foot-note">
            {isImport
              ? (explicitFolders > 0
                  ? <><I.check s={13} /> {explicitFolders} folder{explicitFolders === 1 ? "" : "s"} with an explicit style — the rest import as Mixed.</>
                  : <><I.check s={13} /> Everything imports as Mixed — set styles only if you want to.</>)
              : <><I.check s={13} /> Saved in Compás only — your files aren’t modified.</>}
          </div>
          <div className="so-foot-actions">
            <button className="so-btn ghost" onClick={onCancel} disabled={busy}>Cancel</button>
            <button className="so-btn primary" onClick={confirm} disabled={busy || (!isImport && changeCount === 0)}>
              {busy ? (isImport ? "Importing…" : "Applying…")
                    : isImport ? "Import" : `Apply ${changeCount} change${changeCount === 1 ? "" : "s"}`}
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
function useFolderImport(flash) {
  const [tree, setTree] = useState(null);
  const [scanning, setScanning] = useState(false);

  const begin = async () => {
    if (tree || scanning) return;
    setScanning(true);
    let node;
    try { node = await Store.previewImport(); }
    catch (e) { setScanning(false); if (flash) flash("Import failed. Please try again."); return; }
    setScanning(false);
    if (!node) return;                                   // cancelled
    if (!node.count) { if (flash) flash("No audio files were found in that folder."); Store.cancelImport(); return; }
    setTree(node);
  };
  const cancel = () => { setTree(null); Store.cancelImport(); };
  const confirm = async (types) => {
    const before = (Store.get().totalSongs) || 0;
    setTree(null);
    const lib = await Store.commitImport(types);
    if (lib && flash) {
      const added = (lib.totalSongs || 0) - before;
      flash(added > 0
        ? `Added ${added} song${added === 1 ? "" : "s"} from a new folder`
        : "That folder is already in your library");
    }
  };

  const modal = tree
    ? <ImportTreeModal mode="import" roots={[tree]} onCancel={cancel} onConfirm={confirm} />
    : null;
  return { begin, scanning, modal };
}

window.ImportTreeModal = ImportTreeModal;
window.buildRetypeTree = buildRetypeTree;
window.useFolderImport = useFolderImport;
