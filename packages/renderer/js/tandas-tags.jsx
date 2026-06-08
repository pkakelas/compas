// tandas-tags.jsx — tagging for tandas: preset groups (type / age / orquesta),
// free-form custom tags, an elegant combobox editor, display pills, and the
// little helpers the manage view uses to search/filter by tag.
const { useState, useEffect, useRef, useMemo } = React;

/* ---------- preset vocabulary ----------
 * Each group has a category (used for colour + grouping) and a list of common
 * choices. Anything the DJ types that isn't one of these becomes a 'custom' tag. */
const TAG_PRESETS = [
  { cat: "type", label: "Type", options: ["Tango", "Milonga", "Vals", "Cortina"] },
  { cat: "age", label: "Age", options: ["20s", "30s", "40s", "50s", "60s"] },
  {
    cat: "orquesta", label: "Orquesta",
    options: [
      "D'Arienzo", "Di Sarli", "Pugliese", "Troilo", "Tanturi", "Canaro",
      "Fresedo", "Caló", "Biagi", "Laurenz", "D'Agostino", "De Angelis",
      "Demare", "Donato", "Rodríguez"
    ],
  },
];

/* Human label for a category, used by the "add as…" create chips. */
const CAT_LABELS = { custom: "Custom" };
TAG_PRESETS.forEach((g) => { CAT_LABELS[g.cat] = g.label; });
function catLabel(cat) { return CAT_LABELS[cat] || "Custom"; }

/* Stable identity for a tag, used for de-dupe + filter selection. */
function tagKey(t) { return (t.cat || "custom") + "|" + (t.label || "").toLowerCase(); }

function tagsEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  const keys = new Set(a.map(tagKey));
  return b.every((t) => keys.has(tagKey(t)));
}

function normOrq(raw) {
  return (raw || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u2018\u2019`]/g, "'").toLowerCase()
    .replace(/^orquesta\s+(?!tipica)/, "")
    .replace(/\s*-?\s*topic\s*$/, "")
    .trim();
}

function orqMatchesPreset(core, preset) {
  const p = normOrq(preset);
  if (!core || !p) return false;
  if (core === p) return true;
  if (core.endsWith(" " + p)) return true;
  if (p.includes(" ") && core.includes(p)) return true;
  const toks = core.split(/\s+/);
  return toks[toks.length - 1] === p;
}

function matchOrquestaTag(raw) {
  const core = normOrq(raw);
  if (!core) return null;
  const group = TAG_PRESETS.find((g) => g.cat === "orquesta");
  if (!group) return null;
  for (const label of group.options) {
    if (orqMatchesPreset(core, label)) return { cat: "orquesta", label };
  }
  return null;
}

function yearToAgeTag(year) {
  if (!year || year < 1920) return null;
  const decade = Math.floor(year / 10) * 10;
  if (decade > 1960) return null;
  const label = String(decade).slice(-2) + "s";
  const age = TAG_PRESETS.find((g) => g.cat === "age");
  return age && age.options.includes(label) ? { cat: "age", label } : null;
}

/** Infer type / age / orquesta tags from a tanda's songs. */
function suggestTandaTags(songs) {
  const list = songs || [];
  if (!list.length) return [];

  const tags = [];
  const add = (t) => {
    if (!t || tags.some((x) => x.cat === t.cat && x.label === t.label)) return;
    tags.push(t);
  };

  // Only the four core styles map to a "type" tag (Tango / Vals / Milonga / Cortina).
  const genres = [...new Set(list.map((s) => s.genre).filter(Boolean))];
  if (genres.length === 1 && isCoreStyle(genres[0])) {
    add({ cat: "type", label: genreLabel(genres[0]) });
  }

  const orqs = [...new Set(list.map((s) => s.orq).filter(Boolean))];
  if (orqs.length === 1) add(matchOrquestaTag(orqs[0]));

  const years = list.map((s) => s.year).filter(Boolean);
  if (years.length) {
    const decades = [...new Set(years.map((y) => Math.floor(y / 10) * 10))];
    if (decades.length === 1) add(yearToAgeTag(years[0]));
    else add(yearToAgeTag(Math.min(...years)));
  }

  return tags;
}

/* Auto-fills tags when empty (or when still matching the last auto-set), and
 * offers a one-click apply when the DJ has edited them away from the suggestion. */
function TandaTagSuggest({ songs, tags, onApply, autoFill = true }) {
  const suggestion = useMemo(() => suggestTandaTags(songs), [songs]);
  const applyRef = useRef(onApply);
  applyRef.current = onApply;
  const lastAutoRef = useRef(null);

  useEffect(() => {
    if (!autoFill || !suggestion.length) return;
    if (tagsEqual(tags, suggestion)) { lastAutoRef.current = suggestion; return; }
    const empty = !tags.length;
    const unchanged = lastAutoRef.current && tagsEqual(tags, lastAutoRef.current);
    if (empty || unchanged) {
      applyRef.current(suggestion);
      lastAutoRef.current = suggestion;
    }
  }, [autoFill, suggestion, tags]);

  useEffect(() => {
    if (!tags.length) { lastAutoRef.current = null; return; }
    if (lastAutoRef.current && !tagsEqual(tags, lastAutoRef.current)) lastAutoRef.current = null;
  }, [tags]);

  if (!suggestion.length || tagsEqual(tags, suggestion)) return null;

  return (
    <div className="tv-name-suggest">
      <span className="tv-name-suggest-lbl">Suggested tags</span>
      <button type="button" className="tv-name-suggest-btn tv-tag-suggest-btn"
        onClick={() => { onApply(suggestion); lastAutoRef.current = suggestion; }}
        title="Use suggested tags">
        <TagPills tags={suggestion} />
      </button>
    </div>
  );
}

/* ============================ TAG FIELD (editor) ============================
 * A chips-in-a-box combobox: existing tags render as removable pills, the input
 * surfaces grouped preset suggestions as you type, and Enter either picks the
 * highlighted suggestion or creates a custom tag from whatever you've typed. */
function TagField({ tags, onChange }) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef(null);
  const inputRef = useRef(null);

  const has = (cat, label) =>
    tags.some((t) => t.cat === cat && t.label.toLowerCase() === label.toLowerCase());

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => { setActive(0); }, [text]);

  const q = text.trim().toLowerCase();

  // Visible preset groups (hide already-added + non-matching options).
  const groups = TAG_PRESETS.map((g) => ({
    cat: g.cat,
    label: g.label,
    items: g.options
      .filter((label) => !has(g.cat, label))
      .filter((label) => !q || label.toLowerCase().includes(q))
      .map((label) => ({ cat: g.cat, label })),
  })).filter((g) => g.items.length);

  const label = text.trim();
  const exactPreset = TAG_PRESETS.some((g) => g.options.some((o) => o.toLowerCase() === q));

  // When the typed text isn't an exact preset, let the DJ file it under any
  // category: Custom for a free-form label, or a preset category like Orquesta
  // for, say, an orchestra that isn't in our built-in list yet. Custom is first
  // so it stays the Enter default for free text.
  const createCats = q && !exactPreset
    ? [{ cat: "custom" }, ...TAG_PRESETS]
        .filter((g) => !has(g.cat, label))
        .map((g) => ({ cat: g.cat, label, create: true }))
    : [];

  // Flat, render-ordered list for keyboard navigation (presets, then creates).
  const flat = [];
  groups.forEach((g) => g.items.forEach((it) => flat.push(it)));
  createCats.forEach((it) => flat.push(it));
  const hasCreate = createCats.length > 0;

  const add = (tag) => {
    if (!tag || !tag.label) return;
    if (!has(tag.cat, tag.label)) onChange([...tags, { cat: tag.cat, label: tag.label }]);
    setText("");
    setActive(0);
    if (inputRef.current) inputRef.current.focus();
  };
  const removeAt = (i) => onChange(tags.filter((_, ix) => ix !== i));

  const onKeyDown = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((a) => (flat.length ? (a + 1) % flat.length : 0)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setOpen(true); setActive((a) => (flat.length ? (a - 1 + flat.length) % flat.length : 0)); }
    else if (e.key === "Enter") {
      e.preventDefault();
      const pick = flat[active] || (q ? { cat: "custom", label } : null);
      if (pick) add(pick);
    } else if (e.key === "Escape") { setOpen(false); }
    else if (e.key === "Backspace" && !text && tags.length) { removeAt(tags.length - 1); }
  };

  return (
    <div className="tv-tagfield" ref={rootRef}>
      <div className={"tv-tagfield-box" + (open ? " open" : "")}
        onClick={() => { setOpen(true); if (inputRef.current) inputRef.current.focus(); }}>
        <span className="tv-tagfield-ic"><I.tag s={14} /></span>
        {tags.map((t, i) => (
          <span key={tagKey(t) + i} className={"tv-tag cat-" + t.cat}>
            {t.label}
            <button className="x" title="Remove tag"
              onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); removeAt(i); }}>
              <I.x s={11} />
            </button>
          </span>
        ))}
        <input ref={inputRef} className="tv-tagfield-input" value={text}
          placeholder={tags.length ? "Add tag…" : "Add tags — type, age, orquesta, or your own…"}
          onChange={(e) => { setText(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown} />
      </div>

      {open && (groups.length > 0 || hasCreate) && (
        <div className="tv-tagmenu">
          {groups.map((g) => (
            <div key={g.cat} className="tv-tagmenu-group">
              <div className="tv-tagmenu-label">{g.label}</div>
              <div className="tv-tagmenu-opts">
                {g.items.map((it) => {
                  const idx = flat.indexOf(it);
                  return (
                    <button key={it.label} type="button"
                      className={"tv-tag cat-" + it.cat + " opt" + (active === idx ? " active" : "")}
                      onMouseEnter={() => setActive(idx)}
                      onMouseDown={(e) => { e.preventDefault(); add(it); }}>
                      {it.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          {createCats.length > 0 && (
            <div className="tv-tagmenu-group tv-tagmenu-creates">
              <div className="tv-tagmenu-label">Add “{label}” as</div>
              <div className="tv-tagmenu-opts">
                {createCats.map((it) => {
                  const idx = flat.indexOf(it);
                  return (
                    <button key={it.cat} type="button"
                      className={"tv-tag cat-" + it.cat + " opt create" + (active === idx ? " active" : "")}
                      onMouseEnter={() => setActive(idx)}
                      onMouseDown={(e) => { e.preventDefault(); add(it); }}>
                      <I.plus s={11} /> {catLabel(it.cat)}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ============================ TAG PILLS (display) ============================ */
function TagPills({ tags, onClick, activeKeys, max }) {
  if (!tags || !tags.length) return null;
  const shown = max ? tags.slice(0, max) : tags;
  const extra = max && tags.length > max ? tags.length - max : 0;
  return (
    <div className="tv-tagrow">
      {shown.map((t, i) => {
        const k = tagKey(t);
        const on = activeKeys && activeKeys.indexOf(k) !== -1;
        return (
          <span key={k + i}
            className={"tv-tag cat-" + t.cat + (onClick ? " clickable" : "") + (on ? " on" : "")}
            onClick={onClick ? (e) => { e.stopPropagation(); onClick(k, t); } : undefined}>
            {t.label}
          </span>
        );
      })}
      {extra > 0 && <span className="tv-tag cat-custom more">+{extra}</span>}
    </div>
  );
}

Object.assign(window, { TAG_PRESETS, tagKey, catLabel, TagField, TagPills, suggestTandaTags, TandaTagSuggest, tagsEqual });
