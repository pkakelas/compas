// shared.jsx — icons, waveform, genre tag, toast. Exports to window.
const { useMemo, useState, useRef, useCallback, useEffect } = React;

/* ---------- icons (stroke, 1.6) ---------- */
const I = {
  play:  (p) => <svg viewBox="0 0 24 24" width={p.s||20} height={p.s||20} fill="currentColor"><path d="M8 5.5v13l11-6.5z"/></svg>,
  pause: (p) => <svg viewBox="0 0 24 24" width={p.s||20} height={p.s||20} fill="currentColor"><rect x="7" y="5.5" width="3.4" height="13" rx="1"/><rect x="13.6" y="5.5" width="3.4" height="13" rx="1"/></svg>,
  prev:  (p) => <svg viewBox="0 0 24 24" width={p.s||18} height={p.s||18} fill="currentColor"><path d="M7 6v12M19 6.5v11l-9-5.5z"/></svg>,
  next:  (p) => <svg viewBox="0 0 24 24" width={p.s||18} height={p.s||18} fill="currentColor"><path d="M17 6v12M5 6.5v11l9-5.5z"/></svg>,
  fwd:   (p) => <svg viewBox="0 0 24 24" width={p.s||17} height={p.s||17} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M5 6.5v11l8-5.5zM14 6.5v11l8-5.5z"/></svg>,
  scissor:(p)=> <svg viewBox="0 0 24 24" width={p.s||16} height={p.s||16} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="6" cy="7" r="2.4"/><circle cx="6" cy="17" r="2.4"/><path d="M8 8.5L20 17M8 15.5L20 7"/></svg>,
  spark: (p) => <svg viewBox="0 0 24 24" width={p.s||15} height={p.s||15} fill="currentColor"><path d="M12 2l1.6 5.4L19 9l-5.4 1.6L12 16l-1.6-5.4L5 9l5.4-1.6zM18.5 14l.8 2.7 2.7.8-2.7.8-.8 2.7-.8-2.7-2.7-.8 2.7-.8z"/></svg>,
  wave:  (p) => <svg viewBox="0 0 24 24" width={p.s||16} height={p.s||16} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M3 12h2l2-6 3 14 3-11 2 5h6"/></svg>,
  vol:   (p) => <svg viewBox="0 0 24 24" width={p.s||16} height={p.s||16} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M4 9v6h3l5 4V5L7 9zM16 9.5a3.5 3.5 0 010 5M18.5 7a7 7 0 010 10"/></svg>,
  volX:  (p) => <svg viewBox="0 0 24 24" width={p.s||16} height={p.s||16} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M4 9v6h3l5 4V5L7 9zM16 9.5l5 5M21 9.5l-5 5"/></svg>,
  curtain:(p)=> <svg viewBox="0 0 24 24" width={p.s||16} height={p.s||16} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M3 3h18M5 3v15c2 0 3-1.5 3-4V3M19 3v15c-2 0-3-1.5-3-4V3"/></svg>,
  plus:  (p) => <svg viewBox="0 0 24 24" width={p.s||16} height={p.s||16} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>,
  search:(p) => <svg viewBox="0 0 24 24" width={p.s||16} height={p.s||16} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/></svg>,
  x:     (p) => <svg viewBox="0 0 24 24" width={p.s||16} height={p.s||16} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>,
  grip:  (p) => <svg viewBox="0 0 24 24" width={p.s||16} height={p.s||16} fill="currentColor"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></svg>,
  check: (p) => <svg viewBox="0 0 24 24" width={p.s||16} height={p.s||16} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 6.5"/></svg>,
  clock: (p) => <svg viewBox="0 0 24 24" width={p.s||16} height={p.s||16} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>,
  folder:(p)=> <svg viewBox="0 0 24 24" width={p.s||16} height={p.s||16} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7.5a2 2 0 012-2h3.6a2 2 0 011.5.7l.9 1.1H19a2 2 0 012 2v7.2a2 2 0 01-2 2H5a2 2 0 01-2-2z"/></svg>,
  folderOpen:(p)=> <svg viewBox="0 0 24 24" width={p.s||16} height={p.s||16} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7.5a2 2 0 012-2h3.6a2 2 0 011.5.7l.9 1.1H19a2 2 0 012 2v1.2H6.4a2 2 0 00-1.9 1.4L3 17.5z"/><path d="M3 17.5l1.5-5.4a2 2 0 011.9-1.4H21l-1.8 5.5a2 2 0 01-1.9 1.3H5a2 2 0 01-2-2z"/></svg>,
  chev:  (p) => <svg viewBox="0 0 24 24" width={p.s||14} height={p.s||14} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6"/></svg>,
  note:  (p) => <svg viewBox="0 0 24 24" width={p.s||15} height={p.s||15} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18V6l11-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/></svg>,
  upload:(p)=> <svg viewBox="0 0 24 24" width={p.s||16} height={p.s||16} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M12 16V5M8 9l4-4 4 4"/><path d="M5 16v2a2 2 0 002 2h10a2 2 0 002-2v-2"/></svg>,
  trash: (p) => <svg viewBox="0 0 24 24" width={p.s||16} height={p.s||16} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7h16M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2M6 7l1 12a1 1 0 001 1h8a1 1 0 001-1l1-12"/></svg>,
  pencil:(p)=> <svg viewBox="0 0 24 24" width={p.s||16} height={p.s||16} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M14 5l5 5M4 20l1-4L16 5a1.5 1.5 0 012 0l1 1a1.5 1.5 0 010 2L8 19z"/></svg>,
  arrowDn:(p)=> <svg viewBox="0 0 24 24" width={p.s||16} height={p.s||16} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M6 13l6 6 6-6"/></svg>,
  drag:  (p) => <svg viewBox="0 0 24 24" width={p.s||15} height={p.s||15} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M8 6h8M8 12h8M8 18h8"/></svg>,
  tag:   (p) => <svg viewBox="0 0 24 24" width={p.s||16} height={p.s||16} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M12.6 3.6H20a1 1 0 011 1v7.4a2 2 0 01-.6 1.4l-6.4 6.4a2 2 0 01-2.8 0l-4.4-4.4a2 2 0 010-2.8l6.4-6.4a2 2 0 011.4-.6z"/><circle cx="16" cy="8" r="1.25" fill="currentColor" stroke="none"/></svg>,
  headphones:(p)=> <svg viewBox="0 0 24 24" width={p.s||16} height={p.s||16} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M4 13v-1a8 8 0 0116 0v1"/><path d="M4 14a2 2 0 012-2h1v6H6a2 2 0 01-2-2zM20 14a2 2 0 00-2-2h-1v6h1a2 2 0 002-2z"/></svg>,
  speaker:(p)=> <svg viewBox="0 0 24 24" width={p.s||16} height={p.s||16} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="6" y="2.5" width="12" height="19" rx="2.5"/><circle cx="12" cy="15" r="3.2"/><circle cx="12" cy="6.5" r="1"/></svg>,
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

/* The leading glyph for any clickable "listen / audition" row — used by the live
   queue's tanda search, the tanda cards, the builder bench and the playlist
   editor so they all speak the same language. While this row is the active
   preview it shows the equalizer; otherwise it shows a play icon, or the
   headphone glyph when previews are routed to the monitor (cue) output. Pass `n`
   to prefix the track number (rows that have their own glyph can omit it). */
function PreviewGlyph({ preview, playing, n, s = 12 }) {
  if (playing) return <EQ />;
  const viaMonitor = !!(preview && preview.viaMonitor);
  return (
    <React.Fragment>
      {n != null && <span className="qn">{n}</span>}
      {viaMonitor ? <I.headphones s={s} /> : <I.play s={s} />}
    </React.Fragment>
  );
}

/* The matching tooltip: "Pause" while playing, "Listen in headphones (monitor)"
   when previews route to the cue output, otherwise the caller's verb. Returns
   undefined when there's no preview affordance so the title attribute is dropped. */
function previewTitle(preview, playing, verb = "Listen") {
  if (!preview) return undefined;
  if (playing) return "Pause";
  return preview.viaMonitor ? "Listen in headphones (monitor)" : verb;
}

const GENRE_LABEL = { tango: "Tango", vals: "Vals", milonga: "Milonga", cortina: "Cortina" };

/* one genre/era pill, used wherever a tanda's genre is shown. `small` is the
   compact variant for dense rows (.sm utility). */
function GenreTag({ genre, small }) {
  return <span className={"tp-tag is-" + genre + (small ? " sm" : "")}>{GENRE_LABEL[genre] || "Tango"}</span>;
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

Object.assign(window, { I, Waveform, EQ, PreviewGlyph, previewTitle, GENRE_LABEL, GenreTag, useToast, Toast });
