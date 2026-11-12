// settings-view.jsx — the Settings page: audio output routing, builder layout,
// appearance. A proper routable view (not the floating tweak tray) so more
// settings can be added over time.

const THEMES = [
  { id: "light", labelKey: "settings.themeLight", icon: (p) => <I.sun {...p} /> },
  { id: "dark", labelKey: "settings.themeDark", icon: (p) => <I.moon {...p} /> },
];

// Play a short tone out a specific output card so the DJ can confirm cabling
// before the night starts. Routed via a MediaStream + setSinkId, which works
// even on browsers where AudioContext.setSinkId isn't available yet.
function playTestTone(deviceId) {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const dest = ctx.createMediaStreamDestination();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 528;
    gain.gain.value = 0.0001;
    osc.connect(gain).connect(dest);
    const a = new Audio();
    a.srcObject = dest.stream;
    const stop = () => {
      try { osc.stop(); } catch (_e) { /* already stopped */ }
      a.pause();
      ctx.close();
    };
    const start = () => {
      a.play().catch(() => {});
      const now = ctx.currentTime;
      osc.start();
      // gentle in/out so it doesn't click
      gain.gain.linearRampToValueAtTime(0.12, now + 0.04);
      gain.gain.setValueAtTime(0.12, now + 0.55);
      gain.gain.linearRampToValueAtTime(0.0001, now + 0.7);
      setTimeout(stop, 800);
    };
    if (typeof a.setSinkId === "function" && deviceId) a.setSinkId(deviceId).then(start, start);
    else start();
  } catch (_e) { /* unsupported */ }
}

/* ---------- small page-native controls ---------- */
function SetSwitch({ checked, onChange }) {
  return (
    <button type="button" className="tp-sw" data-on={checked ? "1" : "0"}
      role="switch" aria-checked={!!checked} onClick={() => onChange(!checked)}><i /></button>
  );
}

function SetSelect({ value, options, onChange }) {
  return (
    <select className="tp-set-select" value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

function SetRow({ label, desc, pill, sub, children }) {
  return (
    <div className={"tp-set-row" + (sub ? " is-sub" : "")}>
      <div className="tp-set-row-l">
        <div className="lb">{label}{pill && <span className="tp-set-pill">{pill}</span>}</div>
        {desc && <div className="ds">{desc}</div>}
      </div>
      <div className="tp-set-ctrl">{children}</div>
    </div>
  );
}

function SettingsCard({ icon, title, desc, children }) {
  return (
    <section className="tp-set-card">
      <div className="tp-set-card-h">
        <div className="tp-set-card-ic">{icon}</div>
        <div>
          <h3>{title}</h3>
          {desc && <p>{desc}</p>}
        </div>
      </div>
      <div className="tp-set-rows">{children}</div>
    </section>
  );
}

/* ============================ AUDIO OUTPUTS ============================ */
function AudioOutputsCard() {
  const { devices: dev } = usePlayer();
  const outOpts = dev.outputs.map((o) => ({ value: o.deviceId, label: o.label || tr("settings.outputFallback", { id: o.deviceId.slice(0, 4) }) }));
  const mainOpts = [{ value: "", label: tr("settings.systemDefault") }, ...outOpts];
  const monitorOpts = [{ value: "", label: tr("settings.chooseOutput") }, ...outOpts];
  const sameCard = dev.cueingEnabled && dev.monitorDeviceId && dev.monitorDeviceId === dev.mainDeviceId;

  return (
    <SettingsCard icon={<I.headphones s={18} />} title={tr("settings.audioTitle")}
      desc={tr("settings.audioDesc")}>
      {dev.needsAccess && (
        <div className="tp-set-note">
          {tr("settings.grantAccess")}
          <div className="tp-set-actions" style={{ marginTop: 9 }}>
            <button className="tp-btn primary sm" onClick={dev.requestAccess}>{tr("settings.allowAccess")}</button>
          </div>
        </div>
      )}

      <SetRow label={tr("settings.mainLabel")} desc={tr("settings.mainDesc")}>
        <SetSelect value={dev.mainDeviceId} options={mainOpts} onChange={dev.setMainDeviceId} />
        <button className="tp-btn sm square" title={tr("settings.testTone")} onClick={() => playTestTone(dev.mainDeviceId)}>
          <I.vol s={15} />
        </button>
      </SetRow>

      <SetRow label={tr("settings.preListenLabel")} desc={tr("settings.preListenDesc")}>
        <SetSwitch checked={dev.cueingEnabled} onChange={dev.setCueingEnabled} />
      </SetRow>

      {dev.cueingEnabled && (
        <React.Fragment>
          <SetRow label={tr("settings.preListenOutputLabel")} desc={tr("settings.preListenOutputDesc")}>
            <SetSelect value={dev.monitorDeviceId} options={monitorOpts} onChange={dev.setMonitorDeviceId} />
            <button className="tp-btn sm square" title={tr("settings.testTone")} disabled={!dev.monitorDeviceId}
              onClick={() => dev.monitorDeviceId && playTestTone(dev.monitorDeviceId)}>
              <I.headphones s={15} />
            </button>
          </SetRow>

          {sameCard && (
            <div className="tp-set-warn">{tr("settings.sameCardWarn")}</div>
          )}
          {!dev.monitorDeviceId && (
            <div className="tp-set-note">{tr("settings.pickPreListen")}</div>
          )}
          {dev.monitorDeviceId && !sameCard && (
            <div className="tp-set-note">
              {trx("settings.cueHint", {
                icon: <span style={{ color: "var(--cue)", verticalAlign: "-2px", display: "inline-block" }}><I.headphones s={14} /></span>,
              })}
            </div>
          )}
        </React.Fragment>
      )}

      <div className="tp-set-actions">
        <button className="tp-btn ghost sm" onClick={dev.refresh}>{tr("settings.refreshDevices")}</button>
      </div>
    </SettingsCard>
  );
}

/* ============================ DJ CONTROLLERS ============================ */
// DJ controllers run Mixxx's community mappings (entries/controllers.js). The
// DJ never picks files: "Detect and download" finds what's plugged in and
// fetches just that controller's mapping, which then works offline.
function useControllers() {
  const rt = window.compasControllers;
  const noop = React.useCallback(() => () => {}, []);
  const empty = React.useMemo(() => ({ supported: false, devices: [], midiMappings: [], offer: null }), []);
  return React.useSyncExternalStore(rt ? rt.subscribe : noop, rt ? rt.getSnapshot : () => empty);
}

const CONTROLLER_ERRORS = { network: "ctrlErrNetwork", integrity: "ctrlErrIntegrity", open: "ctrlErrOpen" };
const controllerError = (code) => tr("settings." + (CONTROLLER_ERRORS[code] || "ctrlErrStart"));

function controllerStatus(d) {
  if (d.status === "running") return <span className="tp-set-status ok">{tr("settings.ctrlRunning")}</span>;
  if (d.status === "downloading") return <span className="tp-set-status">{tr("settings.ctrlDownloading")}</span>;
  if (d.status === "starting") return <span className="tp-set-status">{tr("settings.ctrlStarting")}</span>;
  return null;
}

function ControllersCard() {
  const snap = useControllers();
  const rt = window.compasControllers;
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState(null); // {found, failed} after a detect
  if (!snap.supported) return null;

  const detect = async () => {
    setBusy(true); setResult(null);
    try { setResult(await rt.detectAndInstall()); } finally { setBusy(false); }
  };
  const midiOpts = [{ value: "", label: tr("settings.ctrlNoMapping") },
    ...snap.midiMappings.map((m) => ({ value: m.id, label: m.name }))];

  return (
    <SettingsCard icon={<I.sliders s={17} />} title={tr("settings.ctrlTitle")} desc={tr("settings.ctrlDesc")}>
      <div className="tp-set-actions">
        <button className="tp-btn primary sm" onClick={detect} disabled={busy || !snap.loaded}>
          <I.download s={14} /> {busy ? tr("settings.ctrlDetecting") : tr("settings.ctrlDetect")}
        </button>
      </div>
      {result && result.found === 0 && <div className="tp-set-note">{tr("settings.ctrlNoneFound")}</div>}

      {snap.devices.map((d) => (
        <SetRow key={d.key} label={d.label}
          desc={d.mapping ? tr("settings.ctrlMapping", { name: d.mapping.name }) : tr("settings.ctrlNoMappingFound")}>
          {controllerStatus(d)}
          {d.status === "error" && <span className="tp-set-status err">{controllerError(d.error)}</span>}
          {d.protocol === "midi" && (
            <SetSelect value={d.mapping ? d.mapping.id : ""} options={midiOpts}
              onChange={(id) => rt.setMidiMapping(d.key, id || null)} />
          )}
          {d.mapping && (d.status === "idle" || d.status === "error") && (
            <button className="tp-btn sm" onClick={() => rt.install(d.key)}>
              {d.status === "error" ? tr("settings.ctrlRetry") : d.installed ? tr("settings.ctrlStart") : tr("settings.ctrlDownload")}
            </button>
          )}
        </SetRow>
      ))}

      <div className="tp-set-note">{tr("settings.ctrlDecks")}</div>
      <div className="tp-set-note">
        {tr("settings.ctrlCredit", { project: (snap.source && snap.source.project) || "Mixxx",
          version: (snap.source && snap.source.tag) || "" })}
      </div>
    </SettingsCard>
  );
}

// Shown once, the first time a controller Compás has a mapping for is plugged
// in, if that mapping isn't downloaded yet. Rendered by the app shell.
function ControllerOfferModal() {
  const snap = useControllers();
  const rt = window.compasControllers;
  const d = snap.offer;
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState(null);
  React.useEffect(() => { setBusy(false); setError(null); }, [d && d.key]);
  React.useEffect(() => {
    if (!d) return undefined;
    const onKey = (e) => { if (e.key === "Escape") { e.preventDefault(); rt.dismissOffer(); } };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [d, rt]);
  if (!d || !d.mapping) return null;

  const setUp = async () => {
    setBusy(true); setError(null);
    const ok = await rt.install(d.key);
    setBusy(false);
    if (ok) return; // install() clears the offer
    const now = rt.getSnapshot().devices.find((x) => x.key === d.key);
    setError(controllerError(now && now.error));
  };
  return (
    <div className="tp-modal-scrim" onMouseDown={() => !busy && rt.dismissOffer()}>
      <div className="tp-modal" role="alertdialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
        <div className="tp-modal-icon accent"><I.sliders s={20} /></div>
        <div className="tp-modal-title">{tr("settings.ctrlOfferTitle")}</div>
        <div className="tp-modal-msg">{tr("settings.ctrlOfferMsg", { device: d.label })}</div>
        <div className="tp-modal-msg">{tr("settings.ctrlDecks")}</div>
        {error && <div className="tp-set-warn" style={{ marginTop: 10 }}>{error}</div>}
        <div className="tp-modal-actions">
          <button className="tp-modal-cancel" onClick={rt.dismissOffer} disabled={busy}>{tr("settings.ctrlOfferLater")}</button>
          <button className="tp-modal-confirm accent" onClick={setUp} disabled={busy} autoFocus>
            <I.download s={14} /> {busy ? tr("settings.ctrlDownloading") : error ? tr("settings.ctrlRetry") : tr("settings.ctrlOfferSetUp")}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ============================ CORTINA PLAYBACK ============================ */
// Let the DJ play only the first few seconds of every cortina, then auto-fade to
// the next tanda — handy when cortinas are just a floor-clearing cue, not a song.
function fmtSeconds(sec) {
  // Half-second steps read "2.5" or "2,5" depending on the language.
  const s = Number.isInteger(sec) ? sec
    : sec.toLocaleString(I18N.locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return tr("settings.seconds", { s });
}
function fmtSnippetLen(sec) {
  if (sec < 60) return fmtSeconds(sec);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s ? tr("settings.minutesSeconds", { m, s }) : tr("settings.minutes", { m });
}
function fmtFade(sec) {
  if (!sec) return tr("settings.fadeInstant");
  return fmtSeconds(sec);
}
function CortinaPlaybackCard() {
  const { playback } = usePlayer();
  return (
    <SettingsCard icon={<I.curtain s={17} />} title={tr("settings.cortinasTitle")}
      desc={tr("settings.cortinasDesc")}>
      <div className="tp-set-note">
        {tr("settings.cortinasNote")}
      </div>
      <SetRow label={tr("settings.snippetLabel")}
        desc={tr("settings.snippetDesc")}>
        <SetSwitch checked={playback.cortinaSnippetEnabled} onChange={playback.setCortinaSnippetEnabled} />
      </SetRow>

      {playback.cortinaSnippetEnabled && (
        <SetRow sub label={tr("settings.snippetLenLabel")} desc={tr("settings.snippetLenDesc")}>
          <input className="tp-set-range" type="range" min={3} max={300} step={1}
            value={playback.cortinaSnippetSec}
            onChange={(e) => playback.setCortinaSnippetSec(Number(e.target.value))} />
          <span className="tp-set-range-val">{fmtSnippetLen(playback.cortinaSnippetSec)}</span>
        </SetRow>
      )}

      <SetRow label={tr("settings.fadeLabel")}
        desc={tr("settings.fadeDesc")}>
        <input className="tp-set-range" type="range" min={0} max={10} step={0.5}
          value={playback.cortinaFadeSec}
          onChange={(e) => playback.setCortinaFadeSec(Number(e.target.value))} />
        <span className="tp-set-range-val">{fmtFade(playback.cortinaFadeSec)}</span>
      </SetRow>
    </SettingsCard>
  );
}

/* ============================ SOUND LEVELING ============================ */
// Volume normalization, applied at playback from the background analysis
// measurements. Loud songs are pulled down toward a target level.
function SoundLevelingCard() {
  const { playback } = usePlayer();
  return (
    <SettingsCard icon={<I.wave s={17} />} title={tr("settings.levelingTitle")}
      desc={tr("settings.levelingDesc")}>
      <SetRow label={tr("settings.normalizeLabel")}
        desc={tr("settings.normalizeDesc")}>
        <SetSwitch checked={playback.normalizeEnabled} onChange={playback.setNormalizeEnabled} />
      </SetRow>

      {playback.normalizeEnabled && (
        <SetRow label={tr("settings.targetLabel")} desc={tr("settings.targetDesc")}>
          <input className="tp-set-range" type="range" min={-30} max={-6} step={1}
            value={playback.targetLufs}
            onChange={(e) => playback.setTargetLufs(Number(e.target.value))} />
          <span className="tp-set-range-val">{playback.targetLufs} LUFS</span>
        </SetRow>
      )}
    </SettingsCard>
  );
}

/* ============================ SILENCE & SPACING ============================ */
// Trim dead air at the edges of each song, and add a short breath of silence
// between tracks. By default this shapes the live set only; the DJ can opt into
// applying it to library previews too. Gap is in seconds.
function fmtGap(sec) {
  if (!sec) return tr("settings.gapNone");
  return fmtSeconds(sec);
}
function SilenceSpacingCard() {
  const { playback } = usePlayer();
  return (
    <SettingsCard icon={<I.scissor s={16} />} title={tr("settings.silenceTitle")}
      desc={tr("settings.silenceDesc")}>
      <SetRow label={tr("settings.trimLabel")}
        desc={tr("settings.trimDesc")}>
        <SetSwitch checked={playback.trimSilenceEnabled} onChange={playback.setTrimSilenceEnabled} />
      </SetRow>

      <SetRow label={tr("settings.gapLabel")}
        desc={tr("settings.gapDesc")}>
        <input className="tp-set-range" type="range" min={0} max={8} step={0.5}
          value={playback.songGapSec}
          onChange={(e) => playback.setSongGapSec(Number(e.target.value))} />
        <span className="tp-set-range-val">{fmtGap(playback.songGapSec)}</span>
      </SetRow>

      <SetRow label={tr("settings.trimEverywhereLabel")}
        desc={tr("settings.trimEverywhereDesc")}>
        <SetSwitch checked={playback.trimEverywhere} onChange={playback.setTrimEverywhere} />
      </SetRow>
    </SettingsCard>
  );
}

/* ============================ LIBRARY ============================ */
// How songs read in the library list. "Song name only" reuses the Smart
// Organize title-parsing heuristics to hide the orchestra/singer/year cruft
// that's often baked into a title field — on display only, the stored
// metadata is never touched.
function LibraryDisplayCard({ t, setTweak }) {
  return (
    <SettingsCard icon={<I.spark s={16} />} title={tr("settings.libraryTitle")}
      desc={tr("settings.libraryDesc")}>
      <SetRow label={tr("settings.songNameOnlyLabel")} pill={tr("settings.beta")}
        desc={tr("settings.songNameOnlyDesc")}>
        <SetSwitch checked={!!t.songNameOnly} onChange={(v) => setTweak("songNameOnly", v)} />
      </SetRow>
      {t.songNameOnly && (
        <SetRow sub label={tr("settings.songNameOnlyCortinasLabel")}
          desc={tr("settings.songNameOnlyCortinasDesc")}>
          <SetSwitch checked={!!t.songNameOnlyCortinas} onChange={(v) => setTweak("songNameOnlyCortinas", v)} />
        </SetRow>
      )}
      <SetRow label={tr("settings.collapseLabel")}
        desc={tr("settings.collapseDesc")}>
        <SetSwitch checked={!!t.collapseFoldersByDefault} onChange={(v) => setTweak("collapseFoldersByDefault", v)} />
      </SetRow>
      <SetRow label={tr("settings.cortinasInFiltersLabel")}
        desc={tr("settings.cortinasInFiltersDesc")}>
        <SetSwitch checked={!!t.cortinasInFilters} onChange={(v) => setTweak("cortinasInFilters", v)} />
      </SetRow>
      {t.songNameOnly && (
        <div className="tp-set-note">
          {tr("settings.stripsIntro")}
          <div className="tp-set-strips">
            <span>{trx("settings.stripArtist", { i: (s) => <i>{s}</i> })}</span>
            <span>{trx("settings.stripTrackNo", { i: (s) => <i>{s}</i> })}</span>
            <span>{trx("settings.stripYear", { i: (s) => <i>{s}</i> })}</span>
            <span>{trx("settings.stripSinger", { i: (s) => <i>{s}</i> })}</span>
            <span><i>“(instrumental)”</i></span>
            <span>{trx("settings.stripGlued", { i: (s) => <i>{s}</i> })}</span>
          </div>
          {tr("settings.stripsOutro")}
        </div>
      )}
    </SettingsCard>
  );
}

/* ============================ ABOUT ============================ */
// App version + a friendly note, shown as a quiet footer below the cards (not in
// a card of its own). The version is read once from the main process (the
// packaged app's package.json) so it never drifts from the real build.
// Whether song edits also go into the files on disk. Off by default: nothing on
// the DJ's computer changes unless they ask. Flipping the switch here also
// counts as having answered the song editor's first-save question.
function MusicFilesCard({ t, setTweak }) {
  return (
    <SettingsCard icon={<I.folder s={16} />} title={tr("settings.filesTitle")}
      desc={tr("settings.filesDesc")}>
      <SetRow label={tr("settings.writeTagsLabel")} desc={tr("settings.writeTagsDesc")}>
        <SetSwitch checked={!!t.writeTagsToFiles}
          onChange={(v) => setTweak({ writeTagsToFiles: v, writeTagsAsked: true })} />
      </SetRow>
      <div className="tp-set-note">{tr("settings.writeTagsNote")}</div>
    </SettingsCard>
  );
}

function AboutFooter() {
  const [version, setVersion] = React.useState("");
  React.useEffect(() => {
    let alive = true;
    window.compas?.getAppVersion?.().then((v) => { if (alive) setVersion(v); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const open = (url) => (e) => { e.preventDefault(); window.compas?.openExternal?.(url); };

  return (
    <footer className="tp-about">
      <div className="tp-about-ver">Compás{version ? ` v${version}` : ""}</div>
      <div className="tp-about-signoff">
        {tr("settings.signoff")}
      </div>
      <div className="tp-about-note">
        {trx("settings.madeWith", {
          heart: <span className="tp-about-heart" aria-label={tr("settings.love")}>♥</span>,
          name: "Dimitris Lamprinos",
        })}
      </div>
      <div className="tp-about-note">
        {trx("settings.contact", {
          mail: <a href="mailto:pkakelas@gmail.com" onClick={open("mailto:pkakelas@gmail.com")}>pkakelas@gmail.com</a>,
          telegram: <a href="https://t.me/pkakelas" onClick={open("https://t.me/pkakelas")}>@pkakelas</a>,
        })}
      </div>
    </footer>
  );
}

/* ============================ SETTINGS VIEW ============================ */
function SettingsView({ t, setTweak, onReplayTour, onOpenCommunity }) {
  return (
    <div className="tv">
      <div className="tv-head">
        <div>
          <div className="tv-title">{tr("settings.title")}</div>
          <div className="tv-sub">{tr("settings.subtitle")}</div>
        </div>
      </div>

      <div className="tp-set-scroll">
        <div className="tp-set-col">
          <AudioOutputsCard />

          <ControllersCard />

          <MusicFilesCard t={t} setTweak={setTweak} />

          <SoundLevelingCard />

          <SilenceSpacingCard />

          <CortinaPlaybackCard />

          <LibraryDisplayCard t={t} setTweak={setTweak} />

          <CommunityAccountCard onOpenCommunity={onOpenCommunity} />

          <SettingsCard icon={<I.spark s={16} />} title={tr("settings.appearanceTitle")}
            desc={tr("settings.appearanceDesc")}>
            <SetRow label={tr("settings.languageLabel")} desc={tr("settings.languageDesc")}>
              <SetSelect value={I18N.locale} onChange={I18N.setLocale}
                options={I18N.LOCALES.map((l) => ({ value: l.id, label: l.name }))} />
            </SetRow>

            <SetRow label={tr("settings.themeLabel")} desc={tr("settings.themeDesc")}>
              <div className="tp-set-themes" role="radiogroup" aria-label={tr("settings.themeLabel")}>
                {THEMES.map((th) => (
                  <button key={th.id} type="button" role="radio" aria-checked={t.theme === th.id}
                    className="tp-set-theme" data-on={t.theme === th.id ? "1" : "0"}
                    onClick={() => setTweak("theme", th.id)}>
                    <span className={"tp-set-theme-pv " + th.id}>
                      <i className="bg" /><i className="card" /><i className="ac" /><i className="ln" />
                    </span>
                    <span className="tp-set-theme-lb"><th.icon s={14} />{tr(th.labelKey)}</span>
                    {t.theme === th.id && <span className="tp-set-theme-ck"><I.check s={13} /></span>}
                  </button>
                ))}
              </div>
            </SetRow>

            <SetRow label={tr("settings.textSizeLabel")}
              desc={tr("settings.textSizeDesc")}>
              <input className="tp-set-range" type="range" min={70} max={150} step={10}
                value={t.fontScale} onChange={(e) => setTweak("fontScale", Number(e.target.value))} />
              <span className="tp-set-range-val">{t.fontScale}%</span>
            </SetRow>

            <SetRow label={tr("settings.tandaLayoutLabel")}
              desc={tr("settings.tandaLayoutDesc")}>
              <div className="tv-viewtoggle labeled" role="group" aria-label={tr("settings.tandaLayoutLabel")}>
                <button type="button" className={"tv-vt" + ((t.tandaLayout || "grid") === "grid" ? " on" : "")}
                  onClick={() => setTweak("tandaLayout", "grid")}
                  title={tr("settings.layoutTabs")} aria-pressed={(t.tandaLayout || "grid") === "grid"}><I.grid s={15} /> {tr("settings.layoutTabs")}</button>
                <button type="button" className={"tv-vt" + (t.tandaLayout === "list" ? " on" : "")}
                  onClick={() => setTweak("tandaLayout", "list")}
                  title={tr("settings.layoutRows")} aria-pressed={t.tandaLayout === "list"}><I.rows s={15} /> {tr("settings.layoutRows")}</button>
              </div>
            </SetRow>
          </SettingsCard>

          {onReplayTour && (
            <SettingsCard icon={<I.play s={16} />} title={tr("settings.startTitle")}
              desc={tr("settings.startDesc")}>
              <SetRow label={tr("settings.tourLabel")}
                desc={tr("settings.tourDesc")}>
                <button className="tp-btn" onClick={onReplayTour}>{tr("settings.tourReplay")}</button>
              </SetRow>
            </SettingsCard>
          )}

          <AboutFooter />
        </div>
      </div>
    </div>
  );
}

// SettingsCard / SetRow are shared with the Community account card (community-view.jsx).
Object.assign(window, { SettingsView, SettingsCard, SetRow, ControllerOfferModal });
