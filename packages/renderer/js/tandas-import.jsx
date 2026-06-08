// tandas-import.jsx — first-run import landing. The drop card uses the shared
// folder-import flow (useFolderImport): pick a folder → scan → the tree tool to
// set a style per folder → commit. Same flow as Library / Builder.
const { useState } = React;

function ImportScreen() {
  const [hot, setHot] = useState(false);
  const imp = useFolderImport();

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
          onDrop={(e) => { e.preventDefault(); setHot(false); imp.begin(); }}>
          <div className="tv-drop-ic"><I.folderOpen s={36} /></div>
          <h2>Choose your music folder</h2>
          <p>Compás reads it exactly as you’ve organised it — then you set what each
            folder is (tango, vals, milonga, cortina…). Nothing is moved or copied.</p>
          <button className="cta" onClick={(e) => { e.stopPropagation(); imp.begin(); }}>
            <I.upload s={17} /> Choose a folder…
          </button>
          <div className="note">A native folder picker will open</div>
        </div>
        <div className="tv-assure">
          <div><I.check s={15} /> Nothing is moved, renamed or copied</div>
          <div><I.check s={15} /> Your folder tree is kept intact</div>
          <div><I.check s={15} /> Set tango / vals / milonga / cortina per folder</div>
        </div>
      </div>
      {imp.modal}
    </div>
  );
}

window.ImportScreen = ImportScreen;
