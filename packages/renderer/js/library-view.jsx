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
        <button className="sotip-x" onClick={onDismiss} title="Dismiss"><I.x s={16} /></button>
        <div className="sotip-badge"><I.spark s={24} /></div>
        <div className="sotip-title">Tidy up your library</div>
        <div className="sotip-sub">Smart Organize fills in what’s missing, matched against a tango catalogue:</div>
        <div className="sotip-chips">
          <span>Orchestras</span><span>Singers</span><span>Years</span><span>Styles</span>
        </div>
        <div className="sotip-actions">
          <button className="sotip-go" onClick={onTry}><I.spark s={15} /> Try it</button>
          <span className="sotip-safe"><I.check s={13} /> You approve every change first</span>
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
    if (n) flash(`Updated ${n} song${n === 1 ? "" : "s"}`);
  };

  return (
    <div className="tv">
      <div className="tv-head">
        <div>
          <div className="tv-title">Library</div>
          {imported && (
            <div className="tv-sub">
              <b>{totalSongs}</b> songs across <b>{totalFolders}</b> folders
              {roots && roots.length > 1 && <> in <b>{roots.length}</b> libraries</>}
            </div>
          )}
        </div>
        {imported && (
          <div className="tv-head-r">
            <button className="tv-reimport" onClick={openRetype} title="Set the genre (and cortinas) for each folder">
              <I.folder s={15} /> Set folder genres
            </button>
            <button className="tv-smartorg" onClick={() => setOrganizing(true)} title="Clean up orchestras, singers, years & styles — review before anything changes">
              <I.spark s={15} /> Smart Organize
            </button>
            <button className="tv-reimport" onClick={imp.begin} disabled={imp.scanning} title="Import another folder into your library">
              <I.upload s={15} /> {imp.scanning ? "Scanning…" : "Add folder"}
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
          onApplied={(n) => flash(`Updated ${n} song${n === 1 ? "" : "s"} — saved in Compás`)}
        />
      )}

      <Toast toast={toast} onDismiss={dismiss} />
    </div>
  );
}

window.LibraryView = LibraryView;
