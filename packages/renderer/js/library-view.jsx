// library-view.jsx — the Library workspace: the full folder/song tree, read-only.
// Same unified tree as the Tandas view, minus the builder (no add/drag). When the
// library is empty it invites the DJ to import their first folder.
const { useState } = React;

function LibraryView() {
  const { imported, totalSongs, totalFolders, roots, songs } = useStore();
  const preview = usePlayer().preview;
  const { toast, flash, dismiss } = useToast();
  const [organizing, setOrganizing] = useState(false);
  const [retypeRoots, setRetypeRoots] = useState(null);  // existing-library tree
  const imp = useFolderImport(flash);                     // shared import flow

  const openRetype = () => { if (songs && songs.length) setRetypeRoots(buildRetypeTree(songs)); };
  const doRetype = async (updates) => {
    setRetypeRoots(null);
    if (updates && updates.length) {
      await Store.setSongGenres(updates);
      flash(`Re-typed ${updates.length} song${updates.length === 1 ? "" : "s"}`);
    }
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
            <button className="tv-reimport" onClick={openRetype} title="Set tango / vals / milonga / cortina per folder">
              <I.folder s={15} /> Re-type folders
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
