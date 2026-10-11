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
      <ObRow icon={<I.curtain s={15} />} name="Cortinas"><span className="tp-tag is-cortina sm">{tr("common.genre.cortina")}</span></ObRow>
    </div>
  );
}

// The song editor's orquesta + singer fields, plus the orquesta tag they feed.
function DemoCredits() {
  return (
    <div className="tp-ob-edit tv-song-edit">
      <div className="tv-song-edit-grid">
        <label className="f"><span>{tr("onboarding.demoOrquesta")}</span><input readOnly value="Carlos Di Sarli" /></label>
        <label className="f"><span>{tr("onboarding.demoSinger")}</span><input readOnly value="Roberto Rufino" /></label>
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
        <span className="tp-ob-tierbadge"><I.check s={12} /> {tr("onboarding.demoVerified")}</span>
      </div>
      <div className="tp-ob-adds">
        <span className="tp-ob-add"><b>{tr("onboarding.demoOrchestra")}</b> Troilo</span>
        <span className="tp-ob-add"><b>{tr("onboarding.demoSinger")}</b> Fiorentino</span>
        <span className="tp-ob-add"><b>{tr("onboarding.demoYear")}</b> 1942</span>
      </div>
      <div className="tp-ob-orgnote"><I.check s={12} /> {tr("onboarding.demoOrganizeNote")}</div>
    </div>
  );
}

// A song flagged as a cortina, with the toggle thrown on.
function DemoCortina() {
  return (
    <div className="tp-ob-toggle">
      <span className="tp-ob-curtbadge"><I.curtain s={16} /></span>
      <div className="tx">
        <div className="t">{tr("onboarding.demoCortinaToggle")}</div>
        <div className="d">{tr("onboarding.demoCortinaToggleDesc")}</div>
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
      <button className="tp-btn accent sm" type="button" tabIndex={-1}><I.spark s={14} /> {tr("onboarding.demoSuggestTanda")}</button>
      <div className="tp-ob-srow"><I.check s={14} /> <span>{tr("onboarding.demoSameOrquesta", { orquesta: "Di Sarli" })}</span></div>
      <div className="tp-ob-srow"><I.check s={14} /> <span>{tr("onboarding.demoSameEra")}</span></div>
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
        <div className="t">{tr("onboarding.demoFloor")}</div>
        <div className="d">{tr("onboarding.demoFloorDesc")}</div>
      </div>
      <div className="tp-ob-out cue">
        <span className="ic"><I.headphones s={18} /></span>
        <div className="t">{tr("onboarding.demoPreListen")}</div>
        <div className="d">{tr("onboarding.demoPreListenDesc")}</div>
      </div>
    </div>
  );
}

// A post in the Community feed: another DJ's tanda with a few words, the likes
// and comments it drew, and a way to save it.
function DemoCommunity() {
  return (
    <div className="tp-ob-post">
      <div className="tp-ob-phead">
        <CommunityAvatar id="tour" avatar="preset:1" size="sm" />
        <div className="tx">
          <div className="t">{trx("community.headlineSharedNamed", { name: <b>Lucía</b>, tanda: <b>Di Sarli 1941</b> })}</div>
          <div className="d">Buenos Aires</div>
        </div>
      </div>
      <p className="tp-ob-pnote">{tr("onboarding.demoCommunityNote")}</p>
      <div className="tp-ob-ptanda">
        <I.note s={14} />
        <span className="nm">Carlos Di Sarli · Roberto Rufino</span>
        <span className="n">{tr("community.songs", { count: 4 })}</span>
        <GenreTag genre="tango" small />
      </div>
      <div className="tp-ob-pacts">
        <span className="on"><I.heartFill s={15} /> 24</span>
        <span><I.chat s={15} /> 5</span>
        <span><I.bookmark s={15} /></span>
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
    titleKey: "onboarding.welcomeTitle",
    bodyKey: "onboarding.welcomeBody",
    demo: () => <Waveform progress={0.5} bars={64} seed={11} height={48} />,
  },
  {
    icon: "upload", eyebrowKey: "onboarding.eyebrowLibrary",
    titleKey: "onboarding.importTitle",
    bodyKey: "onboarding.importBody",
    demo: DemoImport,
    how: () => trx("onboarding.importHow", { b: (s) => <b>{s}</b> }),
  },
  {
    icon: "pencil", eyebrowKey: "onboarding.eyebrowLibrary",
    titleKey: "onboarding.creditsTitle",
    bodyKey: "onboarding.creditsBody",
    demo: DemoCredits,
    how: () => trx("onboarding.creditsHow", { b: (s) => <b>{s}</b> }),
  },
  {
    icon: "spark", eyebrowKey: "onboarding.eyebrowLibrary",
    titleKey: "onboarding.organizeTitle",
    bodyKey: "onboarding.organizeBody",
    demo: DemoOrganize,
    how: () => trx("onboarding.organizeHow", { b: (s) => <b>{s}</b> }),
  },
  {
    icon: "curtain", eyebrowKey: "onboarding.eyebrowCortinas",
    titleKey: "onboarding.cortinaTitle",
    bodyKey: "onboarding.cortinaBody",
    demo: DemoCortina,
    how: () => trx("onboarding.cortinaHow", { b: (s) => <b>{s}</b> }),
  },
  {
    icon: "note", eyebrowKey: "onboarding.eyebrowTandas",
    titleKey: "onboarding.tandaTitle",
    bodyKey: "onboarding.tandaBody",
    demo: DemoTanda,
    how: () => trx("onboarding.tandaHow", { where: <Where trail={[tr("common.nav.Tandas"), tr("onboarding.crumbBuild")]} /> }),
  },
  {
    icon: "spark", eyebrowKey: "onboarding.eyebrowTandas",
    titleKey: "onboarding.suggestTitle",
    bodyKey: "onboarding.suggestBody",
    demo: DemoSuggest,
    how: () => trx("onboarding.suggestHow", { where: <Where trail={[tr("common.nav.Tandas"), tr("onboarding.crumbSuggestions")]} /> }),
  },
  {
    icon: "scissor", eyebrowKey: "onboarding.eyebrowPlayback",
    titleKey: "onboarding.silenceTitle",
    bodyKey: "onboarding.silenceBody",
    demo: DemoSilence,
    how: () => trx("onboarding.silenceHow", { where: <Where trail={[tr("common.nav.Settings"), tr("onboarding.crumbSilence")]} /> }),
  },
  {
    icon: "vol", eyebrowKey: "onboarding.eyebrowPlayback",
    titleKey: "onboarding.fadeTitle",
    bodyKey: "onboarding.fadeBody",
    demo: DemoFade,
    how: () => trx("onboarding.fadeHow", { where: <Where trail={[tr("common.nav.Settings"), tr("onboarding.crumbCortinas")]} /> }),
  },
  {
    icon: "headphones", eyebrowKey: "onboarding.eyebrowLive",
    titleKey: "onboarding.outputsTitle",
    bodyKey: "onboarding.outputsBody",
    demo: DemoOutputs,
    how: () => trx("onboarding.outputsHow", { b: (s) => <b>{s}</b>, where: <Where trail={[tr("common.nav.Settings"), tr("onboarding.crumbAudioOutputs")]} /> }),
  },
  {
    // Only in builds that have a Community backend (see OnboardingWizard).
    icon: "users", eyebrowKey: "onboarding.eyebrowCommunity", isNew: true, community: true,
    titleKey: "onboarding.communityTitle",
    bodyKey: "onboarding.communityBody",
    demo: DemoCommunity,
    how: () => trx("onboarding.communityHow", { where: <Where trail={[tr("common.nav.Community")]} /> }),
  },
  {
    signoff: true,
    titleKey: "onboarding.signoffTitle",
    bodyKey: "onboarding.signoffBody",
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
  // The Community slide shows only where the Community tab does.
  const community = useCommunity();
  const steps = ONBOARDING_STEPS.filter((s) => !s.community || community.configured);
  const [index, setI] = useState(0);
  const i = Math.min(index, steps.length - 1);
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
      <div className={"tp-ob" + (step.signoff ? " is-signoff" : "")} role="dialog" aria-modal="true" aria-label={tr("onboarding.dialogLabel")}>
        {!last && <button className="tp-ob-skip" onClick={onClose}>{tr("onboarding.skip")}</button>}

        {Icon && <div className={"tp-ob-icon" + (step.welcome ? " welcome" : "")}><Icon s={26} /></div>}
        {step.signoff && <div className="tp-ob-sign" aria-hidden="true">♥</div>}
        {step.eyebrowKey && (
          <div className="tp-ob-eyebrow">
            {tr(step.eyebrowKey)}{step.isNew && <span className="tp-ob-new">{tr("community.new")}</span>}
          </div>
        )}
        <div className="tp-ob-title">{tr(step.titleKey)}</div>
        <div className="tp-ob-body">{tr(step.bodyKey)}</div>

        {Demo && <div className="tp-ob-demo"><Demo /></div>}
        {step.how && <div className="tp-ob-how"><I.spark s={13} /><span>{step.how()}</span></div>}

        <div className="tp-ob-dots">
          {steps.map((_, n) => (
            <button key={n} className={"tp-ob-dot" + (n === i ? " on" : "")}
              aria-label={tr("onboarding.goToStep", { number: n + 1 })} aria-current={n === i ? "step" : undefined}
              onClick={() => setI(n)} />
          ))}
        </div>

        <div className="tp-ob-actions">
          <button className="tp-ob-back" onClick={back} disabled={first}>{tr("onboarding.back")}</button>
          <button className="tp-ob-next" onClick={last ? onClose : next} autoFocus>
            {last ? tr("onboarding.letsDance") : tr("onboarding.continue")}{!last && <I.chev s={14} />}
          </button>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { OnboardingWizard, useOnboarding });
