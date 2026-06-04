// app-shell.jsx — top-level: top-nav switches Live ↔ Tandas; Tweaks toggles builder layout
const { useState: useSh } = React;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "builderLayout": "bench",
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
  const [view, setView] = useSh(TWEAK_DEFAULTS.startView);
  const player = usePlayer();

  const playPlaylist = (pl) => {
    player.loadPlaylist(pl.items);
    setView("Live");
  };

  // All views stay mounted (hidden via display) so playback keeps running while
  // the DJ browses tandas/playlists. The transport bar is a sibling of the views
  // so it sits at the bottom on every tab.
  return (
    <div className="tp-app">
      <TopBar active={view} onNav={setView} accent={t.accent} />

      <div className="tp-view" style={{ display: view === "Live" ? undefined : "none" }}>
        <LivePlayer />
      </div>
      <div className="tp-view" style={{ display: view === "Tandas" ? undefined : "none" }}>
        <TandasView layout={t.builderLayout} />
      </div>
      <div className="tp-view" style={{ display: view === "Playlists" ? undefined : "none" }}>
        <PlaylistsView onPlay={playPlaylist} />
      </div>

      <PlayerBar />

      <TweaksPanel>
        <TweakSection label="Tanda builder" />
        <TweakRadio label="Layout" value={t.builderLayout}
          options={["bench", "tray"]}
          onChange={(v) => setTweak("builderLayout", v)} />
        <div style={{ fontSize: 11.5, color: "var(--ink-2)", lineHeight: 1.45, margin: "-2px 2px 4px" }}>
          {t.builderLayout === "bench"
            ? "Bench — a fixed dock on the right with numbered slots."
            : "Tray — a staging strip pinned along the bottom."}
        </div>
        <TweakSection label="Appearance" />
        <TweakColor label="Accent" value={t.accent}
          options={["#BE2C3B", "#1F6FEB", "#0E7C66", "#8A4FD6", "#1A1714"]}
          onChange={(v) => setTweak("accent", v)} />
      </TweaksPanel>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<AppShell />);
