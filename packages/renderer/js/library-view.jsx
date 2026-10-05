// library-view.jsx — the Library workspace: the full folder/song tree, read-only.
// Same unified tree as the Tandas view, minus the builder (no add/drag). When the
// library is empty it invites the DJ to import their first folder.
const { useState, useEffect } = React;

// One-time nudge shown once a library exists, pointing first-time DJs at Smart
// Organize. Dismissal is remembered in localStorage so it never nags twice.
const SMART_ORG_TIP_KEY = "compas.smartOrgTipDismissed";

function SmartOrganizeTip({ onTry, onDismiss }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") { e.preventDefault(); onDismiss(); } };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onDismiss]);
  return (
    <div className="tp-modal-scrim" onMouseDown={onDismiss}>
      <div className="sotip" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
        <button className="sotip-x" onClick={onDismiss} title={tr("library.tipDismiss")}><I.x s={16} /></button>
        <div className="sotip-badge"><I.spark s={24} /></div>
        <div className="sotip-title">{tr("library.tipTitle")}</div>
        <div className="sotip-sub">{tr("library.tipSub")}</div>
        <div className="sotip-chips">
          <span>{tr("library.tipChipOrchestras")}</span><span>{tr("library.tipChipSingers")}</span><span>{tr("library.tipChipYears")}</span><span>{tr("library.tipChipStyles")}</span>
        </div>
        <div className="sotip-actions">
          <button className="tp-btn primary lg block" onClick={onTry}><I.spark s={15} /> {tr("library.tipTry")}</button>
          <span className="sotip-safe"><I.check s={13} /> {tr("library.tipSafe")}</span>
        </div>
      </div>
    </div>
  );
}

function LibraryView() {
  const { imported, totalSongs, totalFolders, roots, songs } = useStore();
  const preview = usePlayer().preview;
  const { toast, flash, dismiss } = useToast();
  const [organizing, setOrganizing] = useState(false);
  const [retypeRoots, setRetypeRoots] = useState(null);  // existing-library tree
  const [tipDismissed, setTipDismissed] = useState(() => localStorage.getItem(SMART_ORG_TIP_KEY) === "1");
  const dismissTip = () => { localStorage.setItem(SMART_ORG_TIP_KEY, "1"); setTipDismissed(true); };
  const imp = useFolderImport(flash);                     // shared import flow

  const openRetype = () => { if (songs && songs.length) setRetypeRoots(buildRetypeTree(songs)); };
  const doRetype = async (payload) => {
    setRetypeRoots(null);
    const { updates = [], cortinaOn = [], cortinaOff = [] } = payload || {};
    if (updates.length) await Store.setSongGenres(updates);
    if (cortinaOn.length) await Store.setSongCortina(cortinaOn, true);
    if (cortinaOff.length) await Store.setSongCortina(cortinaOff, false);
    const n = updates.length + cortinaOn.length + cortinaOff.length;
    if (n) flash(tr("library.updatedSongs", { count: n }));
  };

  return (
    <div className="tv">
      <div className="tv-head">
        <div>
          <div className="tv-title">{tr("library.title")}</div>
          {imported && (
            <div className="tv-sub">
              {roots && roots.length > 1
                ? trx("library.summaryLibraries", { songs: totalSongs, folders: totalFolders, libraries: roots.length, b: (s) => <b>{s}</b> })
                : trx("library.summary", { songs: totalSongs, folders: totalFolders, b: (s) => <b>{s}</b> })}
            </div>
          )}
        </div>
        {imported && (
          <div className="tv-head-r">
            <button className="tp-btn" onClick={openRetype} title={tr("library.setFolderGenresTitle")}>
              <I.folder s={15} /> {tr("library.setFolderGenres")}
            </button>
            <button className="tp-btn accent" onClick={() => setOrganizing(true)} title={tr("library.smartOrganizeTitle")}>
              <I.spark s={15} /> {tr("library.smartOrganize")}
            </button>
            <button className="tp-btn" onClick={imp.begin} disabled={imp.scanning} title={tr("library.addFolderTitle")}>
              <I.upload s={15} /> {imp.scanning ? tr("library.scanning") : tr("library.addFolder")}
            </button>
          </div>
        )}
      </div>

      {imported ? (
        <div className="tv-body">
          <LibraryTree library preview={preview} />
        </div>
      ) : (
        <ImportScreen />
      )}

      {imp.modal}
      {imported && !tipDismissed && !organizing && (
        <SmartOrganizeTip
          onTry={() => { setOrganizing(true); dismissTip(); }}
          onDismiss={dismissTip}
        />
      )}
      {retypeRoots && (
        <ImportTreeModal mode="retype" roots={retypeRoots} onCancel={() => setRetypeRoots(null)} onConfirm={doRetype} />
      )}

      {organizing && (
        <SmartOrganizeModal
          onClose={() => setOrganizing(false)}
          onApplied={(n) => flash(tr("library.updatedSongsSaved", { count: n }))}
        />
      )}

      <Toast toast={toast} onDismiss={dismiss} />
    </div>
  );
}

window.LibraryView = LibraryView;
