// tandas-import.jsx — first-run import landing. The drop card uses the shared
// folder-import flow (useFolderImport): pick a folder → scan → the tree tool to
// set a style per folder → commit. Same flow as Library / Builder.
const { useState } = React;

function ImportScreen() {
  const [hot, setHot] = useState(false);
  // The first-run screen has no other feedback channel, so give the shared
  // import flow a toast for "nothing found" and failure messages.
  const { toast, flash, dismiss } = useToast();
  const imp = useFolderImport(flash);

  // A dropped folder, song or playlist file imports directly; anything else opens the folder picker.
  const onDrop = (e) => {
    e.preventDefault(); setHot(false);
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    const path = file && window.compas.pathForFile ? window.compas.pathForFile(file) : "";
    imp.begin(path || undefined);
  };

  if (imp.scanning) {
    return (
      <div className="tv-import">
        <div className="tv-scan">
          <div className="tv-scan-ic"><I.search s={26} /></div>
          <h2>Reading your library…</h2>
          <div className="tv-scan-count">Scanning every folder and reading tags — nothing is changed.</div>
          <div className="tv-scan-prog"><i style={{ width: "40%" }} className="indet" /></div>
        </div>
      </div>
    );
  }

  return (
    <div className="tv-import">
      <div>
        <div className={"tv-drop" + (hot ? " hot" : "")}
          onClick={imp.begin}
          onDragOver={(e) => { e.preventDefault(); setHot(true); }}
          onDragLeave={() => setHot(false)}
          onDrop={onDrop}>
          <div className="tv-drop-ic"><I.folderOpen s={36} /></div>
          <h2>Add your music</h2>
          <p>Nothing is moved or copied.</p>
          <div className="tv-drop-actions">
            <button className="cta" onClick={(e) => { e.stopPropagation(); imp.begin(); }}>
              <I.folder s={17} /> Choose a folder
            </button>
            <button className="cta secondary" onClick={(e) => { e.stopPropagation(); imp.beginPlaylist(); }}>
              <I.note s={17} /> Import a playlist
            </button>
          </div>
        </div>
        <div className="tv-assure">
          <div><I.check s={15} /> Your folders stay as they are</div>
          <div><I.check s={15} /> Playlists from VLC, Apple Music and DJ apps work</div>
        </div>
      </div>
      {imp.modal}
      <Toast toast={toast} onDismiss={dismiss} />
    </div>
  );
}

window.ImportScreen = ImportScreen;
