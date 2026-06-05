// library-view.jsx — the Library workspace: the full folder/song tree, read-only.
// Same unified tree as the Tandas view, minus the builder (no add/drag). When the
// library is empty it invites the DJ to import their first folder.
const { useState } = React;

function LibraryEmpty({ onImport, busy }) {
  return (
    <div className="tv-manage">
      <div className="tv-empty-manage">
        <div className="ic"><I.folderOpen s={26} /></div>
        <h3>Your library is empty</h3>
        <p>Point Compás at your music folder — every orchestra, singer and era
          folder stays exactly where you put it. Nothing is moved or copied.</p>
        <button className="tv-save" style={{ width: 220, margin: "0 auto" }} onClick={onImport} disabled={busy}>
          <I.upload s={17} /> {busy ? "Opening picker…" : "Import folders"}
        </button>
      </div>
    </div>
  );
}

function LibraryView() {
  const { imported, totalSongs, totalFolders, roots } = useStore();
  const preview = usePlayer().preview;
  const { toast, flash, dismiss } = useToast();
  const [busy, setBusy] = useState(false);

  const addFolder = async () => {
    if (busy) return;
    const before = totalSongs;
    setBusy(true);
    let lib;
    try {
      lib = await Store.importLibrary();   // opens picker + scans, appends to library
    } catch (e) {
      setBusy(false);
      flash("Import failed. Please try again.");
      return;
    }
    setBusy(false);
    if (!lib) return;                       // cancelled
    const added = (lib.totalSongs || 0) - before;
    flash(added > 0
      ? `Added ${added} song${added === 1 ? "" : "s"} from a new folder`
      : "That folder is already in your library");
  };

  return (
    <div className="tv">
      <div className="tv-head">
        <div>
          <div className="tv-title">Library</div>
          <div className="tv-sub">
            {imported ? (
              <>
                <b>{totalSongs}</b> songs across <b>{totalFolders}</b> folders
                {roots && roots.length > 1 && <> in <b>{roots.length}</b> libraries</>}
              </>
            ) : "Import your music to browse it here"}
          </div>
        </div>
        {imported && (
          <div className="tv-head-r">
            <button className="tv-reimport" onClick={addFolder} disabled={busy} title="Import another folder into your library">
              <I.upload s={15} /> Add folder
            </button>
          </div>
        )}
      </div>

      {imported ? (
        <div className="tv-body">
          <LibraryTree library preview={preview} />
        </div>
      ) : (
        <LibraryEmpty onImport={addFolder} busy={busy} />
      )}

      <Toast toast={toast} onDismiss={dismiss} />
    </div>
  );
}

window.LibraryView = LibraryView;
