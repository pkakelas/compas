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
    if (res.ok) setNotice(tr("community.newCodeSent")); else setError(res.error);
  };

  const waitingOnGoogle = busy === "google";

  return (
    <div className="cm-scroll">
      <div className="cm-signin">
        <div className="cm-pitch">
          <div className="tp-eyebrow">{tr("common.nav.Community")}</div>
          <h1>{trx("community.pitchTitle", { em: (s) => <em>{s}</em> })}</h1>
          <p>{tr("community.pitchText")}</p>
          <div className="cm-points">
            <div className="cm-point">
              <div className="cm-point-ic"><I.note s={17} /></div>
              <div><b>{tr("community.pointBrowseTitle")}</b><span>{tr("community.pointBrowseText")}</span></div>
            </div>
            <div className="cm-point">
              <div className="cm-point-ic ok"><I.check s={17} /></div>
              <div><b>{tr("community.pointPlayTitle")}</b><span>{tr("community.pointPlayText")}</span></div>
            </div>
            <div className="cm-point">
              <div className="cm-point-ic acc"><I.heart s={17} /></div>
              <div><b>{tr("community.pointTalkTitle")}</b><span>{tr("community.pointTalkText")}</span></div>
            </div>
          </div>
          <div className="cm-private">
            <I.lock s={15} />
            <span>{tr("community.privateNote")}</span>
          </div>
        </div>

        <form className="cm-card" onSubmit={submit} noValidate>
          {mode === "confirm" ? (
            <>
              <div>
                <h2>{tr("community.checkEmailTitle")}</h2>
                <div className="cm-card-sub">{trx("community.checkEmailText", { email, b: (s) => <b>{s}</b> })}</div>
              </div>
              <div className="cm-field">
                <label htmlFor="cm-code">{tr("community.codeLabel")}</label>
                <input id="cm-code" className="cm-input cm-code" inputMode="numeric" autoComplete="one-time-code"
                  maxLength={8} value={code} autoFocus
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
              </div>
              {error && <div className="cm-error" role="alert">{error}</div>}
              {notice && <div className="cm-notice" role="status">{notice}</div>}
              <button type="submit" className="tp-btn primary lg block" disabled={!!busy || code.length < 6}>
                {busy === "form" ? tr("community.checking") : tr("community.confirmEmail")}
              </button>
              <div className="cm-switch">
                <button type="button" className="cm-link" onClick={resend} disabled={!!busy}>{tr("community.sendNewCode")}</button>
                {" · "}
                <button type="button" className="cm-link" onClick={() => go("signin")} disabled={!!busy}>{tr("community.backToSignIn")}</button>
              </div>
            </>
          ) : (
            <>
              <div>
                <h2>{mode === "signup" ? tr("community.signUpTitle") : tr("community.signInTitle")}</h2>
                <div className="cm-card-sub">{tr("community.noAccountNeeded")}</div>
              </div>

              <button type="button" className="cm-google" onClick={google} disabled={!!busy}>
                <span className="g" aria-hidden="true">G</span>
                {waitingOnGoogle ? tr("community.waitingGoogle") : tr("community.continueGoogle")}
              </button>
              {waitingOnGoogle && (
                <div className="cm-switch">
                  {tr("community.finishInBrowser")}{" "}
                  <button type="button" className="cm-link" onClick={() => CommunityStore.cancelSignIn()}>{tr("common.cancel")}</button>
                </div>
              )}

              <div className="cm-or">{tr("community.orEmail")}</div>

              <div className="cm-field">
                <label htmlFor="cm-email">{tr("community.email")}</label>
                <input id="cm-email" className="cm-input" type="email" autoComplete="email"
                  placeholder={tr("community.emailPh")} value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div className="cm-field">
                <label htmlFor="cm-pass">{tr("community.password")}</label>
                <input id="cm-pass" className="cm-input" type="password"
                  autoComplete={mode === "signup" ? "new-password" : "current-password"}
                  placeholder={mode === "signup" ? tr("community.passwordNewPh") : tr("community.passwordPh")}
                  value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>

              {error && <div className="cm-error" role="alert">{error}</div>}

              <button type="submit" className="tp-btn primary lg block" disabled={!!busy || !email.trim() || !password}>
                {busy === "form" ? (mode === "signup" ? tr("community.creatingAccount") : tr("community.signingIn"))
                  : (mode === "signup" ? tr("community.createAccount") : tr("community.signIn"))}
              </button>

              <div className="cm-switch">
                {mode === "signup" ? tr("community.haveAccount") : tr("community.newHere")}{" "}
                <button type="button" className="cm-link" disabled={!!busy}
                  onClick={() => go(mode === "signup" ? "signin" : "signup")}>
                  {mode === "signup" ? tr("community.signIn") : tr("community.createAnAccount")}
                </button>
              </div>
            </>
          )}
        </form>
      </div>
    </div>
  );
}

function CommunityView({ homeSignal, active }) {
  const community = useCommunity();
  if (!community.loaded || !community.configured) return <div className="tv" />;
  return community.user
    ? <CommunityFeed user={community.user} homeSignal={homeSignal} active={active} />
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
        <div className="tp-modal-title">{tr("community.deleteAccountTitle")}</div>
        <div className="tp-modal-msg">{tr("community.deleteAccountMsg")}</div>
        {error && <div className="cm-error" role="alert" style={{ marginTop: 12 }}>{error}</div>}
        <div className="tp-modal-actions">
          <button className="tp-modal-cancel" onClick={onCancel} disabled={busy} autoFocus>{tr("community.keepAccount")}</button>
          <button className="tp-modal-confirm danger" onClick={onConfirm} disabled={busy}>
            <I.trash s={14} /> {busy ? tr("community.deleting") : tr("community.deleteAccount")}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------- the profile form ----------
   The picture, name, handle, city and bio — what other DJs see. Edited in place
   on the DJ's own page in the Community tab, and in Settings ▸ Community. The
   picture changes as soon as one is picked; the words wait for "Save profile".
   `children` go at the end of the button row (Settings puts Sign out there). */
function CommunityProfileForm({ user, onSaved, onCancel, autoFocus, children }) {
  const [form, setForm] = React.useState({ displayName: "", handle: "", city: "", bio: "" });
  const [busy, setBusy] = React.useState(null); // "save" | "avatar" | null
  const [error, setError] = React.useState("");
  const [saved, setSaved] = React.useState(false);
  // The form can be on screen twice (Settings stays mounted behind the
  // Community tab), so each copy labels its own fields.
  const uid = "cm-acct-" + React.useId().replace(/:/g, "");

  // Re-seed the form whenever the stored profile changes (sign in, save). The
  // "Saved" confirmation is cleared only when the account itself changes — a
  // save updates the profile too, and must not wipe its own confirmation.
  const profileKey = [user.id, user.displayName, user.handle, user.city, user.bio].join("|");
  React.useEffect(() => {
    setForm({ displayName: user.displayName || "", handle: user.handle || "", city: user.city || "", bio: user.bio || "" });
  }, [profileKey]);
  React.useEffect(() => { setError(""); setSaved(false); }, [user.id]);

  const set = (k) => (e) => { setForm((f) => ({ ...f, [k]: e.target.value })); setSaved(false); };
  const dirty = form.displayName !== (user.displayName || "") || form.handle !== (user.handle || "")
    || form.city !== (user.city || "") || form.bio !== (user.bio || "");

  const save = async (e) => {
    e.preventDefault();
    if (busy || !dirty) return;
    setError(""); setBusy("save");
    const res = await CommunityStore.updateProfile({ displayName: form.displayName, handle: form.handle, city: form.city || null, bio: form.bio || null });
    setBusy(null);
    if (!res.ok) { setError(res.error); return; }
    setSaved(true);
    if (onSaved) onSaved();
  };
  // The picture: upload a photo, take the Google one, pick a drawn one, or
  // remove it (then the app picks a drawn one from the id).
  const setAvatar = async (value) => {
    if (busy) return;
    setError(""); setBusy("avatar");
    const res = await CommunityStore.avatarSet(value);
    setBusy(null);
    if (!res.ok) setError(res.error);
  };
  const pickPhoto = async () => {
    if (busy) return;
    setError(""); setBusy("avatar");
    const res = await CommunityStore.avatarPick();
    setBusy(null);
    if (!res.ok && !res.cancelled) setError(res.error);
  };
  const isPhoto = !!(user.avatar && /^https?:\/\//.test(user.avatar));
  const currentPreset = isPhoto ? -1 : communityPresetFor(user.id, user.avatar);

  return (
    <form className="cm-acct" onSubmit={save} noValidate
      onKeyDown={onCancel ? (e) => { if (e.key === "Escape" && !busy) { e.preventDefault(); onCancel(); } } : undefined}>
      <div className="cm-acct-avatar">
        <CommunityAvatar id={user.id} avatar={user.avatar} size="lg" />
        <div className="tp-flex1 cm-acct-avatar-main">
          <div className="cm-acct-avatar-title">{tr("community.profilePicture")}</div>
          <div className="cm-acct-avatar-btns">
            <button type="button" className="tp-btn sm" onClick={pickPhoto} disabled={!!busy}>
              {busy === "avatar" ? tr("community.saving") : tr("community.uploadPhoto")}
            </button>
            {user.googleAvatar && user.avatar !== user.googleAvatar && (
              <button type="button" className="tp-btn sm" onClick={() => setAvatar(user.googleAvatar)} disabled={!!busy}>{tr("community.useGooglePhoto")}</button>
            )}
            {isPhoto && (
              <button type="button" className="tp-btn sm ghost" onClick={() => setAvatar(null)} disabled={!!busy}>{tr("community.removePhoto")}</button>
            )}
          </div>
          <div className="cm-acct-presets" role="radiogroup" aria-label={tr("community.pickPicture")}>
            {Array.from({ length: CM_AVATAR_COUNT }, (_, k) => (
              <button type="button" role="radio" key={k} aria-checked={currentPreset === k} aria-label={tr("community.pictureN", { n: k + 1 })}
                className={"cm-preset" + (currentPreset === k ? " on" : "")} disabled={!!busy}
                onClick={() => setAvatar("preset:" + k)}><CommunityPresetArt k={k} /></button>
            ))}
          </div>
        </div>
      </div>
      <div className="cm-acct-fields">
        <div className="cm-field">
          <label htmlFor={uid + "-name"}>{tr("community.name")}</label>
          <input id={uid + "-name"} className="cm-input" maxLength={60} value={form.displayName} onChange={set("displayName")}
            autoFocus={autoFocus} />
        </div>
        <div className="cm-field">
          <label htmlFor={uid + "-handle"}>{tr("community.handle")}</label>
          <input id={uid + "-handle"} className="cm-input" maxLength={24} value={form.handle}
            autoCapitalize="none" spellCheck={false}
            onChange={(e) => { setForm((f) => ({ ...f, handle: e.target.value.toLowerCase() })); setSaved(false); }} />
        </div>
        <div className="cm-field">
          <label htmlFor={uid + "-city"}>{tr("community.city")} <span className="cm-opt">{tr("community.optional")}</span></label>
          <input id={uid + "-city"} className="cm-input" maxLength={60} value={form.city} onChange={set("city")} />
        </div>
        <div className="cm-field cm-acct-wide">
          <label htmlFor={uid + "-bio"}>{tr("community.aboutYou")} <span className="cm-opt">{tr("community.optional")}</span></label>
          <textarea id={uid + "-bio"} className="cm-input cm-textarea" rows={2} maxLength={280} value={form.bio} onChange={set("bio")}
            placeholder={tr("community.bioPh")} />
        </div>
      </div>
      <div className="tp-set-row-l"><div className="ds">{tr("community.profileVisible")}</div></div>
      {error && <div className="cm-error" role="alert">{error}</div>}
      <div className="cm-acct-actions">
        <button type="submit" className="tp-btn primary" disabled={!!busy || !dirty}>
          {busy === "save" ? tr("community.saving") : saved && !dirty ? tr("community.profileSaved") : tr("community.saveProfile")}
        </button>
        {onCancel && <button type="button" className="tp-btn" onClick={onCancel} disabled={busy === "save"}>{tr("common.cancel")}</button>}
        <span className="tp-spacer" />
        {children}
      </div>
    </form>
  );
}

function CommunityAccountCard({ onOpenCommunity }) {
  const community = useCommunity();
  const user = community.user;
  const [busy, setBusy] = React.useState(null); // "signout" | "delete" | null
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [deleteError, setDeleteError] = React.useState("");

  if (!community.configured) return null;

  const icon = <I.heart s={16} />;
  if (!user) {
    return (
      <SettingsCard icon={icon} title={tr("common.nav.Community")} desc={tr("community.cardDesc")}>
        <SetRow label={tr("community.accountLabel")} desc={tr("community.notSignedIn")}>
          <button className="tp-btn" onClick={onOpenCommunity}>{tr("community.signIn")}</button>
        </SetRow>
      </SettingsCard>
    );
  }

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
    <SettingsCard icon={icon} title={tr("common.nav.Community")}
      desc={user.email ? tr("community.signedInAs", { email: user.email }) : tr("community.signedIn")}>
      <CommunityProfileForm user={user}>
        <button type="button" className="tp-btn" onClick={signOut} disabled={!!busy}>
          {busy === "signout" ? tr("community.signingOut") : tr("community.signOut")}
        </button>
        <button type="button" className="tp-btn ghost cm-danger" onClick={() => { setDeleteError(""); setConfirmDelete(true); }} disabled={!!busy}>
          {tr("community.deleteAccountDots")}
        </button>
      </CommunityProfileForm>
      {confirmDelete && (
        <DeleteAccountModal busy={busy === "delete"} error={deleteError}
          onCancel={() => setConfirmDelete(false)} onConfirm={deleteAccount} />
      )}
    </SettingsCard>
  );
}

Object.assign(window, { CommunityView, CommunityAccountCard, CommunityProfileForm });
