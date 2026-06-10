// smart-organize-view.jsx — the Smart Organize review wizard.
//
// A full-screen modal opened from the Library header. It previews the metadata
// changes the main process proposes (derived from each song's title/folder/tags
// and confirmed against the bundled canonical catalog), lets the DJ review and
// pick them by confidence tier, and applies the approved subset — Compás-only,
// so the audio files on disk are never modified.
const { useState, useEffect, useMemo, useRef } = React;

const SO_TIERS = [
  { id: "confirmed", title: "Verified matches", ic: "check", desc: "Matched to exact recordings in the tango catalogue — safe to apply.", preselected: true },
  { id: "suggested", title: "Likely fixes", ic: "spark", desc: "Worked out from song titles and folder names.", preselected: true },
  { id: "review", title: "Worth a quick check", ic: "search", desc: "Lower confidence — tick the ones that look right.", preselected: false },
];

function soStyleLabel(g) {
  return (window.GENRE_LABEL && window.GENRE_LABEL[g]) || (g ? g[0].toUpperCase() + g.slice(1) : "—");
}

const SO_FIELD_LABEL = { orq: "Orchestra", singer: "Singer", year: "Year", genre: "Style" };
const soIsEmpty = (v) => v == null || v === "";

// Format a present value for display (callers handle the empty case).
function soFmt(field, v) {
  if (field === "genre") return soStyleLabel(v);
  if (field === "year") return String(v);
  return v;
}

// Render one field change. Filling in something that was missing reads as an
// addition (just "Orchestra · D'Agostino" — no "—" or strikethrough); replacing
// an existing value shows the before → after diff. The proposed value is
// click-to-edit, so the DJ can correct a wrong guess before applying.
function SoDiff({ field, from, to, edited, onEdit }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState("");
  const label = SO_FIELD_LABEL[field];
  const adding = soIsEmpty(from);

  const begin = (ev) => {
    ev.stopPropagation();
    setVal(field === "genre" ? (to || "tango") : (to == null ? "" : String(to)));
    setEditing(true);
  };
  const commit = (raw) => {
    let v;
    if (field === "year") { const t = String(raw).trim(); v = t === "" ? null : Number(t); if (Number.isNaN(v)) v = null; }
    else if (field === "genre") { v = raw; }
    else { v = String(raw).trim(); }
    onEdit(v);
    setEditing(false);
  };

  if (editing) {
    return (
      <span className="so-diff is-editing">
        <span className="so-diff-k">{label}</span>
        {field === "genre" ? (
          <select className="so-edit-input" autoFocus value={val}
            onClick={(ev) => ev.stopPropagation()}
            onChange={(ev) => { setVal(ev.target.value); commit(ev.target.value); }}
            onBlur={() => setEditing(false)}>
            {(window.STYLE_TYPES || ["tango", "vals", "milonga"]).map((t) => (
              <option key={t} value={t}>{soStyleLabel(t)}</option>
            ))}
          </select>
        ) : (
          <input className="so-edit-input" autoFocus type={field === "year" ? "number" : "text"}
            value={val}
            placeholder={field === "singer" ? "Instrumental" : ""}
            onClick={(ev) => ev.stopPropagation()}
            onChange={(ev) => setVal(ev.target.value)}
            onKeyDown={(ev) => {
              if (ev.key === "Enter") { ev.preventDefault(); commit(val); }
              else if (ev.key === "Escape") { ev.preventDefault(); setEditing(false); }
            }}
            onBlur={() => commit(val)} />
        )}
      </span>
    );
  }

  const toDisplay = field === "singer" && soIsEmpty(to)
    ? <em className="so-inst">Instrumental</em>
    : soFmt(field, to);
  const editableTo = (
    <button type="button" className={"so-to so-to-edit" + (edited ? " is-edited" : "")}
      title="Click to edit" onClick={begin}>
      {toDisplay}<I.pencil s={11} />
    </button>
  );

  return (
    <span className={"so-diff" + (adding ? " is-add" : "") + (edited ? " is-edited" : "")}>
      <span className="so-diff-k">{label}</span>
      {!adding && <span className="so-from">{soFmt(field, from)}</span>}
      {!adding && <span className="so-arrow">→</span>}
      {editableTo}
    </span>
  );
}

function SoRow({ p, checked, onToggle, rowEdits, onFieldEdit }) {
  const e = rowEdits || {};
  return (
    // A div (not a <label>) so the inline field editors don't toggle the row.
    // Clicking anywhere outside the diffs still toggles selection.
    <div className={"so-row" + (checked ? " on" : "")} onClick={() => onToggle(p.id)}>
      <input type="checkbox" className="so-check" checked={checked}
        onChange={() => onToggle(p.id)} onClick={(ev) => ev.stopPropagation()} />
      <div className="so-row-main">
        <div className="so-row-top">
          <span className="so-row-title" title={p.title}>{p.title}</span>
          {p.source === "canonical" && (
            <span className="so-badge" title={"Verified against the catalogue" + (p.canonicalDate ? " · " + p.canonicalDate : "")}>
              <I.check s={10} /> Verified{p.canonicalDate ? " · " + p.canonicalDate : ""}
            </span>
          )}
          {p.folderPath && <span className="so-row-folder">{p.folderPath}</span>}
        </div>
        <div className="so-row-diffs" onClick={(ev) => ev.stopPropagation()}>
          {p.changes.map((f) => (
            <SoDiff key={f} field={f} from={p.current[f]} to={f in e ? e[f] : p.proposed[f]}
              edited={f in e} onEdit={(v) => onFieldEdit(p.id, f, v)} />
          ))}
        </div>
        {p.note && <div className="so-row-note"><I.tag s={11} /> {p.note}</div>}
      </div>
    </div>
  );
}

// Indeterminate-aware tier header checkbox.
function SoTierCheck({ all, some, onChange }) {
  const ref = useRef(null);
  useEffect(() => { if (ref.current) ref.current.indeterminate = !all && some; }, [all, some]);
  return <input ref={ref} type="checkbox" className="so-check" checked={all} onChange={onChange} />;
}

// Count how many songs in a list touch each field, for the at-a-glance digest.
function soFieldCounts(list) {
  const c = {};
  for (const p of list) for (const f of p.changes) c[f] = (c[f] || 0) + 1;
  return ["orq", "singer", "year", "genre"]
    .filter((f) => c[f])
    .map((f) => ({ field: f, label: SO_FIELD_LABEL[f].toLowerCase(), count: c[f] }));
}

function SoTier({ def, list, cap, onShowMore, selected, edits, onFieldEdit, onToggleTier, onToggleOne }) {
  if (!list.length) return null;
  const shown = list.slice(0, cap);
  const selCount = list.reduce((n, p) => n + (selected.has(p.id) ? 1 : 0), 0);
  const all = selCount === list.length;
  const some = selCount > 0;
  const fields = soFieldCounts(list);
  const Ic = I[def.ic];
  return (
    <section className="so-tier">
      {/* Sticky per-tab header strip: explains the tab + lets you (de)select all.
          Deliberately flat (not a card) so it never reads as another song row. */}
      <div className={"so-digest tier-" + def.id}>
        <span className="so-digest-ic"><Ic s={15} /></span>
        <div className="so-digest-body">
          <span className="so-digest-desc">{def.desc}</span>
          {fields.length > 0 && (
            <span className="so-digest-counts">
              {fields.map((f, i) => (
                <React.Fragment key={f.field}>
                  {i > 0 && <span className="so-digest-sep">·</span>}
                  <b>{f.count}</b> {f.label}{f.count === 1 ? "" : "s"}
                </React.Fragment>
              ))}
            </span>
          )}
        </div>
        <label className="so-digest-sel" title={all ? "Deselect all" : "Select all"}>
          <SoTierCheck all={all} some={some} onChange={() => onToggleTier(list)} />
          <span className="so-digest-selall">{all ? "Deselect all" : "Select all"}</span>
          <span className="so-digest-selcount">{selCount}/{list.length}</span>
        </label>
      </div>
      <div className="so-tier-rows">
        {shown.map((p) => (
          <SoRow key={p.id} p={p} checked={selected.has(p.id)} onToggle={onToggleOne}
            rowEdits={edits[p.id]} onFieldEdit={onFieldEdit} />
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
  const [tab, setTab] = useState("confirmed"); // active tier tab
  // After a tab is applied, holds { count, nextTab } until the DJ dismisses the
  // confirmation modal; null the rest of the time.
  const [applied, setApplied] = useState(null);
  // Per-row field overrides the DJ has typed in, keyed { [id]: { [field]: value } }.
  const [edits, setEdits] = useState({});

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
        // Open on the first tier that actually has proposals.
        setTab(SO_TIERS.map((t) => t.id).find((id) => props.some((p) => p.tier === id)) || "confirmed");
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

  // Apply now works one tab at a time, so the footer counts only the active tier.
  const tabSelectedCount = useMemo(
    () => proposals.reduce((n, p) => n + (p.tier === tab && selected.has(p.id) ? 1 : 0), 0),
    [proposals, selected, tab]
  );

  const toggleOne = (id) => setSelected((s) => {
    const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n;
  });
  // Editing a field overrides the proposed value and ticks the row (a correction
  // means "apply this, with my value") — handy in the "worth a check" tab.
  const onFieldEdit = (id, field, value) => {
    setEdits((e) => ({ ...e, [id]: { ...(e[id] || {}), [field]: value } }));
    setSelected((s) => (s.has(id) ? s : new Set(s).add(id)));
  };
  const toggleTier = (list) => setSelected((s) => {
    const n = new Set(s);
    const all = list.every((p) => n.has(p.id));
    list.forEach((p) => (all ? n.delete(p.id) : n.add(p.id)));
    return n;
  });

  // Apply only the selected songs in the active tab. On success, drop them from
  // the list and surface a confirmation modal that walks the DJ to the next tab.
  const apply = async () => {
    const changes = proposals
      .filter((p) => p.tier === tab && selected.has(p.id))
      .map((p) => {
        const c = { id: p.id };
        const e = edits[p.id] || {};
        for (const f of p.changes) c[f] = f in e ? e[f] : p.proposed[f];
        return c;
      });
    if (!changes.length) return;
    setPhase("applying");
    try {
      await Store.applySmartOrganize(changes);
      const ids = new Set(changes.map((c) => c.id));
      const remaining = proposals.filter((p) => !ids.has(p.id));
      setProposals(remaining);
      setSelected((s) => { const n = new Set(s); ids.forEach((id) => n.delete(id)); return n; });
      setAppliedCount((n) => n + changes.length);
      if (onApplied) onApplied(changes.length);
      // First later tab that still has anything to review, if any.
      const order = SO_TIERS.map((t) => t.id);
      const nextTab = order
        .slice(order.indexOf(tab) + 1)
        .find((id) => remaining.some((p) => p.tier === id)) || null;
      setApplied({ count: changes.length, nextTab });
      setPhase("review");
    } catch (e) {
      setPhase("error");
    }
  };

  // Dismiss the confirmation modal: advance to the next tab, or finish if this
  // was the last tier with changes.
  const dismissApplied = () => {
    const next = applied && applied.nextTab;
    setApplied(null);
    if (next) setTab(next);
    else setPhase("done");
  };

  const body = () => {
    if (phase === "scanning") {
      return (
        <div className="so-center">
          <div className="so-spinner" aria-hidden="true" />
          <h3>Reading your library…</h3>
          <p>Matching your songs against the tango catalogue to fill in orchestras, singers, years and styles. Nothing is changed yet.</p>
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
    const activeDef = SO_TIERS.find((t) => t.id === tab) || SO_TIERS[0];
    const activeList = groups[tab] || [];
    return (
      <>
        <div className="so-tabs" role="tablist">
          {SO_TIERS.map((def) => (
            <button
              key={def.id}
              role="tab"
              aria-selected={tab === def.id}
              className={"so-tab" + (tab === def.id ? " on" : "")}
              onClick={() => setTab(def.id)}
            >
              {def.title}
              <span className={"so-tab-count tier-" + def.id}>{groups[def.id].length}</span>
            </button>
          ))}
        </div>
        <div className="so-toolbar">
          <label className="so-search">
            <I.search s={15} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by title, orchestra, folder…" />
            {q && <button className="so-search-x" onClick={() => setQ("")} title="Clear"><I.x s={12} /></button>}
          </label>
        </div>
        <div className="so-scroll">
          {activeList.length === 0 ? (
            <div className="so-empty-filter">{q ? "Nothing matches your filter in this tab." : "Nothing here."}</div>
          ) : (
            <SoTier
              def={activeDef}
              list={activeList}
              cap={caps[tab]}
              onShowMore={() => setCaps((c) => ({ ...c, [tab]: c[tab] + SO_CAP_STEP }))}
              selected={selected}
              edits={edits}
              onFieldEdit={onFieldEdit}
              onToggleTier={toggleTier}
              onToggleOne={toggleOne}
            />
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
              <div className="so-head-sub">Fill in missing orchestras, singers, years &amp; styles</div>
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
              <button className="so-btn primary" onClick={apply} disabled={phase === "applying" || tabSelectedCount === 0}>
                {phase === "applying"
                  ? "Applying…"
                  : <>Apply {tabSelectedCount} change{tabSelectedCount === 1 ? "" : "s"}</>}
              </button>
            </div>
          </footer>
        )}

        {applied && (
          <div className="so-applied-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) dismissApplied(); }}>
            <div className="so-applied" role="dialog" aria-modal="true" aria-label="Changes applied">
              <div className="so-ic ok"><I.check s={22} /></div>
              <h3>Applied {applied.count} change{applied.count === 1 ? "" : "s"}</h3>
              <p>
                {applied.nextTab
                  ? <>Saved in Compás. Next up: <b>{(SO_TIERS.find((t) => t.id === applied.nextTab) || {}).title}</b>.</>
                  : "Saved in Compás. Your audio files on disk were not modified."}
              </p>
              <button className="so-btn primary" onClick={dismissApplied}>
                {applied.nextTab
                  ? <>Continue to {(SO_TIERS.find((t) => t.id === applied.nextTab) || {}).title}</>
                  : "Done"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

window.SmartOrganizeModal = SmartOrganizeModal;
