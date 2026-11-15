// whats-new.jsx — the "What's new" note shown the first time a new version opens.
//
// The changelog lives here, newest first, in English (the dialog's title and
// button are translated; the notes themselves are not). Each item is either
//   - a plain string, for a one-line change:   "Faster library search",
//   - or { icon, title, text } for one worth a sentence of explanation.
// `icon` is any name from the I set in shared.jsx (default: spark); `text` is
// optional. Any number of items is fine — the list scrolls past about six.
//
// Releasing: the compas-release skill (.claude/skills/compas-release) drafts the
// entry from the commits since the last tag and adds it with the version bump.
// A version with no entry opens quietly, which is right for a release with only
// fixes nobody would notice.
const CHANGELOG = [
  // { version: "0.1.22", items: [
  //   { icon: "vol", title: "Scroll to change the volume", text: "Point at a volume and use the mouse wheel." },
  //   "Faster library search",
  // ] },
];

const LAST_SEEN_KEY = "compas.lastSeenVersion";

// Numeric compare of dotted versions ("0.1.10" > "0.1.9"). A pre-release suffix
// ("0.2.0-beta.1") is ignored, so a beta counts as the version it leads to.
function compareVersions(a, b) {
  const pa = String(a).split("-")[0].split(".").map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split("-")[0].split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

// The changelog entries a DJ moving from `from` to `to` hasn't seen: newer than
// the last version they opened, up to and including the one running now. Skipping
// a few releases shows all of them, newest first.
function changesBetween(from, to) {
  return CHANGELOG.filter((e) => compareVersions(e.version, to) <= 0
    && (from == null || compareVersions(e.version, from) > 0));
}

// Decides on launch whether to show the note. Returns the entries to show (or
// null) and a dismiss function that records the running version as seen.
//   - A fresh install gets the onboarding tour instead: the version is recorded
//     quietly, so the first update after it is the first "What's new".
//   - Someone who already had Compás before this note existed (tour seen, no
//     version on record) sees the current version's changes once.
function useWhatsNew() {
  const [state, setState] = React.useState(null); // { version, entries }
  React.useEffect(() => {
    // Dev-only console helper (renderer is served over http only in dev):
    //   __previewWhatsNew()           // everything in the changelog
    //   __previewWhatsNew("0.1.21")   // as if updating from 0.1.21
    //   __previewWhatsNew(null)       // hide it
    if (location.protocol === "http:") {
      window.__previewWhatsNew = (from) => {
        if (from === null || !CHANGELOG.length) { setState(null); return; }
        const entries = changesBetween(from || null, CHANGELOG[0].version);
        setState(entries.length ? { version: CHANGELOG[0].version, entries } : null);
      };
    }
    if (!window.compas || !window.compas.getAppVersion) return;
    let cancelled = false;
    // Read before the tour can close and set its flag.
    let tourSeen = false;
    let lastSeen = null;
    try {
      tourSeen = localStorage.getItem("compas.onboardingSeen") === "1";
      lastSeen = localStorage.getItem(LAST_SEEN_KEY);
    } catch (e) { return; }
    window.compas.getAppVersion().then((version) => {
      if (cancelled || !version) return;
      const remember = () => { try { localStorage.setItem(LAST_SEEN_KEY, version); } catch (e) { /* ignore */ } };
      if (lastSeen == null && !tourSeen) { remember(); return; } // fresh install
      if (lastSeen != null && compareVersions(version, lastSeen) <= 0) {
        if (lastSeen !== version) remember(); // went back a version — just follow it
        return;
      }
      // Upgraded (or the first launch since this note was added): show what
      // changed. With no previous version on record, only this one's changes.
      const entries = lastSeen != null
        ? changesBetween(lastSeen, version)
        : CHANGELOG.filter((e) => compareVersions(e.version, version) === 0);
      if (!entries.length) { remember(); return; }
      setState({ version, entries });
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);
  const dismiss = React.useCallback(() => {
    if (state) { try { localStorage.setItem(LAST_SEEN_KEY, state.version); } catch (e) { /* ignore */ } }
    setState(null);
  }, [state]);
  return [state, dismiss];
}

function WhatsNewModal({ version, entries, onDismiss }) {
  React.useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") { e.preventDefault(); onDismiss(); } };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onDismiss]);
  // Several releases at once get a heading each; one release needs none.
  const many = entries.length > 1;
  return (
    <div className="tp-modal-scrim" onMouseDown={onDismiss}>
      <div className="tp-modal wn-modal" role="dialog" aria-modal="true" aria-labelledby="wn-title"
        onMouseDown={(e) => e.stopPropagation()}>
        <div className="tp-modal-icon accent"><I.spark s={20} /></div>
        <div className="tp-modal-title" id="wn-title">{tr("changelog.title")}</div>
        <div className="tp-modal-msg">{tr("changelog.subtitle", { version })}</div>
        <div className="wn-body" lang="en">
          {entries.map((entry) => (
            <section key={entry.version} className="wn-release">
              {many && <div className="wn-version">{tr("changelog.version", { version: entry.version })}</div>}
              <ul className="wn-list">
                {entry.items.map((raw, i) => {
                  const item = typeof raw === "string" ? { title: raw } : raw;
                  const Icon = I[item.icon] || I.spark;
                  return (
                    <li key={i} className="wn-item">
                      <span className="wn-item-icon"><Icon s={15} /></span>
                      <span className="wn-item-body">
                        <span className="wn-item-title">{item.title}</span>
                        {item.text && <span className="wn-item-text">{item.text}</span>}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
        <div className="tp-modal-actions">
          <button className="tp-modal-confirm accent" onClick={onDismiss} autoFocus>{tr("changelog.gotIt")}</button>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { WhatsNewModal, useWhatsNew });
