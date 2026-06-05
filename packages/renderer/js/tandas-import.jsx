// tandas-import.jsx — pick a folder → real scan (main process) → animated reveal
const { useState, useEffect, useRef } = React;

function ImportScreen() {
  const [phase, setPhase] = useState("drop");      // drop | picking | scanning
  const [hot, setHot] = useState(false);
  const [steps, setSteps] = useState([]);           // [{ name, count }]
  const [revealed, setRevealed] = useState(0);      // how many folders shown
  const [songCount, setSongCount] = useState(0);
  const [err, setErr] = useState(null);
  const timers = useRef([]);

  const clearTimers = () => { timers.current.forEach(clearTimeout); timers.current = []; };
  useEffect(() => clearTimers, []);

  const begin = async () => {
    if (phase === "picking" || phase === "scanning") return;
    setErr(null);
    setPhase("picking");
    let lib;
    try {
      lib = await window.compas.importLibrary();   // opens OS folder picker + scans
    } catch (e) {
      setErr("Import failed. Please try again.");
      setPhase("drop");
      return;
    }
    if (!lib) { setPhase("drop"); return; }          // cancelled
    if (!lib.songs || lib.songs.length === 0) {
      setErr("No audio files were found in that folder.");
      setPhase("drop");
      return;
    }

    // Build the reveal animation from the real folder tree. Each imported root
    // is its own top-level node; on a first import there's a single root, so
    // reveal its sub-folders to keep the per-orchestra reveal lively.
    const topNodes = lib.tree || [];
    const stepNodes = topNodes.length === 1 && topNodes[0].children && topNodes[0].children.length
      ? topNodes[0].children
      : topNodes;
    const realSteps = stepNodes.map((n) => ({ name: n.name, count: countSongs(n) }));
    setSteps(realSteps);
    setRevealed(0);
    setSongCount(0);
    setPhase("scanning");

    let acc = 0;
    realSteps.forEach((s, i) => {
      const at = 220 + i * 240;
      timers.current.push(setTimeout(() => {
        setRevealed(i + 1);
        const target = acc + s.count; const from = acc; acc = target;
        const span = 240; const t0 = performance.now();
        const tick = (now) => {
          const p = Math.min(1, (now - t0) / span);
          setSongCount(Math.round(from + (target - from) * p));
          if (p < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }, at));
    });
    // When the reveal finishes, commit to the store so the workspace appears.
    timers.current.push(setTimeout(() => { Store.loadAll(); }, 220 + realSteps.length * 240 + 650));
  };

  if (phase === "scanning") {
    const total = Math.max(1, steps.length);
    const pct = Math.round((revealed / total) * 100);
    return (
      <div className="tv-import">
        <div className="tv-scan">
          <div className="tv-scan-ic"><I.search s={26} /></div>
          <h2>Reading your library…</h2>
          <div className="tv-scan-count">
            <b>{songCount}</b> songs · <b>{revealed}</b> of {steps.length} folders
          </div>
          <div className="tv-scan-prog"><i style={{ width: pct + "%" }} /></div>
          <div className="tv-scan-list">
            {steps.slice(0, revealed).map((s) => (
              <div key={s.name} className="tv-scan-row" style={{ animationDelay: "0s" }}>
                <span className="fic"><I.folder s={16} /></span>
                <span className="nm">{s.name}</span>
                <span className="ct">{s.count} songs</span>
                <span className="dn"><I.check s={15} /></span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const picking = phase === "picking";
  return (
    <div className="tv-import">
      <div>
        <div className={"tv-drop" + (hot ? " hot" : "")}
          onClick={begin}
          onDragOver={(e) => { e.preventDefault(); setHot(true); }}
          onDragLeave={() => setHot(false)}
          onDrop={(e) => { e.preventDefault(); setHot(false); begin(); }}>
          <div className="tv-drop-ic"><I.folderOpen s={36} /></div>
          <h2>{picking ? "Choose a folder…" : "Choose your music folder"}</h2>
          <p>Compás reads it exactly as you’ve organised it — every orchestra, singer
            and era folder stays right where you put it. Nothing is moved or copied.</p>
          <button className="cta" disabled={picking} onClick={(e) => { e.stopPropagation(); begin(); }}>
            <I.upload s={17} /> {picking ? "Opening picker…" : "Choose a folder…"}
          </button>
          {err && <div className="note" style={{ color: "var(--accent)" }}>{err}</div>}
          {!err && <div className="note">A native folder picker will open</div>}
        </div>
        <div className="tv-assure">
          <div><I.check s={15} /> Nothing is moved, renamed or copied</div>
          <div><I.check s={15} /> Your folder tree is kept intact</div>
          <div><I.check s={15} /> Build tandas straight from it</div>
        </div>
      </div>
    </div>
  );
}

window.ImportScreen = ImportScreen;
