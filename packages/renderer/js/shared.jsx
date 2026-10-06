// shared.jsx — icons, waveform, genre tag, toast. Exports to window.
const { useMemo, useState, useRef, useCallback, useEffect } = React;

/* ---------- icons ----------
   Line icons share one stroke weight (1.7). The plus and check marks are a
   touch heavier (2 / 2.2) on purpose so they stay legible at small sizes. */
const I = {
  play:  (p) => <svg viewBox="0 0 24 24" width={p.s||20} height={p.s||20} fill="currentColor"><path d="M8 5.5v13l11-6.5z"/></svg>,
  pause: (p) => <svg viewBox="0 0 24 24" width={p.s||20} height={p.s||20} fill="currentColor"><rect x="7" y="5.5" width="3.4" height="13" rx="1"/><rect x="13.6" y="5.5" width="3.4" height="13" rx="1"/></svg>,
  prev:  (p) => <svg viewBox="0 0 24 24" width={p.s||18} height={p.s||18} fill="currentColor"><rect x="5" y="6.5" width="2.6" height="11" rx="1"/><path d="M19 6.5v11l-9-5.5z"/></svg>,
  next:  (p) => <svg viewBox="0 0 24 24" width={p.s||18} height={p.s||18} fill="currentColor"><path d="M5 6.5v11l9-5.5z"/><rect x="16.4" y="6.5" width="2.6" height="11" rx="1"/></svg>,
  fwd:   (p) => <svg viewBox="0 0 24 24" width={p.s||17} height={p.s||17} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M5 6.5v11l8-5.5zM14 6.5v11l8-5.5z"/></svg>,
  skip:  (p) => <svg viewBox="0 0 24 24" width={p.s||16} height={p.s||16} fill="currentColor"><path d="M6 5.5v13l9-6.5z"/><rect x="16.4" y="5.5" width="2.6" height="13" rx="1"/></svg>,
  scissor:(p)=> <svg viewBox="0 0 24 24" width={p.s||16} height={p.s||16} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="6" cy="7" r="2.4"/><circle cx="6" cy="17" r="2.4"/><path d="M8 8.5L20 17M8 15.5L20 7"/></svg>,
  spark: (p) => <svg viewBox="0 0 24 24" width={p.s||15} height={p.s||15} fill="currentColor"><path d="M12 2l1.6 5.4L19 9l-5.4 1.6L12 16l-1.6-5.4L5 9l5.4-1.6zM18.5 14l.8 2.7 2.7.8-2.7.8-.8 2.7-.8-2.7-2.7-.8 2.7-.8z"/></svg>,
  wave:  (p) => <svg viewBox="0 0 24 24" width={p.s||16} height={p.s||16} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M3 12h2l2-6 3 14 3-11 2 5h6"/></svg>,
  vol:   (p) => <svg viewBox="0 0 24 24" width={p.s||16} height={p.s||16} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M4 9v6h3l5 4V5L7 9zM16 9.5a3.5 3.5 0 010 5M18.5 7a7 7 0 010 10"/></svg>,
  volX:  (p) => <svg viewBox="0 0 24 24" width={p.s||16} height={p.s||16} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M4 9v6h3l5 4V5L7 9zM16 9.5l5 5M21 9.5l-5 5"/></svg>,
  sliders:(p)=> <svg viewBox="0 0 24 24" width={p.s||16} height={p.s||16} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M5 21v-7M5 10V3M12 21v-9M12 8V3M19 21v-5M19 12V3M2 14h6M9 8h6M16 16h6"/></svg>,
  curtain:(p)=> <svg viewBox="0 0 24 24" width={p.s||16} height={p.s||16} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M3 3h18M5 3v15c2 0 3-1.5 3-4V3M19 3v15c-2 0-3-1.5-3-4V3"/></svg>,
  plus:  (p) => <svg viewBox="0 0 24 24" width={p.s||16} height={p.s||16} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>,
  search:(p) => <svg viewBox="0 0 24 24" width={p.s||16} height={p.s||16} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/></svg>,
  x:     (p) => <svg viewBox="0 0 24 24" width={p.s||16} height={p.s||16} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>,
  grip:  (p) => <svg viewBox="0 0 24 24" width={p.s||16} height={p.s||16} fill="currentColor"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></svg>,
  check: (p) => <svg viewBox="0 0 24 24" width={p.s||16} height={p.s||16} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 6.5"/></svg>,
  clock: (p) => <svg viewBox="0 0 24 24" width={p.s||16} height={p.s||16} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>,
  folder:(p)=> <svg viewBox="0 0 24 24" width={p.s||16} height={p.s||16} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7.5a2 2 0 012-2h3.6a2 2 0 011.5.7l.9 1.1H19a2 2 0 012 2v7.2a2 2 0 01-2 2H5a2 2 0 01-2-2z"/></svg>,
  folderOpen:(p)=> <svg viewBox="0 0 24 24" width={p.s||16} height={p.s||16} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7.5a2 2 0 012-2h3.6a2 2 0 011.5.7l.9 1.1H19a2 2 0 012 2v1.2H6.4a2 2 0 00-1.9 1.4L3 17.5z"/><path d="M3 17.5l1.5-5.4a2 2 0 011.9-1.4H21l-1.8 5.5a2 2 0 01-1.9 1.3H5a2 2 0 01-2-2z"/></svg>,
  chev:  (p) => <svg viewBox="0 0 24 24" width={p.s||14} height={p.s||14} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6"/></svg>,
  note:  (p) => <svg viewBox="0 0 24 24" width={p.s||15} height={p.s||15} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18V6l11-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/></svg>,
  upload:(p)=> <svg viewBox="0 0 24 24" width={p.s||16} height={p.s||16} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M12 16V5M8 9l4-4 4 4"/><path d="M5 16v2a2 2 0 002 2h10a2 2 0 002-2v-2"/></svg>,
  download:(p)=> <svg viewBox="0 0 24 24" width={p.s||16} height={p.s||16} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M12 4v11M8 11l4 4 4-4"/><path d="M5 16v2a2 2 0 002 2h10a2 2 0 002-2v-2"/></svg>,
  trash: (p) => <svg viewBox="0 0 24 24" width={p.s||16} height={p.s||16} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7h16M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2M6 7l1 12a1 1 0 001 1h8a1 1 0 001-1l1-12"/></svg>,
  pencil:(p)=> <svg viewBox="0 0 24 24" width={p.s||16} height={p.s||16} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M14 5l5 5M4 20l1-4L16 5a1.5 1.5 0 012 0l1 1a1.5 1.5 0 010 2L8 19z"/></svg>,
  arrowDn:(p)=> <svg viewBox="0 0 24 24" width={p.s||16} height={p.s||16} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M6 13l6 6 6-6"/></svg>,
  drag:  (p) => <svg viewBox="0 0 24 24" width={p.s||15} height={p.s||15} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M8 6h8M8 12h8M8 18h8"/></svg>,
  tag:   (p) => <svg viewBox="0 0 24 24" width={p.s||16} height={p.s||16} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M12.6 3.6H20a1 1 0 011 1v7.4a2 2 0 01-.6 1.4l-6.4 6.4a2 2 0 01-2.8 0l-4.4-4.4a2 2 0 010-2.8l6.4-6.4a2 2 0 011.4-.6z"/><circle cx="16" cy="8" r="1.25" fill="currentColor" stroke="none"/></svg>,
  headphones:(p)=> <svg viewBox="0 0 24 24" width={p.s||16} height={p.s||16} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M4 13v-1a8 8 0 0116 0v1"/><path d="M4 14a2 2 0 012-2h1v6H6a2 2 0 01-2-2zM20 14a2 2 0 00-2-2h-1v6h1a2 2 0 002-2z"/></svg>,
  speaker:(p)=> <svg viewBox="0 0 24 24" width={p.s||16} height={p.s||16} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="6" y="2.5" width="12" height="19" rx="2.5"/><circle cx="12" cy="15" r="3.2"/><circle cx="12" cy="6.5" r="1"/></svg>,
  sun:   (p) => <svg viewBox="0 0 24 24" width={p.s||16} height={p.s||16} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8"/></svg>,
  moon:  (p) => <svg viewBox="0 0 24 24" width={p.s||16} height={p.s||16} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M20 14.5A8 8 0 119.5 4a6.5 6.5 0 1010.5 10.5z"/></svg>,
  grid:  (p) => <svg viewBox="0 0 24 24" width={p.s||16} height={p.s||16} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="4" width="7" height="7" rx="1.6"/><rect x="13" y="4" width="7" height="7" rx="1.6"/><rect x="4" y="13" width="7" height="7" rx="1.6"/><rect x="13" y="13" width="7" height="7" rx="1.6"/></svg>,
  rows:  (p) => <svg viewBox="0 0 24 24" width={p.s||16} height={p.s||16} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="5" width="16" height="5.5" rx="1.6"/><rect x="4" y="13.5" width="16" height="5.5" rx="1.6"/></svg>,
  scissors:(p)=> <svg viewBox="0 0 24 24" width={p.s||16} height={p.s||16} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="6" cy="6" r="2.6"/><circle cx="6" cy="18" r="2.6"/><path d="M20 4 8.5 15.5M14.5 14.5 20 20M8.5 8.5 12 12"/></svg>,
  eyeOff:(p)=> <svg viewBox="0 0 24 24" width={p.s||16} height={p.s||16} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M9.9 5.2A9.6 9.6 0 0112 5c5 0 9 4 10 7a13 13 0 01-2.2 3.3M6.3 6.3C3.9 7.6 2.5 9.6 2 12c1 3 5 7 10 7a9.7 9.7 0 004.2-.9"/><path d="M9.9 9.9a3 3 0 004.2 4.2"/><path d="M3 3l18 18"/></svg>,
  lock:  (p) => <svg viewBox="0 0 24 24" width={p.s||16} height={p.s||16} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="4.5" y="10.5" width="15" height="10" rx="2.2"/><path d="M8 10.5V7.5a4 4 0 018 0v3"/><circle cx="12" cy="15.5" r="1.2"/></svg>,
  unlock:(p)=> <svg viewBox="0 0 24 24" width={p.s||16} height={p.s||16} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="4.5" y="10.5" width="15" height="10" rx="2.2"/><path d="M8 10.5V7.5a4 4 0 017.6-1.8"/><circle cx="12" cy="15.5" r="1.2"/></svg>,
  heart: (p) => <svg viewBox="0 0 24 24" width={p.s||16} height={p.s||16} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20s-7-4.4-7-10a4 4 0 017-2.6A4 4 0 0119 10c0 5.6-7 10-7 10z"/></svg>,
  heartFill: (p) => <svg viewBox="0 0 24 24" width={p.s||16} height={p.s||16} fill="currentColor" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20s-7-4.4-7-10a4 4 0 017-2.6A4 4 0 0119 10c0 5.6-7 10-7 10z"/></svg>,
  chat:  (p) => <svg viewBox="0 0 24 24" width={p.s||16} height={p.s||16} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M5 6.5a2 2 0 012-2h10a2 2 0 012 2v7a2 2 0 01-2 2h-5l-4 3.5v-3.5H7a2 2 0 01-2-2z"/></svg>,
  bookmark: (p) => <svg viewBox="0 0 24 24" width={p.s||16} height={p.s||16} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M7 4.5h10a1 1 0 011 1V20l-6-4-6 4V5.5a1 1 0 011-1z"/></svg>,
  bookmarkFill: (p) => <svg viewBox="0 0 24 24" width={p.s||16} height={p.s||16} fill="currentColor" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M7 4.5h10a1 1 0 011 1V20l-6-4-6 4V5.5a1 1 0 011-1z"/></svg>,
  dots:  (p) => <svg viewBox="0 0 24 24" width={p.s||16} height={p.s||16} fill="currentColor"><circle cx="6" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="18" cy="12" r="1.7"/></svg>,
  send:  (p) => <svg viewBox="0 0 24 24" width={p.s||16} height={p.s||16} fill="currentColor"><path d="M4 4.5l17 7.5-17 7.5 2.5-7.5z"/></svg>,
  home:  (p) => <svg viewBox="0 0 24 24" width={p.s||16} height={p.s||16} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M4 11l8-6.5L20 11v8a1 1 0 01-1 1h-4.5v-5.5h-5V20H5a1 1 0 01-1-1z"/></svg>,
  refresh: (p) => <svg viewBox="0 0 24 24" width={p.s||16} height={p.s||16} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M20 11a8 8 0 10-2.3 6.3"/><path d="M20 5v6h-6"/></svg>,
  bell:  (p) => <svg viewBox="0 0 24 24" width={p.s||16} height={p.s||16} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M6 16V11a6 6 0 0112 0v5l1.5 2h-15z"/><path d="M10 20.5a2.2 2.2 0 004 0"/></svg>,
};

/* deterministic pseudo-random so waveforms are stable across renders/exports */
function seeded(seed) { let s = seed; return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }; }

function Waveform({ progress = 0.45, bars = 138, seed = 7, height = 92, className = "" }) {
  const hs = useMemo(() => {
    const r = seeded(seed); const out = [];
    for (let i = 0; i < bars; i++) {
      // envelope: tango dynamics — swells and quiet passages
      const env = 0.42 + 0.4 * Math.sin(i / bars * Math.PI * 3.2 + 0.6) + 0.22 * Math.sin(i / bars * Math.PI * 11);
      const v = Math.max(0.12, Math.min(1, env * (0.6 + 0.7 * r())));
      out.push(v);
    }
    return out;
  }, [bars, seed]);
  const headIx = Math.round(progress * bars);
  return (
    <div className={"tp-wave " + className} style={{ height }}>
      {hs.map((h, i) => (
        <i key={i}
          className={i < headIx ? (i >= headIx - 2 ? "head" : "played") : ""}
          style={{ height: Math.round(h * height) + "%" }} />
      ))}
    </div>
  );
}

/* small inline song-progress equalizer marker */
function EQ() { return <span className="tp-eq"><i></i><i></i><i></i></span>; }

/* Single-line label that scrolls its text horizontally when it's too wide to
   fit — for long song/cortina titles in the live transport. When the text fits
   it sits still and truncates exactly like a normal label, so short titles look
   untouched. Re-measures whenever the text or the container width changes. */
function Marquee({ text, className = "" }) {
  const wrapRef = useRef(null);
  const innerRef = useRef(null);
  const [overflow, setOverflow] = useState(0); // px the text exceeds the wrap by; 0 = fits

  useEffect(() => {
    const wrap = wrapRef.current, inner = innerRef.current;
    if (!wrap || !inner) return;
    const measure = () => {
      const over = Math.max(0, inner.scrollWidth - wrap.clientWidth);
      // round to avoid sub-pixel jitter re-triggering the animation
      setOverflow(over > 1 ? Math.round(over) : 0);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [text]);

  // Ping-pong: scrolls to the end and back. Duration grows with the distance so
  // the speed stays roughly constant, and the keyframes hold at each end so both
  // the start and the end of the title can be read before it moves on.
  const dur = overflow ? Math.max(7, (overflow / 24) + 5) : 0;
  return (
    <div ref={wrapRef} className={"tp-marquee " + (overflow ? "is-rolling " : "") + className}>
      <span ref={innerRef} className="tp-marquee-inner" style={overflow ? {
        "--marquee-shift": "-" + overflow + "px",
        animationDuration: dur + "s",
      } : null}>{text}</span>
    </div>
  );
}

/* The leading glyph for any clickable "listen / audition" row — used by the live
   queue's tanda search, the tanda cards, the builder bench and the playlist
   editor so they all speak the same language. While this row is the active
   preview it shows the equalizer; otherwise it shows a play icon, or the
   headphone glyph when previews are routed to the monitor (cue) output. Pass `n`
   to prefix the track number (rows that have their own glyph can omit it). */
function PreviewGlyph({ preview, playing, n, s = 12 }) {
  if (playing) return <EQ />;
  // Monitor (cue) routing gets the one shared affordance: a blue circular
  // headphone badge, always visible, identical to the library's listen button —
  // never a second, smaller glyph. Floor previews keep the number↔play hover swap.
  if (preview && preview.viaMonitor) {
    return <span className="tp-cuebadge"><I.headphones s={14} /></span>;
  }
  return (
    <React.Fragment>
      {n != null && <span className="qn">{n}</span>}
      <I.play s={s} />
    </React.Fragment>
  );
}

/* The matching tooltip: "Pause" while playing, "Listen in headphones (monitor)"
   when previews route to the cue output, otherwise the caller's verb. Returns
   undefined when there's no preview affordance so the title attribute is dropped. */
function previewTitle(preview, playing, verb = "Listen") {
  if (!preview) return undefined;
  if (playing) return "Pause";
  return preview.viaMonitor ? "Pre-listen in headphones" : verb;
}

/* Keyboard parity for a clickable non-<button> element (a song row, a toggle
   row…): spreads role="button", a tab stop, and Enter/Space activation so
   keyboard users get the same affordance as a mouse click. Spread onto the
   element alongside its onClick: {...clickKeys(handler)}. */
function clickKeys(handler) {
  return {
    role: "button",
    tabIndex: 0,
    onKeyDown: (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handler(e); }
    },
  };
}

const GENRE_LABEL = { tango: "Tango", vals: "Vals", milonga: "Milonga", cortina: "Cortina" };

/* The core danceable tango styles the player + tanda logic understand. Anything
   else (foxtrot, kizomba, chacarera, … or "unknown") is a free-form label: fully
   browsable and editable, but treated as non-tango. NB: "cortina" is NOT a
   genre — it's a usage flag on a song (song.isCortina), orthogonal to genre. */
const CORE_STYLES = ["tango", "vals", "milonga"];
/* The type menu offered by the import tool: core styles first, then common
   non-tango ones; the UI also lets you type a custom value. (Cortina lives on
   its own toggle, not in this list.) */
const IMPORT_DEFAULT_STYLE = "mixed";
const STYLE_TYPES = [
  "mixed",
  "tango", "vals", "milonga",
  "foxtrot", "kizomba", "chacarera", "zamba", "folklore", "salsa", "swing", "other",
];
const STYLE_LABELS = {
  mixed: "Mixed", tango: "Tango", vals: "Vals", milonga: "Milonga",
  foxtrot: "Foxtrot", kizomba: "Kizomba", chacarera: "Chacarera", zamba: "Zamba",
  folklore: "Folklore", salsa: "Salsa", swing: "Swing", other: "Other", unknown: "Unknown",
  // Legacy label kept so any lingering genre='cortina' still renders nicely.
  cortina: "Cortina",
};
function isCoreStyle(g) { return CORE_STYLES.indexOf(g) !== -1; }
/* Human label for any style value (known or custom). */
function genreLabel(g) {
  if (!g) return "Unknown";
  return STYLE_LABELS[g] || (g[0].toUpperCase() + g.slice(1));
}
/* The pill CSS class for a style: the four cores keep their colours; everything
   else shares a neutral "other"/"unknown" treatment. */
function genreClass(g) {
  if (isCoreStyle(g)) return "is-" + g;
  if (g === "mixed") return "is-mixed";
  return g === "unknown" ? "is-unknown" : "is-other";
}

/* one genre/era pill, used wherever a tanda's genre is shown. `small` is the
   compact variant for dense rows (.sm utility). */
function GenreTag({ genre, small }) {
  return <span className={"tp-tag " + genreClass(genre) + (small ? " sm" : "")}>{genreLabel(genre)}</span>;
}

/* transient confirmation toast (e.g. "Tanda saved"), with an optional Undo
   action. useToast owns the auto-dismiss timer; <Toast> renders it. Shared by
   the Tandas & Playlists views so the flash logic lives in exactly one place. */
function useToast() {
  const [toast, setToast] = useState(null);
  const timer = useRef(null);
  const dismiss = useCallback(() => { clearTimeout(timer.current); setToast(null); }, []);
  const flash = useCallback((msg, action) => {
    setToast({ msg, action });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), action ? 5000 : 2400);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  return { toast, flash, dismiss };
}

function Toast({ toast, onDismiss }) {
  if (!toast) return null;
  return (
    <div className="tv-toast">
      <span className="ic"><I.check s={16} /></span>
      {toast.msg}
      {toast.action && <button onClick={() => { toast.action(); onDismiss(); }}>Undo</button>}
    </div>
  );
}

/* A centered confirmation dialog for destructive actions (delete a tanda,
   remove a folder, delete a playlist). Reach for it via useConfirm() rather
   than rendering it directly. Enter confirms, Escape / backdrop click cancels. */
function ConfirmModal({ title, message, confirmLabel = "Delete", cancelLabel = "Cancel", danger = true, onConfirm, onCancel }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") { e.preventDefault(); onCancel(); }
      else if (e.key === "Enter") { e.preventDefault(); onConfirm(); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onConfirm, onCancel]);
  return (
    <div className="tp-modal-scrim" onMouseDown={onCancel}>
      <div className="tp-modal" role="alertdialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
        <div className={"tp-modal-icon" + (danger ? " danger" : "")}>
          {danger ? <I.trash s={20} /> : <I.check s={20} />}
        </div>
        <div className="tp-modal-title">{title}</div>
        {message && <div className="tp-modal-msg">{message}</div>}
        <div className="tp-modal-actions">
          <button className="tp-modal-cancel" onClick={onCancel}>{cancelLabel}</button>
          <button className={"tp-modal-confirm" + (danger ? " danger" : "")} onClick={onConfirm} autoFocus>
            {danger && <I.trash s={14} />} {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/* useConfirm owns the dialog state. `ask(opts)` opens the modal; `opts.onConfirm`
   fires when the user accepts. Render the returned `modal` somewhere in the view.
   Lives here so every view shares one confirmation flow. */
function useConfirm() {
  const [state, setState] = useState(null);
  const close = useCallback(() => setState(null), []);
  const ask = useCallback((opts) => setState(opts || {}), []);
  const modal = state ? (
    <ConfirmModal
      {...state}
      onCancel={close}
      onConfirm={() => { if (state.onConfirm) state.onConfirm(); close(); }}
    />
  ) : null;
  return { ask, modal };
}

/* ===================== SONG-NAME-ONLY DISPLAY ======================
 * A library display preference: strip the orchestra, singer, year and
 * track-number cruft that's often baked into a song's title field, leaving
 * just the bare song name. This mirrors the title-parsing heuristics the Smart
 * Organize engine uses (packages/main/src/services/enrich.ts → derive()), but
 * runs purely on display — it never edits the stored metadata.
 */

// A glued trailing "-Singer": a capitalized 1–3 word name after a hyphen with
// no surrounding spaces, e.g. "Uno-Héctor Mauré". Conservative so genuinely
// hyphenated titles survive. Kept in sync with GLUED_SINGER in enrich.ts.
const SONG_GLUED_SINGER = /^(.+?)-\s*[A-ZÁÉÍÓÚÑ][A-Za-zÁÉÍÓÚÑáéíóúñ.'’]+(?:\s+[A-ZÁÉÍÓÚÑ][A-Za-zÁÉÍÓÚÑáéíóúñ.'’]+){0,2}$/;
const SONG_YEAR_RE = /\b(18[5-9]\d|19\d\d|20[0-2]\d)\b/g;

// Derive the bare song name from a song's (often messy) title field. Falls back
// to the raw title whenever cleaning would leave nothing, so a row never blanks.
function cleanSongTitle(s) {
  const raw = ((s && s.title) || "").trim();
  if (!raw) return raw;
  // Drop a leading track number ("02 - …", "07. …").
  let t = raw.replace(/^\d{1,2}[\s.\-]+/, "");
  // Drop a parenthetical (singer credit, "(instrumental)", remaster note…).
  t = t.replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+/g, " ").trim();
  // Drop a 4-digit year.
  t = t.replace(SONG_YEAR_RE, " ").replace(/\s+/g, " ").trim();
  // Split "Artist - Title" on spaced hyphens; the leading segment is the
  // orchestra/artist, the rest is the song.
  const segs = t
    .split(/\s+[-–—]\s+/)
    .map((x) => x.replace(/^[\s\-–—]+/, "").replace(/[\s\-–—]+$/, "").trim())
    .filter(Boolean)
    .filter((seg) => !/^\d{4}$/.test(seg));
  let title = segs.length >= 2 ? segs.slice(1).join(" - ") : (segs[0] || "");
  // A glued trailing "-Instrumental" / "-Singer" on the song name.
  if (title) {
    const instTail = title.replace(/\s*[-–—]\s*instrumental\s*$/i, "").trim();
    if (instTail !== title) title = instTail;
    else {
      const g = title.match(SONG_GLUED_SINGER);
      if (g) title = g[1].trim();
    }
  }
  return title || raw;
}

// Reactive read of an on/off preference from Settings. Seeded from localStorage
// ("compas.<key>") and kept live via the `tweakchange` event setTweak emits.
function useBoolPref(key) {
  const [on, setOn] = useState(() => {
    try { return localStorage.getItem("compas." + key) === "1"; } catch (e) { return false; }
  });
  useEffect(() => {
    const onTweak = (e) => {
      if (e.detail && Object.prototype.hasOwnProperty.call(e.detail, key)) setOn(!!e.detail[key]);
    };
    window.addEventListener("tweakchange", onTweak);
    return () => window.removeEventListener("tweakchange", onTweak);
  }, [key]);
  return on;
}
// "Show song name only" library display preference.
const useSongNameOnly = () => useBoolPref("songNameOnly");
// "Collapse folders by default" — folder trees re-seed their open state the
// moment the DJ flips it.
const useCollapseFoldersByDefault = () => useBoolPref("collapseFoldersByDefault");
// "Cortinas in filters" — whether cortinas' orchestras, singers, styles and
// years are offered in the library's filter dropdowns.
const useCortinasInFilters = () => useBoolPref("cortinasInFilters");

Object.assign(window, { I, Waveform, EQ, Marquee, PreviewGlyph, previewTitle, clickKeys, GENRE_LABEL, GenreTag, useToast, Toast, ConfirmModal, useConfirm, CORE_STYLES, IMPORT_DEFAULT_STYLE, STYLE_TYPES, STYLE_LABELS, isCoreStyle, genreLabel, genreClass, cleanSongTitle, useSongNameOnly, useCollapseFoldersByDefault, useCortinasInFilters });
