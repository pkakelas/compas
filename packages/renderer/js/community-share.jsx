// community-share.jsx — the "Share to Community" dialog, opened from a tanda
// card. It shows exactly what will be posted — the main process builds that
// preview — so the DJ sees the song details that leave the computer before
// anything is sent. (The feed's composer shares a tanda too, without a dialog.)
const SHARE_NOTE_MAX = 280;

function ShareTandaModal({ tanda, onClose, onShared }) {
  const community = useCommunity();
  const [includeTags, setIncludeTags] = React.useState(true);
  const [note, setNote] = React.useState("");
  const [preview, setPreview] = React.useState(null); // null = loading, else {ok, tanda} | {ok:false, error}
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape" && !busy) { e.preventDefault(); onClose(); } };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, busy]);

  React.useEffect(() => {
    if (!community.user) return undefined;
    let alive = true;
    setPreview(null);
    CommunityStore.sharePreview(tanda.id, includeTags).then((res) => { if (alive) setPreview(res); });
    return () => { alive = false; };
  }, [tanda.id, includeTags, !!community.user]);

  const share = async (e) => {
    e.preventDefault();
    if (busy || !preview || !preview.ok) return;
    setError(""); setBusy(true);
    const res = await CommunityStore.shareTanda(tanda.id, note.trim(), includeTags);
    setBusy(false);
    if (res.ok) onShared(res); else setError(res.error);
  };

  const shell = (children) => (
    <div className="tp-modal-scrim" onMouseDown={busy ? undefined : onClose}>
      <form className="cm-share" role="dialog" aria-modal="true" aria-labelledby="cm-share-title"
        onMouseDown={(e) => e.stopPropagation()} onSubmit={share} noValidate>
        <div className="cm-share-head">
          <div className="cm-share-ic"><I.upload s={18} /></div>
          <div className="tp-flex1">
            <h2 id="cm-share-title">{tr("community.shareTitle")}</h2>
            {community.user && (
              <div className="cm-share-sub">
                {trx("community.postingAs", {
                  name: community.user.displayName || (community.user.handle ? "@" + community.user.handle : tr("community.you")),
                  b: (s) => <b>{s}</b>,
                })}
              </div>
            )}
          </div>
          <button type="button" className="tv-tcbtn del" onClick={onClose} disabled={busy} aria-label={tr("community.close")}><I.x s={16} /></button>
        </div>
        {children}
      </form>
    </div>
  );

  // Signed out: sharing needs an account, and sign-in lives on the Community tab.
  if (!community.user) {
    return shell(
      <>
        <div className="cm-share-body">
          <div className="cm-notice">{tr("community.signInToShare")}</div>
        </div>
        <div className="cm-share-foot">
          <button type="button" className="tp-btn" onClick={onClose}>{tr("community.notNow")}</button>
          <button type="button" className="tp-btn primary" onClick={() => { navigateTo("Community"); onClose(); }}>{tr("community.goToSignIn")}</button>
        </div>
      </>
    );
  }

  const shared = preview && preview.ok ? preview.tanda : null;
  return shell(
    <>
      <div className="cm-share-body">
        {/* what gets posted */}
        <div className="cm-share-preview">
          {!preview && <div className="cm-share-loading">{tr("community.preparingPreview")}</div>}
          {preview && !preview.ok && <div className="cm-error" role="alert">{preview.error}</div>}
          {shared && (
            <>
              <div className="cm-share-preview-top">
                <div className="cm-post-tanda-name">{shared.name || shared.songs[0].orq}</div>
                <div className="cm-post-tanda-sub">
                  {[...new Set(shared.songs.map((s) => s.orq).filter(Boolean))].slice(0, 2).join(" · ") || tr("community.orchestraUnknown")}
                </div>
                {shared.tags.length > 0 && <div className="tv-tcard-tags"><TagPills tags={shared.tags} /></div>}
              </div>
              <div className="cm-post-songs">
                {shared.songs.map((s, i) => (
                  <div className="cm-post-song" key={i}>
                    <span className="n">{i + 1}</span>
                    <span className="t">{s.title}</span>
                    <span className="d">{s.year || ""}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="cm-field">
          <div className="cm-share-notehead">
            <label htmlFor="cm-share-note">{tr("community.addNote")} <span className="cm-opt">{tr("community.optional")}</span></label>
            <span className="tp-mono cm-share-count">{note.length} / {SHARE_NOTE_MAX}</span>
          </div>
          <textarea id="cm-share-note" className="cm-input cm-textarea" rows={3} maxLength={SHARE_NOTE_MAX}
            placeholder={tr("community.notePh")}
            value={note} onChange={(e) => setNote(e.target.value)} />
        </div>

        <label className="cm-check">
          <input type="checkbox" checked={includeTags} onChange={(e) => setIncludeTags(e.target.checked)} />
          {tr("community.includeTags")}
        </label>

        <div className="cm-share-private">
          <I.lock s={15} />
          <span>{trx("community.sharePrivate", { b: (s) => <b>{s}</b> })}</span>
        </div>

        {error && <div className="cm-error" role="alert">{error}</div>}
      </div>
      <div className="cm-share-foot">
        <button type="button" className="tp-btn" onClick={onClose} disabled={busy}>{tr("common.cancel")}</button>
        <button type="submit" className="tp-btn primary" disabled={busy || !shared}>
          <I.upload s={15} /> {busy ? tr("community.sharing") : tr("community.shareTanda")}
        </button>
      </div>
    </>
  );
}

Object.assign(window, { ShareTandaModal });
