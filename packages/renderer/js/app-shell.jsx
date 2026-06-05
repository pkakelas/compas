// app-shell.jsx — top-level: top-nav switches Live · Tandas · Playlists · Settings
const { useState } = React;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "builderWidth": 380,
  "accent": "#BE2C3B",
  "startView": "Tandas"
}/*EDITMODE-END*/;

function AppShell() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);

  // Load the library + tandas from the database once on launch.
  React.useEffect(() => { Store.loadAll(); }, []);

  // live accent override from tweaks
  React.useEffect(() => {
    document.documentElement.style.setProperty("--accent", t.accent);
  }, [t.accent]);

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
