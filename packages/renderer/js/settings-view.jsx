// settings-view.jsx — the Settings page: audio output routing, builder layout,
// appearance. A proper routable view (not the floating tweak tray) so more
// settings can be added over time.

const THEMES = [
  { id: "light", label: "Light", icon: (p) => <I.sun {...p} /> },
  { id: "dark", label: "Dark", icon: (p) => <I.moon {...p} /> },
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

function SetRow({ label, desc, pill, children }) {
  return (
    <div className="tp-set-row">
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
  const outOpts = dev.outputs.map((o) => ({ value: o.deviceId, label: o.label || ("Output " + o.deviceId.slice(0, 4)) }));
  const mainOpts = [{ value: "", label: "System default" }, ...outOpts];
  const monitorOpts = [{ value: "", label: "Choose output…" }, ...outOpts];
  const sameCard = dev.cueingEnabled && dev.monitorDeviceId && dev.monitorDeviceId === dev.mainDeviceId;

  return (
    <SettingsCard icon={<I.headphones s={18} />} title="Audio outputs"
      desc="Choose which card plays the live set. Optionally add a separate headphone card to pre-listen to other songs.">
      {dev.needsAccess && (
        <div className="tp-set-note">
          Grant access once so your output cards show their real names.
          <div className="tp-set-actions" style={{ marginTop: 9 }}>
            <button className="tp-btn primary sm" onClick={dev.requestAccess}>Allow audio device access</button>
          </div>
        </div>
      )}

      <SetRow label="Main (floor)" desc="Heard by the dancers.">
        <SetSelect value={dev.mainDeviceId} options={mainOpts} onChange={dev.setMainDeviceId} />
        <button className="tp-btn sm square" title="Play a test tone" onClick={() => playTestTone(dev.mainDeviceId)}>
          <I.vol s={15} />
        </button>
      </SetRow>

      <SetRow label="Pre-listen" desc="Enable a separate headphone output for pre-listening.">
        <SetSwitch checked={dev.cueingEnabled} onChange={dev.setCueingEnabled} />
      </SetRow>

      {dev.cueingEnabled && (
        <React.Fragment>
          <SetRow label="Pre-listen output" desc="Your headphones / second card.">
            <SetSelect value={dev.monitorDeviceId} options={monitorOpts} onChange={dev.setMonitorDeviceId} />
            <button className="tp-btn sm square" title="Play a test tone" disabled={!dev.monitorDeviceId}
              onClick={() => dev.monitorDeviceId && playTestTone(dev.monitorDeviceId)}>
              <I.headphones s={15} />
            </button>
          </SetRow>

          {sameCard && (
            <div className="tp-set-warn">Pre-listen and main are the same card — previews will be audible on the floor.</div>
          )}
          {!dev.monitorDeviceId && (
            <div className="tp-set-note">Pick a pre-listen output to enable the headphone buttons.</div>
          )}
          {dev.monitorDeviceId && !sameCard && (
            <div className="tp-set-note">
              The play buttons in your library turn into a blue headphone
              {" "}<span style={{ color: "var(--cue)", verticalAlign: "-2px", display: "inline-block" }}><I.headphones s={14} /></span>.
              {" "}Click one and that track plays only on your pre-listen card — the dancers on the floor won't hear it.
            </div>
          )}
        </React.Fragment>
      )}

      <div className="tp-set-actions">
        <button className="tp-btn ghost sm" onClick={dev.refresh}>Refresh devices</button>
      </div>
    </SettingsCard>
  );
}

/* ============================ CORTINA PLAYBACK ============================ */
// Let the DJ play only the first few seconds of every cortina, then auto-fade to
// the next tanda — handy when cortinas are just a floor-clearing cue, not a song.
function fmtSnippetLen(sec) {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s ? `${m}m ${s}s` : `${m}m`;
}
function fmtFade(sec) {
  if (!sec) return "Instant";
  return Number.isInteger(sec) ? `${sec}s` : `${sec.toFixed(1)}s`;
}
function CortinaPlaybackCard() {
  const { playback } = usePlayer();
  return (
    <SettingsCard icon={<I.curtain s={17} />} title="Cortinas"
      desc="Control how cortinas play during a live set.">
      <div className="tp-set-note">
        These settings only affect cortinas — the songs in between tandas. The
        snippet cut-off and fade out never apply to the tanda songs themselves.
      </div>
      <SetRow label="Play only the first seconds"
        desc="Play a short snippet of each cortina, then fade to the next tanda automatically.">
        <SetSwitch checked={playback.cortinaSnippetEnabled} onChange={playback.setCortinaSnippetEnabled} />
      </SetRow>

      {playback.cortinaSnippetEnabled && (
        <SetRow label="Snippet length" desc="How long the cortina plays before fading.">
          <input className="tp-set-range" type="range" min={3} max={300} step={1}
            value={playback.cortinaSnippetSec}
            onChange={(e) => playback.setCortinaSnippetSec(Number(e.target.value))} />
          <span className="tp-set-range-val">{fmtSnippetLen(playback.cortinaSnippetSec)}</span>
        </SetRow>
      )}

      <SetRow label="Fade out"
        desc="How long the cortina takes to fade into the next tanda, for both the auto-fade and the “Fade to next tanda” button.">
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
    <SettingsCard icon={<I.wave s={17} />} title="Sound leveling"
      desc="Even out volume across songs. Applied from a one-time background analysis of your library.">
      <SetRow label="Normalize volume"
        desc="Pull loud songs down toward a consistent level so tandas don’t jump in volume.">
        <SetSwitch checked={playback.normalizeEnabled} onChange={playback.setNormalizeEnabled} />
      </SetRow>

      {playback.normalizeEnabled && (
        <SetRow label="Target loudness" desc="Where songs are leveled to. Lower is quieter; raise the master to taste.">
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
  if (!sec) return "None";
  return Number.isInteger(sec) ? `${sec}s` : `${sec.toFixed(1)}s`;
}
function SilenceSpacingCard() {
  const { playback } = usePlayer();
  return (
    <SettingsCard icon={<I.scissor s={16} />} title="Silence &amp; spacing"
      desc="Trim dead air at the start and end of each song and add a breath between tracks during a live set.">
      <SetRow label="Trim silence"
        desc="Skip complete silence at the very start and end of each song.">
        <SetSwitch checked={playback.trimSilenceEnabled} onChange={playback.setTrimSilenceEnabled} />
      </SetRow>

      <SetRow label="Gap between songs"
        desc="A short pause inserted before the next track plays in the live set.">
        <input className="tp-set-range" type="range" min={0} max={8} step={0.5}
          value={playback.songGapSec}
          onChange={(e) => playback.setSongGapSec(Number(e.target.value))} />
        <span className="tp-set-range-val">{fmtGap(playback.songGapSec)}</span>
      </SetRow>

      <SetRow label="Apply to library previews"
        desc="By default trimming shapes the live set only. Turn on to also trim when you preview a song from your library.">
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
    <SettingsCard icon={<I.spark s={16} />} title="Library display"
      desc="Tidy how song titles read across Compás.">
      <SetRow label="Show song name only" pill="Beta"
        desc="Hide the orchestra, singer and year that are sometimes baked into a song’s title, leaving just the song name — everywhere songs appear: library, tandas, playlists and the live queue. The orchestra and singer still show on the line below.">
        <SetSwitch checked={!!t.songNameOnly} onChange={(v) => setTweak("songNameOnly", v)} />
      </SetRow>
      {t.songNameOnly && (
        <div className="tp-set-note">
          Strips, on display only, the kinds of clutter that creep into title tags:
          <div className="tp-set-strips">
            <span>Leading artist <i>“Di Sarli – ”</i></span>
            <span>Track numbers <i>“07. ”</i></span>
            <span>Years <i>“1944”</i></span>
            <span>Singer credits <i>“(Rufino)”</i></span>
            <span><i>“(instrumental)”</i></span>
            <span>Glued singer <i>“-Héctor Mauré”</i></span>
          </div>
          Best-effort heuristics — a few oddly-tagged titles may not clean up perfectly. Your files and saved metadata are never changed.
        </div>
      )}
    </SettingsCard>
  );
}

/* ============================ ABOUT ============================ */
// App version + a friendly note, shown as a quiet footer below the cards (not in
// a card of its own). The version is read once from the main process (the
// packaged app's package.json) so it never drifts from the real build.
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
        Built for the people who make the night — the DJs spinning, the dancers
        in the ronda, everyone who keeps the floor alive. With all my heart. Enjoy.
      </div>
      <div className="tp-about-note">
        Made with <span className="tp-about-heart" aria-label="love">♥</span> by Dimitris Lamprinos
      </div>
      <div className="tp-about-note">
        Bugs or suggestions? Reach out at{" "}
        <a href="mailto:pkakelas@gmail.com" onClick={open("mailto:pkakelas@gmail.com")}>pkakelas@gmail.com</a>
        {" "}or on Telegram{" "}
        <a href="https://t.me/pkakelas" onClick={open("https://t.me/pkakelas")}>@pkakelas</a>
      </div>
    </footer>
  );
}

/* ============================ SETTINGS VIEW ============================ */
function SettingsView({ t, setTweak, onReplayTour }) {
  return (
    <div className="tv">
      <div className="tv-head">
        <div>
          <div className="tv-title">Settings</div>
          <div className="tv-sub">Audio routing, builder layout &amp; appearance</div>
        </div>
      </div>

      <div className="tp-set-scroll">
        <div className="tp-set-col">
          <AudioOutputsCard />

          <SoundLevelingCard />

          <SilenceSpacingCard />

          <CortinaPlaybackCard />

          <LibraryDisplayCard t={t} setTweak={setTweak} />

          <SettingsCard icon={<I.spark s={16} />} title="Appearance"
            desc="Choose how Compás looks.">
            <SetRow label="Theme" desc="Switch between the light and dark colour schemes.">
              <div className="tp-set-themes" role="radiogroup" aria-label="Theme">
                {THEMES.map((th) => (
                  <button key={th.id} type="button" role="radio" aria-checked={t.theme === th.id}
                    className="tp-set-theme" data-on={t.theme === th.id ? "1" : "0"}
                    onClick={() => setTweak("theme", th.id)}>
                    <span className={"tp-set-theme-pv " + th.id}>
                      <i className="bg" /><i className="card" /><i className="ac" /><i className="ln" />
                    </span>
                    <span className="tp-set-theme-lb"><th.icon s={14} />{th.label}</span>
                    {t.theme === th.id && <span className="tp-set-theme-ck"><I.check s={13} /></span>}
                  </button>
                ))}
              </div>
            </SetRow>

            <SetRow label="Text size"
              desc="Make everything in the app larger or smaller. Also adjustable with ⌘/Ctrl + and −.">
              <input className="tp-set-range" type="range" min={70} max={150} step={10}
                value={t.fontScale} onChange={(e) => setTweak("fontScale", Number(e.target.value))} />
              <span className="tp-set-range-val">{t.fontScale}%</span>
            </SetRow>

            <SetRow label="Tanda layout"
              desc="Show your saved tandas as compact tabs or as full-width big rows.">
              <div className="tv-viewtoggle labeled" role="group" aria-label="Tanda layout">
                <button type="button" className={"tv-vt" + ((t.tandaLayout || "grid") === "grid" ? " on" : "")}
                  onClick={() => setTweak("tandaLayout", "grid")}
                  title="Tabs" aria-pressed={(t.tandaLayout || "grid") === "grid"}><I.grid s={15} /> Tabs</button>
                <button type="button" className={"tv-vt" + (t.tandaLayout === "list" ? " on" : "")}
                  onClick={() => setTweak("tandaLayout", "list")}
                  title="Big rows" aria-pressed={t.tandaLayout === "list"}><I.rows s={15} /> Big rows</button>
              </div>
            </SetRow>
          </SettingsCard>

          {onReplayTour && (
            <SettingsCard icon={<I.play s={16} />} title="Getting started"
              desc="New here, or just want a refresher?">
              <SetRow label="Feature tour"
                desc="Replay the welcome walkthrough of everything Compás can do.">
                <button className="tp-btn" onClick={onReplayTour}>Replay tour</button>
              </SetRow>
            </SettingsCard>
          )}

          <AboutFooter />
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { SettingsView });
