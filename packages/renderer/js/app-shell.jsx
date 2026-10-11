// app-shell.jsx — top-level: top-nav switches Live · Tandas · Playlists · Community · Settings
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
  "songNameOnlyCortinas": false,
  "collapseFoldersByDefault": false,
  "cortinasInFilters": false,
  "writeTagsToFiles": false,
  "writeTagsAsked": false
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
        <div className="tp-modal-title">{tr("common.updateReady")}</div>
        <div className="tp-modal-msg">
          {tr("common.updateDownloaded", { version: update.version })}
        </div>
        <div className="tp-modal-actions">
          <button className="tp-modal-cancel" onClick={onDismiss} disabled={installing}>{tr("common.updateLater")}</button>
          <button className="tp-modal-confirm accent" onClick={restart} disabled={installing} autoFocus>
            <I.arrowDn s={14} /> {installing ? tr("common.updateRestarting") : tr("common.updateRestart")}
          </button>
        </div>
      </div>
    </div>
  );
}

function AppShell() {
  // Strings are resolved at render time, so re-rendering from the root on a
  // language change retranslates every view in place — nothing remounts, and
  // playback carries on.
  I18N.useLocale();

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
      seed.songNameOnlyCortinas = localStorage.getItem("compas.songNameOnlyCortinas") === "1";
      seed.collapseFoldersByDefault = localStorage.getItem("compas.collapseFoldersByDefault") === "1";
      seed.cortinasInFilters = localStorage.getItem("compas.cortinasInFilters") === "1";
      seed.writeTagsToFiles = localStorage.getItem("compas.writeTagsToFiles") === "1";
      seed.writeTagsAsked = localStorage.getItem("compas.writeTagsAsked") === "1";
      return seed;
    } catch (e) { return TWEAK_DEFAULTS; }
  })());

  // Load the library + tandas from the database once on launch, and wire the
  // background-analysis banner to the main process's progress broadcasts.
  React.useEffect(() => { Store.loadAll(); Store.initAnalysis(); Store.initLibraryWatch(); }, []);

  // Read the Community sign-in state (a no-op in builds without Community).
  React.useEffect(() => { CommunityStore.init(); }, []);

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

  // Persist whether the song-name clean-up also touches cortinas (off by default).
  React.useEffect(() => {
    try { localStorage.setItem("compas.songNameOnlyCortinas", t.songNameOnlyCortinas ? "1" : "0"); } catch (e) { /* ignore */ }
  }, [t.songNameOnlyCortinas]);

  // Persist whether folder trees (Library + Builder) start collapsed, so the
  // preference survives restarts and the seed read above can pick it up.
  React.useEffect(() => {
    try { localStorage.setItem("compas.collapseFoldersByDefault", t.collapseFoldersByDefault ? "1" : "0"); } catch (e) { /* ignore */ }
  }, [t.collapseFoldersByDefault]);

  // Persist whether song edits are also written into the music files, and
  // whether the DJ has answered that question yet (the song editor asks once,
  // on the first save; Settings can change it any time).
  React.useEffect(() => {
    try { localStorage.setItem("compas.writeTagsToFiles", t.writeTagsToFiles ? "1" : "0"); } catch (e) { /* ignore */ }
  }, [t.writeTagsToFiles]);
  React.useEffect(() => {
    try { localStorage.setItem("compas.writeTagsAsked", t.writeTagsAsked ? "1" : "0"); } catch (e) { /* ignore */ }
  }, [t.writeTagsAsked]);

  // Let deeply nested UI (the song editor's first-save question) set a
  // preference without threading setTweak through every view.
  React.useEffect(() => { window.setAppTweak = setTweak; }, [setTweak]);

  // Persist whether cortinas show up in the library's filter dropdowns.
  React.useEffect(() => {
    try { localStorage.setItem("compas.cortinasInFilters", t.cortinasInFilters ? "1" : "0"); } catch (e) { /* ignore */ }
  }, [t.cortinasInFilters]);

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
  // Nested UI can ask for a tab ("Change" next to the song editor's save mode
  // opens Settings) via a window event, since the nav isn't threaded down.
  React.useEffect(() => {
    const onNav = (e) => { if (e.detail) setView(e.detail); };
    window.addEventListener("compas:nav", onNav);
    return () => window.removeEventListener("compas:nav", onNav);
  }, []);
  const player = usePlayer();
  const [update, dismissUpdate] = useUpdateNotice();
  const [showOnboarding, dismissOnboarding, startOnboarding] = useOnboarding();
  const community = useCommunity();
  // Any view can ask for a tab switch (e.g. "Sign in to share" → Community).
  React.useEffect(() => {
    const onNavigate = (e) => { if (typeof e.detail === "string") setView(e.detail); };
    window.addEventListener("compas:navigate", onNavigate);
    return () => window.removeEventListener("compas:navigate", onNavigate);
  }, []);
  // "Edit profile" (Community tab) opens Settings scrolled to the Community
  // card with the name field focused. The counter re-triggers it on every click.
  const [profileJump, setProfileJump] = useState(0);
  const openProfileSettings = () => { setView("Settings"); setProfileJump((n) => n + 1); };
  // Clicking Community in the top bar always lands on the general feed, even
  // if "My posts" or "Saved" was showing last time (or is showing now).
  const [feedHome, setFeedHome] = useState(0);
  // Someone who has never opened the Community tab gets a small "new" dot on
  // it — an honest pointer to a feature they haven't seen, not a made-up count.
  const [communitySeen, setCommunitySeen] = useState(() => {
    try { return localStorage.getItem("compas.communitySeen") === "1"; } catch (e) { return true; }
  });
  React.useEffect(() => {
    if (view !== "Community" || communitySeen) return;
    try { localStorage.setItem("compas.communitySeen", "1"); } catch (e) { /* ignore */ }
    setCommunitySeen(true);
  }, [view, communitySeen]);
  const navTo = (v) => { setView(v); if (v === "Community") setFeedHome((n) => n + 1); };

  // Play a playlist in place (marks the active song, like playing a tanda). It
  // deliberately does NOT switch to the Live tab or load the live queue — a
  // playlist only reaches the live queue via the explicit Import action there.
  const playPlaylist = (pl) => player.playPlaylist(pl.items);

  // All views stay mounted (hidden via display) so playback keeps running while
  // the DJ browses tandas/playlists. The transport bar is a sibling of the views
  // so it sits at the bottom on every tab.
  return (
    <div className="tp-app">
      {/* The bell opens the Community tab on its notifications. While a live
          set is locked it stays quiet: no count to pull the DJ's eye. */}
      <TopBar active={view} onNav={navTo} community={community.configured}
        communityNew={community.loaded && !community.user && !communitySeen}
        bell={community.user ? {
          count: player.locked ? 0 : community.unread,
          onOpen: () => { setView("Community"); CommunityStore.openNotifications(); },
        } : null} />
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
      {community.configured && (
        <div className="tp-view" style={{ display: view === "Community" ? undefined : "none" }}>
          <CommunityView onOpenSettings={openProfileSettings} homeSignal={feedHome} active={view === "Community"} />
        </div>
      )}
      <div className="tp-view" style={{ display: view === "Settings" ? undefined : "none" }}>
        <SettingsView t={t} setTweak={setTweak} onReplayTour={startOnboarding}
          onOpenCommunity={() => setView("Community")} communityJump={profileJump} />
      </div>

      <PlayerBar />

      <PlaylistImportHost onDone={() => setView("Playlists")} />
      {update && <UpdateModal update={update} onDismiss={dismissUpdate} />}
      {showOnboarding && <OnboardingWizard onClose={dismissOnboarding} />}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<AppShell />);
