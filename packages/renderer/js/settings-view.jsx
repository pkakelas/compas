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

function SetRow({ label, desc, children }) {
  return (
    <div className="tp-set-row">
      <div className="tp-set-row-l">
        <div className="lb">{label}</div>
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
      desc="Play the live set on one card while you pre-listen to other songs in headphones on a second card.">
      <SetRow label="Monitor / cueing" desc="Enable a separate headphone cue output.">
        <SetSwitch checked={dev.cueingEnabled} onChange={dev.setCueingEnabled} />
      </SetRow>

      {dev.cueingEnabled && (
        <React.Fragment>
          {dev.needsAccess && (
            <div className="tp-set-note">
              Grant access once so your output cards show their real names.
              <div className="tp-set-actions" style={{ marginTop: 9 }}>
                <button className="tp-set-btn primary" onClick={dev.requestAccess}>Allow audio device access</button>
              </div>
            </div>
          )}

          <SetRow label="Main (floor)" desc="Heard by the dancers.">
            <SetSelect value={dev.mainDeviceId} options={mainOpts} onChange={dev.setMainDeviceId} />
            <button className="tp-set-btn test" title="Play a test tone" onClick={() => playTestTone(dev.mainDeviceId)}>
              <I.vol s={15} />
            </button>
          </SetRow>

          <SetRow label="Monitor (cue)" desc="Your headphones / second card.">
            <SetSelect value={dev.monitorDeviceId} options={monitorOpts} onChange={dev.setMonitorDeviceId} />
            <button className="tp-set-btn test" title="Play a test tone" disabled={!dev.monitorDeviceId}
              onClick={() => dev.monitorDeviceId && playTestTone(dev.monitorDeviceId)}>
              <I.headphones s={15} />
            </button>
          </SetRow>

          {sameCard && (
            <div className="tp-set-warn">Monitor and main are the same card — previews will be audible on the floor.</div>
          )}
          {!dev.monitorDeviceId && (
            <div className="tp-set-note">Pick a monitor output to enable the headphone cue buttons.</div>
          )}

          <div className="tp-set-actions">
            <button className="tp-set-btn ghost" onClick={dev.refresh}>Refresh devices</button>
          </div>
        </React.Fragment>
      )}
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
function CortinaPlaybackCard() {
  const { playback } = usePlayer();
  return (
    <SettingsCard icon={<I.curtain s={17} />} title="Cortinas"
      desc="Control how cortinas play during a live set.">
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

/* ============================ SETTINGS VIEW ============================ */
function SettingsView({ t, setTweak }) {
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

          <SettingsCard icon={<I.scissor s={17} />} title="Tanda builder"
            desc="How the builder is laid out in the Builder view.">
            <SetRow label="Builder width">
              <input className="tp-set-range" type="range" min={300} max={640} step={10}
                value={t.builderWidth} onChange={(e) => setTweak("builderWidth", Number(e.target.value))} />
              <span className="tp-set-range-val">{t.builderWidth}px</span>
            </SetRow>
          </SettingsCard>

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
          </SettingsCard>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { SettingsView });
