// app-shell.jsx — top-level: top-nav switches Live · Tandas · Playlists · Settings
const { useState } = React;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "builderWidth": 380,
  "liveQueueWidth": 600,
  "playlistDockWidth": 452,
  "theme": "dark",
  "startView": "Tandas",
  "fontScale": 100,
  "tandaLayout": "grid",
  "songNameOnly": false,
  "collapseFoldersByDefault": false
}/*EDITMODE-END*/;

// Text size is a whole-app zoom (everything is sized in px, so scaling the page
// is the cleanest way to make the letters bigger/smaller). Kept in 10% steps
// between these bounds, driven by the Settings slider and the Cmd/Ctrl +/-/0
// shortcuts alike.
const FONT_SCALE_MIN = 70;
const FONT_SCALE_MAX = 150;
const FONT_SCALE_STEP = 10;
const clampFontScale = (n) => Math.max(FONT_SCALE_MIN, Math.min(FONT_SCALE_MAX, n));

// Watches the main process for a downloaded auto-update. Resolves to the pending
// update ({version, releaseNotes}) once one is ready, or null. It both subscribes
// to the live "downloaded" event and queries the current status on mount, so an
// update that finished downloading before this window painted is still caught.
function useUpdateNotice() {
  const [update, setUpdate] = React.useState(null);
  React.useEffect(() => {
    // Dev-only console helper (renderer is served over http only in dev): preview
    // the "update ready" modal without a real download —
    //   __previewUpdateModal({ version: "9.9.9" })   // show it
    //   __previewUpdateModal(null)                    // hide it
    if (location.protocol === "http:") window.__previewUpdateModal = setUpdate;
    if (!window.compas) return undefined;
    if (window.compas.getUpdateStatus) {
      window.compas.getUpdateStatus().then((u) => { if (u) setUpdate(u); }).catch(() => {});
    }
    if (window.compas.onUpdateDownloaded) {
      return window.compas.onUpdateDownloaded((u) => setUpdate(u));
    }
    return undefined;
  }, []);
  return [update, () => setUpdate(null)];
}

// "A new version is ready" modal. Restart installs the update; Later dismisses it
// (it still applies on the next normal quit). Reuses the shared tp-modal styles.
function UpdateModal({ update, onDismiss }) {
  const [installing, setInstalling] = React.useState(false);
  React.useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") { e.preventDefault(); onDismiss(); } };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onDismiss]);
  const restart = () => {
    setInstalling(true);
    if (window.compas && window.compas.installUpdate) window.compas.installUpdate();
  };
  return (
    <div className="tp-modal-scrim" onMouseDown={onDismiss}>
      <div className="tp-modal" role="alertdialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
        <div className="tp-modal-icon accent"><I.arrowDn s={20} /></div>
        <div className="tp-modal-title">Update ready</div>
        <div className="tp-modal-msg">
          Version {update.version} has been downloaded. Restart Compás to finish installing it.
        </div>
        <div className="tp-modal-actions">
          <button className="tp-modal-cancel" onClick={onDismiss} disabled={installing}>Later</button>
          <button className="tp-modal-confirm accent" onClick={restart} disabled={installing} autoFocus>
            <I.arrowDn s={14} /> {installing ? "Restarting…" : "Restart & update"}
          </button>
        </div>
      </div>
    </div>
  );
}

function AppShell() {
  // Seed the theme from the saved preference (default: dark) so the very first
  // render already matches what index.html painted — no flash, no restore race.
  const [t, setTweak] = useTweaks((() => {
    try {
      const seed = { ...TWEAK_DEFAULTS };
      const savedTheme = localStorage.getItem("compas.theme");
      if (savedTheme) seed.theme = savedTheme;
      const savedScale = parseInt(localStorage.getItem("compas.fontScale"), 10);
      if (!isNaN(savedScale)) seed.fontScale = clampFontScale(savedScale);
      const savedLayout = localStorage.getItem("compas.tandaView");
      if (savedLayout === "list" || savedLayout === "grid") seed.tandaLayout = savedLayout;
      seed.songNameOnly = localStorage.getItem("compas.songNameOnly") === "1";
      seed.collapseFoldersByDefault = localStorage.getItem("compas.collapseFoldersByDefault") === "1";
      return seed;
    } catch (e) { return TWEAK_DEFAULTS; }
  })());

  // Load the library + tandas from the database once on launch, and wire the
  // background-analysis banner to the main process's progress broadcasts.
  React.useEffect(() => { Store.loadAll(); Store.initAnalysis(); Store.initLibraryWatch(); }, []);

  // Apply the active theme to <html> and persist it across restarts.
  React.useEffect(() => {
    document.documentElement.dataset.theme = t.theme;
    localStorage.setItem("compas.theme", t.theme);
  }, [t.theme]);

  // Apply the chosen text size as native page zoom and persist it. The preload
  // already applied the saved value before first paint; this keeps it in sync as
  // the DJ changes it.
  React.useEffect(() => {
    const scale = clampFontScale(t.fontScale || 100);
    if (window.compas && window.compas.setTextZoom) window.compas.setTextZoom(scale / 100);
    try { localStorage.setItem("compas.fontScale", String(scale)); } catch (e) { /* ignore */ }
  }, [t.fontScale]);

  // Persist the tanda layout (tabs vs. big rows) so the Settings choice and the
  // in-view header toggle share one preference across restarts.
  React.useEffect(() => {
    try { localStorage.setItem("compas.tandaView", t.tandaLayout); } catch (e) { /* ignore */ }
  }, [t.tandaLayout]);

  // Persist the "song name only" library display preference so it survives
  // restarts and the seed read above can pick it up before first paint.
  React.useEffect(() => {
    try { localStorage.setItem("compas.songNameOnly", t.songNameOnly ? "1" : "0"); } catch (e) { /* ignore */ }
  }, [t.songNameOnly]);

  // Persist whether folder trees (Library + Builder) start collapsed, so the
  // preference survives restarts and the seed read above can pick it up.
  React.useEffect(() => {
    try { localStorage.setItem("compas.collapseFoldersByDefault", t.collapseFoldersByDefault ? "1" : "0"); } catch (e) { /* ignore */ }
  }, [t.collapseFoldersByDefault]);

  // Cmd/Ctrl +/-/0 come in as menu-driven IPC commands (the View ▸ Zoom items own
  // the accelerators on every platform). A ref holds the live scale so the
  // listener stays mounted once instead of re-subscribing on every change.
  const scaleRef = React.useRef(t.fontScale);
  scaleRef.current = t.fontScale;
  React.useEffect(() => {
    if (!window.compas || !window.compas.onZoomCommand) return undefined;
    return window.compas.onZoomCommand((dir) => {
      const cur = scaleRef.current || 100;
      const next = dir === "reset" ? 100
        : dir === "in" ? cur + FONT_SCALE_STEP
        : cur - FONT_SCALE_STEP;
      setTweak("fontScale", clampFontScale(next));
    });
  }, [setTweak]);

  // The player engine lives above every view so the transport bar stays mounted
  // and audible no matter which tab the DJ is on.
  return (
    <PlayerProvider>
      <AppBody t={t} setTweak={setTweak} />
    </PlayerProvider>
  );
}

function AppBody({ t, setTweak }) {
  const [view, setView] = useState(TWEAK_DEFAULTS.startView);
  const player = usePlayer();
  const [update, dismissUpdate] = useUpdateNotice();
  const [showOnboarding, dismissOnboarding, startOnboarding] = useOnboarding();

  // Play a playlist in place (marks the active song, like playing a tanda). It
  // deliberately does NOT switch to the Live tab or load the live queue — a
  // playlist only reaches the live queue via the explicit Import action there.
  const playPlaylist = (pl) => player.playPlaylist(pl.items);

  // All views stay mounted (hidden via display) so playback keeps running while
  // the DJ browses tandas/playlists. The transport bar is a sibling of the views
  // so it sits at the bottom on every tab.
  return (
    <div className="tp-app">
      <TopBar active={view} onNav={setView} />
      <AnalysisBanner />

      <div className="tp-view" style={{ display: view === "Live" ? undefined : "none" }}>
        <LivePlayer queueWidth={t.liveQueueWidth}
          onQueueWidthChange={(v) => setTweak("liveQueueWidth", v)} />
      </div>
      <div className="tp-view" style={{ display: view === "Library" ? undefined : "none" }}>
        <LibraryView />
      </div>
      <div className="tp-view" style={{ display: view === "Tandas" ? undefined : "none" }}>
        <TandasView builderWidth={t.builderWidth}
          onBuilderWidthChange={(v) => setTweak("builderWidth", v)}
          tandaLayout={t.tandaLayout}
          onTandaLayoutChange={(v) => setTweak("tandaLayout", v)} />
      </div>
      <div className="tp-view" style={{ display: view === "Playlists" ? undefined : "none" }}>
        <PlaylistsView onPlay={playPlaylist} dockWidth={t.playlistDockWidth}
          onDockWidthChange={(v) => setTweak("playlistDockWidth", v)} />
      </div>
      <div className="tp-view" style={{ display: view === "Settings" ? undefined : "none" }}>
        <SettingsView t={t} setTweak={setTweak} onReplayTour={startOnboarding} />
      </div>

      <PlayerBar />

      <PlaylistImportHost onDone={() => setView("Playlists")} />
      {update && <UpdateModal update={update} onDismiss={dismissUpdate} />}
      {showOnboarding && <OnboardingWizard onClose={dismissOnboarding} />}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<AppShell />);
