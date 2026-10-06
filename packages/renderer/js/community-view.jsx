// community-view.jsx — the Community tab. Signed out it is the sign-in screen
// (Google in the system browser, or email + password); signed in it is the
// feed (community-feed.jsx). Also the Settings ▸ Community account card.

/* ---------- sign in / create account / confirm email ---------- */
function CommunitySignIn() {
  // "signin" | "signup" | "confirm" (the 6-digit code emailed after sign-up)
  const [mode, setMode] = React.useState("signin");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [code, setCode] = React.useState("");
  const [busy, setBusy] = React.useState(null); // "google" | "form" | "resend" | null
  const [error, setError] = React.useState("");
  const [notice, setNotice] = React.useState("");

  const go = (next) => { setMode(next); setError(""); setNotice(""); setCode(""); };

  const google = async () => {
    if (busy) return;
    setError(""); setNotice(""); setBusy("google");
    const res = await CommunityStore.signInGoogle();
    setBusy(null);
    if (!res.ok && !res.cancelled) setError(res.error);
  };

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setError(""); setNotice(""); setBusy("form");
    const res = mode === "confirm" ? await CommunityStore.confirmSignUp(email, code)
      : mode === "signup" ? await CommunityStore.signUp(email, password)
      : await CommunityStore.signInPassword(email, password);
    setBusy(null);
    if (!res.ok) { setError(res.error); return; }
    // Signed in: the store has the user now and CommunityView swaps this screen
    // out. Otherwise the account exists but the email still needs confirming.
    if (res.pending === "confirm-email") { setPassword(""); go("confirm"); }
  };

  const resend = async () => {
    if (busy) return;
    setError(""); setNotice(""); setBusy("resend");
    const res = await CommunityStore.resendSignUpCode(email);
    setBusy(null);
    if (res.ok) setNotice("We sent a new code."); else setError(res.error);
  };

  const waitingOnGoogle = busy === "google";

  return (
    <div className="cm-scroll">
      <div className="cm-signin">
        <div className="cm-pitch">
          <div className="tp-eyebrow">Community</div>
          <h1>See what other DJs are <em>playing</em>.</h1>
          <p>Share the tandas you are proud of, and borrow ideas from the ones other people built.</p>
          <div className="cm-points">
            <div className="cm-point">
              <div className="cm-point-ic"><I.note s={17} /></div>
              <div><b>Browse shared tandas</b><span>Every tanda posted by the community, with the DJ’s own notes and tags.</span></div>
            </div>
            <div className="cm-point">
              <div className="cm-point-ic ok"><I.check s={17} /></div>
              <div><b>Know which ones you can play tonight</b><span>Each tanda is checked against your library, so you see the ones you fully own and the ones with songs missing.</span></div>
            </div>
            <div className="cm-point">
              <div className="cm-point-ic acc"><I.heart s={17} /></div>
              <div><b>Like, comment, save</b><span>Talk about the choices, and keep the ones you want to try in your own collection.</span></div>
            </div>
          </div>
          <div className="cm-private">
            <I.lock s={15} />
            <span>Sharing sends song details only. Your audio files never leave this computer.</span>
          </div>
        </div>

        <form className="cm-card" onSubmit={submit} noValidate>
          {mode === "confirm" ? (
            <>
              <div>
                <h2>Check your email</h2>
                <div className="cm-card-sub">We sent a 6-digit code to <b>{email}</b>. Enter it to finish creating your account.</div>
              </div>
              <div className="cm-field">
                <label htmlFor="cm-code">Confirmation code</label>
                <input id="cm-code" className="cm-input cm-code" inputMode="numeric" autoComplete="one-time-code"
                  maxLength={8} value={code} autoFocus
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
              </div>
              {error && <div className="cm-error" role="alert">{error}</div>}
              {notice && <div className="cm-notice" role="status">{notice}</div>}
              <button type="submit" className="tp-btn primary lg block" disabled={!!busy || code.length < 6}>
                {busy === "form" ? "Checking…" : "Confirm email"}
              </button>
              <div className="cm-switch">
                <button type="button" className="cm-link" onClick={resend} disabled={!!busy}>Send a new code</button>
                {" · "}
                <button type="button" className="cm-link" onClick={() => go("signin")} disabled={!!busy}>Back to sign in</button>
              </div>
            </>
          ) : (
            <>
              <div>
                <h2>{mode === "signup" ? "Create your account" : "Sign in to Community"}</h2>
                <div className="cm-card-sub">The rest of Compás keeps working without an account.</div>
              </div>

              <button type="button" className="cm-google" onClick={google} disabled={!!busy}>
                <span className="g" aria-hidden="true">G</span>
                {waitingOnGoogle ? "Waiting for Google in your browser…" : "Continue with Google"}
              </button>
              {waitingOnGoogle && (
                <div className="cm-switch">
                  Finish signing in in your browser, then come back here.{" "}
                  <button type="button" className="cm-link" onClick={() => CommunityStore.cancelSignIn()}>Cancel</button>
                </div>
              )}

              <div className="cm-or">or with email</div>

              <div className="cm-field">
                <label htmlFor="cm-email">Email</label>
                <input id="cm-email" className="cm-input" type="email" autoComplete="email"
                  placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div className="cm-field">
                <label htmlFor="cm-pass">Password</label>
                <input id="cm-pass" className="cm-input" type="password"
                  autoComplete={mode === "signup" ? "new-password" : "current-password"}
                  placeholder={mode === "signup" ? "At least 8 characters" : "Your password"}
                  value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>

              {error && <div className="cm-error" role="alert">{error}</div>}

              <button type="submit" className="tp-btn primary lg block" disabled={!!busy || !email.trim() || !password}>
                {busy === "form" ? (mode === "signup" ? "Creating account…" : "Signing in…")
                  : (mode === "signup" ? "Create account" : "Sign in")}
              </button>

              <div className="cm-switch">
                {mode === "signup" ? "Already have an account? " : "New here? "}
                <button type="button" className="cm-link" disabled={!!busy}
                  onClick={() => go(mode === "signup" ? "signin" : "signup")}>
                  {mode === "signup" ? "Sign in" : "Create an account"}
                </button>
              </div>
            </>
          )}
        </form>
      </div>
    </div>
  );
}

function CommunityView({ onOpenSettings, homeSignal, active }) {
  const community = useCommunity();
  if (!community.loaded || !community.configured) return <div className="tv" />;
  return community.user
    ? <CommunityFeed user={community.user} onOpenSettings={onOpenSettings} homeSignal={homeSignal} active={active} />
    : <div className="tv"><CommunitySignIn /></div>;
}

/* ---------- Settings ▸ Community account ---------- */
function DeleteAccountModal({ onCancel, onConfirm, busy, error }) {
  React.useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape" && !busy) { e.preventDefault(); onCancel(); } };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel, busy]);
  return (
    <div className="tp-modal-scrim" onMouseDown={busy ? undefined : onCancel}>
      <div className="tp-modal" role="alertdialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
        <div className="tp-modal-icon danger"><I.trash s={20} /></div>
        <div className="tp-modal-title">Delete your Community account?</div>
        <div className="tp-modal-msg">
          Your profile and everything you shared, liked or commented will be removed for good.
          Your library, tandas and playlists on this computer are not touched.
        </div>
        {error && <div className="cm-error" role="alert" style={{ marginTop: 12 }}>{error}</div>}
        <div className="tp-modal-actions">
          <button className="tp-modal-cancel" onClick={onCancel} disabled={busy} autoFocus>Keep account</button>
          <button className="tp-modal-confirm danger" onClick={onConfirm} disabled={busy}>
            <I.trash s={14} /> {busy ? "Deleting…" : "Delete account"}
          </button>
        </div>
      </div>
    </div>
  );
}

function CommunityAccountCard({ onOpenCommunity, jump }) {
  const community = useCommunity();
  const user = community.user;
  const formRef = React.useRef(null);
  const [form, setForm] = React.useState({ displayName: "", handle: "", city: "" });
  const [busy, setBusy] = React.useState(null); // "save" | "signout" | "delete" | null
  const [error, setError] = React.useState("");
  const [saved, setSaved] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [deleteError, setDeleteError] = React.useState("");

  // Re-seed the form whenever the stored profile changes (sign in, save). The
  // "Saved" confirmation is cleared only when the account itself changes — a
  // save updates the profile too, and must not wipe its own confirmation.
  const profileKey = user ? [user.id, user.displayName, user.handle, user.city].join("|") : "";
  React.useEffect(() => {
    if (user) setForm({ displayName: user.displayName || "", handle: user.handle || "", city: user.city || "" });
  }, [profileKey]);
  const userId = user ? user.id : "";
  React.useEffect(() => { setError(""); setSaved(false); }, [userId]);

  // Arriving from "Edit profile": bring this card to the top of Settings and
  // put the cursor in the name field. `jump` is a counter, 0 until first used.
  React.useEffect(() => {
    const form = formRef.current;
    if (!jump || !form) return;
    const card = form.closest(".tp-set-card") || form;
    card.scrollIntoView({ block: "start" });
    const input = form.querySelector("input");
    if (input) input.focus({ preventScroll: true });
  }, [jump]);

  if (!community.configured) return null;

  const icon = <I.heart s={16} />;
  if (!user) {
    return (
      <SettingsCard icon={icon} title="Community" desc="Share tandas and talk with other DJs.">
        <SetRow label="Community account" desc="You’re not signed in. The rest of Compás works without an account.">
          <button className="tp-btn" onClick={onOpenCommunity}>Sign in</button>
        </SetRow>
      </SettingsCard>
    );
  }

  const set = (k) => (e) => { setForm((f) => ({ ...f, [k]: e.target.value })); setSaved(false); };
  const dirty = form.displayName !== (user.displayName || "") || form.handle !== (user.handle || "")
    || form.city !== (user.city || "");

  const save = async (e) => {
    e.preventDefault();
    if (busy || !dirty) return;
    setError(""); setBusy("save");
    const res = await CommunityStore.updateProfile({ displayName: form.displayName, handle: form.handle, city: form.city || null });
    setBusy(null);
    if (res.ok) setSaved(true); else setError(res.error);
  };
  const signOut = async () => {
    if (busy) return;
    setBusy("signout");
    await CommunityStore.signOut();
    setBusy(null);
  };
  const deleteAccount = async () => {
    setDeleteError(""); setBusy("delete");
    const res = await CommunityStore.deleteAccount();
    setBusy(null);
    if (res.ok) setConfirmDelete(false); else setDeleteError(res.error);
  };

  return (
    <SettingsCard icon={icon} title="Community"
      desc={user.email ? `Signed in as ${user.email}` : "Signed in"}>
      <form className="cm-acct" ref={formRef} onSubmit={save} noValidate>
        <div className="cm-acct-fields">
          <div className="cm-field">
            <label htmlFor="cm-acct-name">Name</label>
            <input id="cm-acct-name" className="cm-input" maxLength={60} value={form.displayName} onChange={set("displayName")} />
          </div>
          <div className="cm-field">
            <label htmlFor="cm-acct-handle">Handle</label>
            <input id="cm-acct-handle" className="cm-input" maxLength={24} value={form.handle}
              autoCapitalize="none" spellCheck={false}
              onChange={(e) => { setForm((f) => ({ ...f, handle: e.target.value.toLowerCase() })); setSaved(false); }} />
          </div>
          <div className="cm-field">
            <label htmlFor="cm-acct-city">City <span className="cm-opt">(optional)</span></label>
            <input id="cm-acct-city" className="cm-input" maxLength={60} value={form.city} onChange={set("city")} />
          </div>
        </div>
        <div className="tp-set-row-l"><div className="ds">This is what other DJs see next to the tandas and comments you post.</div></div>
        {error && <div className="cm-error" role="alert">{error}</div>}
        <div className="cm-acct-actions">
          <button type="submit" className="tp-btn primary" disabled={!!busy || !dirty}>
            {busy === "save" ? "Saving…" : saved && !dirty ? "Saved" : "Save profile"}
          </button>
          <span className="tp-spacer" />
          <button type="button" className="tp-btn" onClick={signOut} disabled={!!busy}>
            {busy === "signout" ? "Signing out…" : "Sign out"}
          </button>
          <button type="button" className="tp-btn ghost cm-danger" onClick={() => { setDeleteError(""); setConfirmDelete(true); }} disabled={!!busy}>
            Delete account…
          </button>
        </div>
      </form>
      {confirmDelete && (
        <DeleteAccountModal busy={busy === "delete"} error={deleteError}
          onCancel={() => setConfirmDelete(false)} onConfirm={deleteAccount} />
      )}
    </SettingsCard>
  );
}

Object.assign(window, { CommunityView, CommunityAccountCard });
