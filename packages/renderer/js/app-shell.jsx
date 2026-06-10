// app-shell.jsx — top-level: top-nav switches Live · Tandas · Playlists · Settings
const { useState } = React;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "builderWidth": 380,
  "theme": "dark",
  "startView": "Tandas",
  "fontScale": 100
}/*EDITMODE-END*/;

// Text size is a whole-app zoom (everything is sized in px, so scaling the page
// is the cleanest way to make the letters bigger/smaller). Kept in 10% steps
// between these bounds, driven by the Settings slider and the Cmd/Ctrl +/-/0
// shortcuts alike.
const FONT_SCALE_MIN = 70;
const FONT_SCALE_MAX = 150;
const FONT_SCALE_STEP = 10;
const clampFontScale = (n) => Math.max(FONT_SCALE_MIN, Math.min(FONT_SCALE_MAX, n));

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

  const playPlaylist = (pl) => {
    player.loadPlaylist(pl.items);
    setView("Live");
  };

  // The builder and the saved-tandas collection are two top-level tabs now, but
  // they share one mounted TandasView so the builder's in-progress state never
  // gets thrown away when the DJ flips between them.
  const showTandas = view === "Builder" || view === "Tandas";

  // All views stay mounted (hidden via display) so playback keeps running while
  // the DJ browses tandas/playlists. The transport bar is a sibling of the views
  // so it sits at the bottom on every tab.
  return (
    <div className="tp-app">
      <TopBar active={view} onNav={setView} />
      <AnalysisBanner />

      <div className="tp-view" style={{ display: view === "Live" ? undefined : "none" }}>
        <LivePlayer />
      </div>
      <div className="tp-view" style={{ display: view === "Library" ? undefined : "none" }}>
        <LibraryView />
      </div>
      <div className="tp-view" style={{ display: showTandas ? undefined : "none" }}>
        <TandasView mode={view === "Builder" ? "build" : "manage"} onNavigate={setView}
          builderWidth={t.builderWidth}
          onBuilderWidthChange={(v) => setTweak("builderWidth", v)} />
      </div>
      <div className="tp-view" style={{ display: view === "Playlists" ? undefined : "none" }}>
        <PlaylistsView onPlay={playPlaylist} />
      </div>
      <div className="tp-view" style={{ display: view === "Settings" ? undefined : "none" }}>
        <SettingsView t={t} setTweak={setTweak} />
      </div>

      <PlayerBar />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<AppShell />);
