// smart-organize-view.jsx — the Smart Organize review wizard.
//
// A full-screen modal opened from the Library header. It previews the metadata
// changes the main process proposes (derived from each song's title/folder/tags
// and confirmed against the bundled canonical catalog), lets the DJ review and
// pick them by confidence tier, and applies the approved subset — Compás-only,
// so the audio files on disk are never modified.
const { useState, useEffect, useMemo, useRef } = React;

const SO_TIERS = [
  { id: "confirmed", title: "Confirmed by catalog", desc: "Matched a known recording — safe to apply." },
  { id: "suggested", title: "Suggested", desc: "Derived from titles & folders." },
  { id: "review", title: "Needs a look", desc: "Lower confidence or a folder/catalog disagreement." },
];

function soStyleLabel(g) {
  return (window.GENRE_LABEL && window.GENRE_LABEL[g]) || (g ? g[0].toUpperCase() + g.slice(1) : "—");
}

// Render one field's before → after.
function SoDiff({ field, from, to }) {
  const fmt = (v) => {
    if (field === "genre") return soStyleLabel(v);
    if (field === "year") return v == null || v === "" ? "—" : String(v);
    if (field === "singer") return v ? v : <em className="so-inst">Instrumental</em>;
    return v ? v : "—";
  };
  const label = { orq: "Orchestra", singer: "Singer", year: "Year", genre: "Style" }[field];
  return (
    <span className="so-diff">
      <span className="so-diff-k">{label}</span>
      <span className="so-from">{fmt(from)}</span>
      <span className="so-arrow">→</span>
      <span className="so-to">{fmt(to)}</span>
    </span>
  );
}

function SoRow({ p, checked, onToggle }) {
  return (
    <label className={"so-row" + (checked ? " on" : "")}>
      <input type="checkbox" className="so-check" checked={checked} onChange={() => onToggle(p.id)} />
      <div className="so-row-main">
        <div className="so-row-top">
          <span className="so-row-title" title={p.title}>{p.title}</span>
          {p.source === "canonical" && (
            <span className="so-badge" title={"Confirmed by catalog" + (p.canonicalDate ? " · " + p.canonicalDate : "")}>
              <I.check s={10} /> catalog{p.canonicalDate ? " · " + p.canonicalDate : ""}
            </span>
          )}
          {p.folderPath && <span className="so-row-folder">{p.folderPath}</span>}
        </div>
        <div className="so-row-diffs">
          {p.changes.map((f) => (
            <SoDiff key={f} field={f} from={p.current[f]} to={p.proposed[f]} />
          ))}
        </div>
        {p.note && <div className="so-row-note"><I.tag s={11} /> {p.note}</div>}
      </div>
    </label>
  );
}

// Indeterminate-aware tier header checkbox.
function SoTierCheck({ all, some, onChange }) {
  const ref = useRef(null);
  useEffect(() => { if (ref.current) ref.current.indeterminate = !all && some; }, [all, some]);
  return <input ref={ref} type="checkbox" className="so-check" checked={all} onChange={onChange} />;
}

function SoTier({ def, list, cap, onShowMore, selected, onToggleTier, onToggleOne }) {
  if (!list.length) return null;
  const shown = list.slice(0, cap);
  const selCount = list.reduce((n, p) => n + (selected.has(p.id) ? 1 : 0), 0);
  const all = selCount === list.length;
  const some = selCount > 0;
  return (
    <section className={"so-tier so-tier-" + def.id}>
      <header className="so-tier-head">
        <label className="so-tier-sel">
          <SoTierCheck all={all} some={some} onChange={() => onToggleTier(list)} />
          <span className="so-tier-title">{def.title}</span>
          <span className={"so-tier-count tier-" + def.id}>{list.length}</span>
        </label>
        <span className="so-tier-desc">{def.desc}</span>
      </header>
      <div className="so-tier-rows">
        {shown.map((p) => (
          <SoRow key={p.id} p={p} checked={selected.has(p.id)} onToggle={onToggleOne} />
        ))}
      </div>
      {list.length > cap && (
        <button className="so-more" onClick={onShowMore}>
          Show {Math.min(200, list.length - cap)} more <span className="so-more-rest">({list.length - cap} hidden)</span>
        </button>
      )}
    </section>
  );
}

const SO_CAP_STEP = 200;

function SmartOrganizeModal({ onClose, onApplied }) {
  const [phase, setPhase] = useState("scanning"); // scanning | review | empty | applying | done | error
  const [proposals, setProposals] = useState([]);
  const [summary, setSummary] = useState({ total: 0, confirmed: 0, suggested: 0, review: 0 });
  const [selected, setSelected] = useState(() => new Set());
  const [q, setQ] = useState("");
  const [caps, setCaps] = useState({ confirmed: SO_CAP_STEP, suggested: SO_CAP_STEP, review: SO_CAP_STEP });
  const [appliedCount, setAppliedCount] = useState(0);

  // Load the preview once on mount.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await Store.previewSmartOrganize();
        if (!alive) return;
        const props = (res && res.proposals) || [];
        // Pre-select everything except the "needs a look" tier.
        setSelected(new Set(props.filter((p) => p.tier !== "review").map((p) => p.id)));
        setProposals(props);
        setSummary((res && res.summary) || { total: 0, confirmed: 0, suggested: 0, review: 0 });
        setPhase(props.length ? "review" : "empty");
      } catch (e) {
        if (alive) setPhase("error");
      }
    })();
    return () => { alive = false; };
  }, []);

  // Esc closes (except mid-apply, so we never interrupt a write).
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape" && phase !== "applying") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [phase, onClose]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return proposals;
    return proposals.filter((p) =>
      (p.title + " " + p.current.orq + " " + p.proposed.orq + " " + p.proposed.singer + " " + p.folderPath)
        .toLowerCase().includes(needle));
  }, [q, proposals]);

  const groups = useMemo(() => ({
    confirmed: filtered.filter((p) => p.tier === "confirmed"),
    suggested: filtered.filter((p) => p.tier === "suggested"),
    review: filtered.filter((p) => p.tier === "review"),
  }), [filtered]);

  const selectedCount = useMemo(
    () => proposals.reduce((n, p) => n + (selected.has(p.id) ? 1 : 0), 0),
    [proposals, selected]
  );

  const toggleOne = (id) => setSelected((s) => {
    const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n;
  });
  const toggleTier = (list) => setSelected((s) => {
    const n = new Set(s);
    const all = list.every((p) => n.has(p.id));
    list.forEach((p) => (all ? n.delete(p.id) : n.add(p.id)));
    return n;
  });

  const apply = async () => {
    const changes = proposals.filter((p) => selected.has(p.id)).map((p) => {
      const c = { id: p.id };
      for (const f of p.changes) c[f] = p.proposed[f];
      return c;
    });
    if (!changes.length) return;
    setPhase("applying");
    try {
      await Store.applySmartOrganize(changes);
      setAppliedCount(changes.length);
      setPhase("done");
      if (onApplied) onApplied(changes.length);
    } catch (e) {
      setPhase("error");
    }
  };

  const body = () => {
    if (phase === "scanning") {
      return (
        <div className="so-center">
          <div className="so-spinner" aria-hidden="true" />
          <h3>Reading your library…</h3>
          <p>Deriving orchestra, singer, year and style from each song — and confirming against the tango catalog. Nothing is changed yet.</p>
        </div>
      );
    }
    if (phase === "error") {
      return (
        <div className="so-center">
          <div className="so-ic err"><I.x s={22} /></div>
          <h3>Something went wrong</h3>
          <p>Smart Organize couldn’t finish. Your library is unchanged.</p>
          <button className="so-btn primary" onClick={onClose}>Close</button>
        </div>
      );
    }
    if (phase === "empty") {
      return (
        <div className="so-center">
          <div className="so-ic ok"><I.check s={22} /></div>
          <h3>Everything looks tidy</h3>
          <p>We didn’t find any metadata worth changing. Your orchestras, singers, years and styles are already consistent.</p>
          <button className="so-btn primary" onClick={onClose}>Close</button>
        </div>
      );
    }
    if (phase === "done") {
      return (
        <div className="so-center">
          <div className="so-ic ok"><I.check s={22} /></div>
          <h3>Updated {appliedCount} song{appliedCount === 1 ? "" : "s"}</h3>
          <p>Changes are saved in Compás. Your audio files on disk were not modified.</p>
          <button className="so-btn primary" onClick={onClose}>Done</button>
        </div>
      );
    }
    // review / applying
    return (
      <>
        <div className="so-toolbar">
          <label className="so-search">
            <I.search s={15} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by title, orchestra, folder…" />
            {q && <button className="so-search-x" onClick={() => setQ("")} title="Clear"><I.x s={12} /></button>}
          </label>
          <div className="so-toolbar-r">{filtered.length} of {proposals.length} shown</div>
        </div>
        <div className="so-scroll">
          {filtered.length === 0 ? (
            <div className="so-empty-filter">Nothing matches your filter.</div>
          ) : (
            SO_TIERS.map((def) => (
              <SoTier
                key={def.id}
                def={def}
                list={groups[def.id]}
                cap={caps[def.id]}
                onShowMore={() => setCaps((c) => ({ ...c, [def.id]: c[def.id] + SO_CAP_STEP }))}
                selected={selected}
                onToggleTier={toggleTier}
                onToggleOne={toggleOne}
              />
            ))
          )}
        </div>
      </>
    );
  };

  const showFooter = phase === "review" || phase === "applying";

  return (
    <div className="so-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget && phase !== "applying") onClose(); }}>
      <div className="so-modal" role="dialog" aria-modal="true" aria-label="Smart Organize">
        <header className="so-head">
          <div className="so-head-l">
            <span className="so-head-ic"><I.spark s={17} /></span>
            <div>
              <div className="so-head-title">Smart Organize</div>
              <div className="so-head-sub">
                {phase === "review" || phase === "applying"
                  ? <>{summary.confirmed} confirmed · {summary.suggested} suggested · {summary.review} to review</>
                  : "Clean up orchestras, singers, years & styles"}
              </div>
            </div>
          </div>
          <button className="so-x" onClick={onClose} disabled={phase === "applying"} title="Close"><I.x s={16} /></button>
        </header>

        <div className="so-body">{body()}</div>

        {showFooter && (
          <footer className="so-foot">
            <div className="so-foot-note"><I.check s={13} /> Saved in Compás only — your files are never modified.</div>
            <div className="so-foot-actions">
              <button className="so-btn ghost" onClick={onClose} disabled={phase === "applying"}>Cancel</button>
              <button className="so-btn primary" onClick={apply} disabled={phase === "applying" || selectedCount === 0}>
                {phase === "applying"
                  ? "Applying…"
                  : <>Apply {selectedCount} change{selectedCount === 1 ? "" : "s"}</>}
              </button>
            </div>
          </footer>
        )}
      </div>
    </div>
  );
}

window.SmartOrganizeModal = SmartOrganizeModal;
