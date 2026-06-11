// onboarding.jsx — first-run feature tour. A standalone set of modal slides the
// DJ steps through (Back · Continue) or skips entirely. Shown once, gated on a
// localStorage flag, mounted above every view by AppBody. Fully self-contained:
// its own steps, its own .tp-ob-* styles, nothing else depends on it.
//
// Each slide carries a live `demo` built from the app's own shared components
// (Waveform, GenreTag, TagPills, the I icons, the real tp-* classes) so the tour
// previews the actual UI — and a `how` line saying where to do the thing.
const { useState, useEffect, useCallback } = React;

const ONBOARDING_KEY = "compas.onboardingSeen";

// A faux library row: a folder/song name carrying a style pill, reused by a
// couple of slides so they speak the same visual language as the real views.
function ObRow({ icon, name, children }) {
  return (
    <div className="tp-ob-row">
      <span className="ic">{icon}</span>
      <span className="nm">{name}</span>
      {children}
    </div>
  );
}

// The four core style pills rendered with the real GenreTag, the way they look
// the moment you tag a folder on import.
function DemoImport() {
  return (
    <div className="tp-ob-rows">
      <ObRow icon={<I.folder s={15} />} name="Di Sarli — Instrumentales"><GenreTag genre="tango" small /></ObRow>
      <ObRow icon={<I.folder s={15} />} name="Valses de oro"><GenreTag genre="vals" small /></ObRow>
      <ObRow icon={<I.folder s={15} />} name="Milongas para bailar"><GenreTag genre="milonga" small /></ObRow>
      <ObRow icon={<I.curtain s={15} />} name="Cortinas"><span className="tp-tag is-cortina sm">Cortina</span></ObRow>
    </div>
  );
}

// The song editor's orquesta + singer fields, plus the orquesta tag they feed.
function DemoCredits() {
  return (
    <div className="tp-ob-edit tv-song-edit">
      <div className="tv-song-edit-grid">
        <label className="f"><span>Orquesta</span><input readOnly value="Carlos Di Sarli" /></label>
        <label className="f"><span>Singer</span><input readOnly value="Roberto Rufino" /></label>
      </div>
      <TagPills tags={[{ cat: "orquesta", label: "Di Sarli" }, { cat: "age", label: "40s" }, { cat: "mood", label: "Lyrical" }]} />
    </div>
  );
}

// Smart Organize: a verified song with the missing credits it proposes to fill,
// plus the reassurance that nothing applies until the DJ approves it.
function DemoOrganize() {
  return (
    <div className="tp-ob-org">
      <div className="tp-ob-orgrow">
        <span className="nm">Nido gaucho</span>
        <span className="tp-ob-tierbadge"><I.check s={12} /> Verified</span>
      </div>
      <div className="tp-ob-adds">
        <span className="tp-ob-add"><b>Orchestra</b> Troilo</span>
        <span className="tp-ob-add"><b>Singer</b> Fiorentino</span>
        <span className="tp-ob-add"><b>Year</b> 1942</span>
      </div>
      <div className="tp-ob-orgnote"><I.check s={12} /> You approve every change — files on disk are never touched.</div>
    </div>
  );
}

// A song flagged as a cortina, with the toggle thrown on.
function DemoCortina() {
  return (
    <div className="tp-ob-toggle">
      <span className="tp-ob-curtbadge"><I.curtain s={16} /></span>
      <div className="tx">
        <div className="t">Mark as cortina</div>
        <div className="d">Kept apart from the dance music</div>
      </div>
      <span className="tp-sw" data-on="1" aria-hidden="true"><i /></span>
    </div>
  );
}

// A four-song tanda the way it stacks on the builder's bench.
function DemoTanda() {
  const songs = ["El amanecer", "Bahía Blanca", "Verdemar", "Nido gaucho"];
  return (
    <div className="tp-ob-tanda">
      {songs.map((s, i) => (
        <div className="tp-ob-trow" key={s}>
          <span className="qn">{i + 1}</span>
          <span className="nm">{s}</span>
          <GenreTag genre="tango" small />
        </div>
      ))}
    </div>
  );
}

// The Suggestions tab: a Suggest action and a couple of proposed, on-style rows.
function DemoSuggest() {
  return (
    <div className="tp-ob-suggest">
      <button className="tp-btn accent sm" type="button" tabIndex={-1}><I.spark s={14} /> Suggest tanda</button>
      <div className="tp-ob-srow"><I.check s={14} /> <span>Same orquesta · Di Sarli</span></div>
      <div className="tp-ob-srow"><I.check s={14} /> <span>Same era · 1940s</span></div>
    </div>
  );
}

// Two waveforms with a measured breath of silence between them.
function DemoSilence() {
  return (
    <div className="tp-ob-gap">
      <Waveform progress={1} bars={28} seed={5} height={34} />
      <span className="tp-ob-gappill"><I.scissor s={13} /> 1.5s</span>
      <Waveform progress={0} bars={28} seed={9} height={34} />
    </div>
  );
}

// A cortina waveform easing out on its own — the bars fade toward the end.
function DemoFade() {
  return (
    <div className="tp-ob-fadewrap">
      <span className="tp-ob-curtbadge sm"><I.curtain s={15} /></span>
      <div className="tp-ob-fade"><Waveform progress={0.7} bars={40} seed={13} height={36} /></div>
    </div>
  );
}

// The floor and the headset, living in two separate output cards.
function DemoOutputs() {
  return (
    <div className="tp-ob-cards">
      <div className="tp-ob-out floor">
        <span className="ic"><I.speaker s={18} /></span>
        <div className="t">Floor</div>
        <div className="d">The dancers hear this</div>
      </div>
      <div className="tp-ob-out cue">
        <span className="ic"><I.headphones s={18} /></span>
        <div className="t">Pre-listen</div>
        <div className="d">Only in your headset</div>
      </div>
    </div>
  );
}

// Where a setting lives, shown as a breadcrumb so "Settings ▸ Cortinas" reads at
// a glance. Pass the trail as an array of crumbs.
function Where({ trail }) {
  return (
    <span className="tp-ob-where">
      {trail.map((c, i) => (
        <React.Fragment key={c}>
          {i > 0 && <I.chev s={11} />}<b>{c}</b>
        </React.Fragment>
      ))}
    </span>
  );
}

// One slide per feature. `icon` names an entry in the shared I set; `demo` is a
// live preview component; `how` tells the DJ where to do it. Copy stays short so
// the whole tour reads in well under a minute.
const ONBOARDING_STEPS = [
  {
    icon: "play", welcome: true,
    title: "Welcome to Compás",
    body: "A quick tour of what the player can do — from importing your music to running the floor. Step through it, or skip and explore on your own.",
    demo: () => <Waveform progress={0.5} bars={64} seed={11} height={48} />,
  },
  {
    icon: "upload", eyebrow: "Library",
    title: "Import with a style",
    body: "Point Compás at a folder and tag everything as it comes in — tango, vals, milonga or your own label — so the music lands organised from the very start.",
    demo: DemoImport,
    how: () => <>Drop a folder in, then hit <b>Set style</b> on it while importing.</>,
  },
  {
    icon: "pencil", eyebrow: "Library",
    title: "Edit orchestras & singers",
    body: "Open any song to set its orchestra and singer. Clean credits make tandas easier to build and your whole library easier to search.",
    demo: DemoCredits,
    how: () => <>Click a song in the <b>Library</b> to open its editor.</>,
  },
  {
    icon: "spark", eyebrow: "Library",
    title: "Smart Organize",
    body: "Let Compás fill in missing orchestras, singers, years and styles — matched against a built-in tango catalogue and sorted by confidence, so you can apply the safe ones in one go.",
    demo: DemoOrganize,
    how: () => <>Hit <b>Smart Organize</b> in the <b>Library</b> header, then review by tier.</>,
  },
  {
    icon: "curtain", eyebrow: "Cortinas",
    title: "Mark your cortinas",
    body: "Flag tracks as cortinas so they sit apart from the dance music and surface instantly whenever you reach for one.",
    demo: DemoCortina,
    how: () => <>Flag a song or whole folder as a cortina in the <b>Library</b> — or in a song's editor.</>,
  },
  {
    icon: "note", eyebrow: "Tandas",
    title: "Build tandas",
    body: "Group songs into tandas in the builder — drag tracks onto the bench, reorder them, and save the set ready for the night.",
    demo: DemoTanda,
    how: () => <>Open the <b>Tandas</b> tab and drag songs onto the bench.</>,
  },
  {
    icon: "spark", eyebrow: "Tandas",
    title: "Tanda suggestions",
    body: "Let Compás propose matching tracks by orchestra, era and style, so a coherent tanda comes together in seconds.",
    demo: DemoSuggest,
    how: () => <>Browse the <Where trail={["Tandas", "Suggestions"]} /> tab.</>,
  },
  {
    icon: "scissor", eyebrow: "Playback",
    title: "Silence between tandas",
    body: "Drop a beat of silence between tracks so the floor breathes, and trim dead air at the edges of each song.",
    demo: DemoSilence,
    how: () => <>Set it under <Where trail={["Settings", "Silence & spacing"]} />.</>,
  },
  {
    icon: "vol", eyebrow: "Playback",
    title: "Cortinas fade by default",
    body: "Cortinas ease out on their own at the end of the round — you never have to ride the fader to bow one out.",
    demo: DemoFade,
    how: () => <>Tune the fade (or play only the first seconds) in <Where trail={["Settings", "Cortinas"]} />.</>,
  },
  {
    icon: "headphones", eyebrow: "Live",
    title: "Live & headset, side by side",
    body: "The floor output and your headset preview live in separate cards, so you can audition the next tanda while the current one plays.",
    demo: DemoOutputs,
    how: () => <>Turn on <b>Pre-listen</b> under <Where trail={["Settings", "Audio outputs"]} />.</>,
  },
  {
    signoff: true,
    title: "Made by a nerd milonguero",
    body: "Built for the people who make the night — the DJs spinning, the dancers in the ronda, everyone who keeps the floor alive. With all my heart. Enjoy.",
  },
];

// First-run gate. `open` starts true until the tour has been seen; `close` marks
// it seen and dismisses. A dev-only console hook re-opens it for previewing.
function useOnboarding() {
  const [open, setOpen] = useState(() => {
    try { return localStorage.getItem(ONBOARDING_KEY) !== "1"; } catch (e) { return false; }
  });
  const close = useCallback(() => {
    try { localStorage.setItem(ONBOARDING_KEY, "1"); } catch (e) { /* ignore */ }
    setOpen(false);
  }, []);
  // Re-open the tour on demand (e.g. the Settings "Replay tour" button). Leaves
  // the "seen" flag as-is — closing it again just re-confirms it.
  const start = useCallback(() => setOpen(true), []);
  useEffect(() => {
    // Re-open the tour from the console in dev — __previewOnboarding()
    if (location.protocol === "http:") window.__previewOnboarding = start;
  }, [start]);
  return [open, close, start];
}

function OnboardingWizard({ onClose }) {
  const steps = ONBOARDING_STEPS;
  const [i, setI] = useState(0);
  const step = steps[i];
  const first = i === 0;
  const last = i === steps.length - 1;

  const next = useCallback(() => setI((n) => Math.min(steps.length - 1, n + 1)), [steps.length]);
  const back = useCallback(() => setI((n) => Math.max(0, n - 1)), []);

  // Keyboard parity: Esc skips, ←/→ step, Enter advances (and finishes on the
  // last slide). Deliberately no backdrop-click dismissal — the tour closes only
  // via Skip or the final button so it's never lost by an accidental click.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
      else if (e.key === "ArrowRight" || e.key === "Enter") { e.preventDefault(); last ? onClose() : next(); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); back(); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, next, back, last]);

  const Icon = step.icon ? (I[step.icon] || I.play) : null;
  const Demo = step.demo;

  return (
    <div className="tp-ob-scrim">
      <div className={"tp-ob" + (step.signoff ? " is-signoff" : "")} role="dialog" aria-modal="true" aria-label="Welcome tour">
        {!last && <button className="tp-ob-skip" onClick={onClose}>Skip</button>}

        {Icon && <div className={"tp-ob-icon" + (step.welcome ? " welcome" : "")}><Icon s={26} /></div>}
        {step.signoff && <div className="tp-ob-sign" aria-hidden="true">♥</div>}
        {step.eyebrow && <div className="tp-ob-eyebrow">{step.eyebrow}</div>}
        <div className="tp-ob-title">{step.title}</div>
        <div className="tp-ob-body">{step.body}</div>

        {Demo && <div className="tp-ob-demo"><Demo /></div>}
        {step.how && <div className="tp-ob-how"><I.spark s={13} /><span>{step.how()}</span></div>}

        <div className="tp-ob-dots">
          {steps.map((_, n) => (
            <button key={n} className={"tp-ob-dot" + (n === i ? " on" : "")}
              aria-label={"Go to step " + (n + 1)} aria-current={n === i ? "step" : undefined}
              onClick={() => setI(n)} />
          ))}
        </div>

        <div className="tp-ob-actions">
          <button className="tp-ob-back" onClick={back} disabled={first}>Back</button>
          <button className="tp-ob-next" onClick={last ? onClose : next} autoFocus>
            {last ? "Let's dance" : "Continue"}{!last && <I.chev s={14} />}
          </button>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { OnboardingWizard, useOnboarding });
