// community-data.jsx — Compás Community account state, shared by the top bar,
// the Community view and Settings. The main process owns the session and does
// all the network work; this just mirrors `{configured, user}` and forwards
// actions. Every action resolves to `{ok: true, state}` or `{ok: false, error}`
// so callers can show the message as-is: the main process sends a message key
// (communityErrors.*), and it is worded here, in the DJ's language.
// `feedVersion` ticks whenever something was posted or removed, so an open feed
// knows to reload. `justPosted` is the post the DJ has just made here
// ({id, n}; `n` counts, so each post is news), which the feed shows first.
// `unread` is the number of new notifications (the bell in the top bar);
// `openNotifications` ticks when the bell is clicked, so the Community tab
// knows to show them.
let _cmState = { loaded: false, configured: false, user: null, feedVersion: 0, justPosted: null, unread: 0, openNotifications: 0 };
const _cmSubs = new Set();
let _cmUnsub = null;

function _cmSet(next) {
  _cmState = { ..._cmState, ...next };
  _cmSubs.forEach((fn) => fn());
}
function _cmApply(s) {
  if (!s) return;
  const was = _cmState.user && _cmState.user.id;
  _cmSet({ loaded: true, configured: !!s.configured, user: s.user || null });
  const now = _cmState.user && _cmState.user.id;
  // A different account (or none): its notifications, not the last one's, and
  // its own "Shared" markers on the tandas.
  if (now !== was) {
    if (now) _cmRefreshUnread(); else _cmSet({ unread: 0 });
    if (window.Store && Store.reloadTandas) Store.reloadTandas();
  }
}
function _cmApi() { return window.compas && window.compas.community; }

// A failed result's message, in words: keys from the main process are
// translated (with their `errorVars`); anything else is left as it is.
function _cmWorded(res) {
  if (!res || res.ok !== false || typeof res.error !== "string" || !res.error.startsWith("communityErrors.")) return res;
  return { ...res, error: tr(res.error, res.errorVars) };
}
const _cmFailed = () => _cmWorded({ ok: false, error: "communityErrors.somethingWrong" });

async function _cmCall(name, ...args) {
  const api = _cmApi();
  if (!api || !api[name]) return _cmFailed();
  try {
    const res = await api[name](...args);
    if (res && res.ok) _cmApply(res.state);
    return res ? _cmWorded(res) : _cmFailed();
  } catch (e) {
    return _cmFailed();
  }
}

// How often the bell's count is refreshed while the window is in view.
const CM_UNREAD_POLL_MS = 60000;
let _cmUnreadTimer = null;
async function _cmRefreshUnread() {
  if (!_cmState.user || document.visibilityState !== "visible") return;
  const res = await _cmData("notificationsUnread");
  // A backend without notifications yet simply has none to count.
  if (res.ok) _cmSet({ unread: res.unread });
}

// Feed and sharing calls carry data rather than sign-in state, so their results
// are handed back untouched.
async function _cmData(name, ...args) {
  const api = _cmApi();
  if (!api || !api[name]) return _cmFailed();
  try {
    const res = await api[name](...args);
    return res ? _cmWorded(res) : _cmFailed();
  } catch (e) {
    return _cmFailed();
  }
}
// Sharing, unsharing and deleting a post change which of the DJ's tandas are
// marked "Shared": the main process returns the fresh list with the result.
async function _cmDataTandas(name, ...args) {
  const res = await _cmData(name, ...args);
  if (res.ok) {
    if (res.tandas) Store.setTandasLocal(res.tandas);
    _cmSet({ feedVersion: _cmState.feedVersion + 1 });
  }
  return res;
}

function _cmPosted(id) {
  if (id) _cmSet({ justPosted: { id, n: (_cmState.justPosted ? _cmState.justPosted.n : 0) + 1 } });
}

const CommunityStore = {
  get: () => _cmState,
  subscribe(fn) {
    _cmSubs.add(fn);
    return () => _cmSubs.delete(fn);
  },
  // Read the signed-in state once on launch and follow changes from the main
  // process (sign in/out, token refresh, profile edits). On a build without
  // Community (or an older main) this settles as "not configured".
  async init() {
    const api = _cmApi();
    if (!api) { _cmSet({ loaded: true }); return; }
    if (!_cmUnsub && api.onChanged) _cmUnsub = api.onChanged(_cmApply);
    try { _cmApply(await api.state()); } catch (e) { _cmSet({ loaded: true }); }
    if (!_cmUnreadTimer) {
      _cmUnreadTimer = setInterval(_cmRefreshUnread, CM_UNREAD_POLL_MS);
      window.addEventListener("focus", _cmRefreshUnread);
    }
  },
  signInGoogle: () => _cmCall("signInGoogle"),
  cancelSignIn() { const api = _cmApi(); if (api && api.cancelSignIn) api.cancelSignIn(); },
  signInPassword: (email, password) => _cmCall("signInPassword", email, password),
  signUp: (email, password) => _cmCall("signUp", email, password),
  confirmSignUp: (email, code) => _cmCall("confirmSignUp", email, code),
  resendSignUpCode: (email) => _cmCall("resendSignUpCode", email),
  signOut: () => _cmCall("signOut"),
  updateProfile: (input) => _cmCall("updateProfile", input),
  deleteAccount: () => _cmCall("deleteAccount"),
  avatarSet: (value) => _cmCall("avatarSet", value),
  avatarPick: () => _cmCall("avatarPick"),

  sharePreview: (tandaId, includeTags) => _cmData("sharePreview", tandaId, includeTags),
  async shareTanda(tandaId, note, includeTags) {
    const res = await _cmDataTandas("share", tandaId, note, includeTags);
    if (res.ok && res.postId) _cmPosted(res.postId);
    return res;
  },
  unshareTanda: (tandaId) => _cmDataTandas("unshare", tandaId),
  deletePost: (postId) => _cmDataTandas("deletePost", postId),
  editPost: (postId, note) => _cmData("editPost", postId, note),
  async ask(text) {
    const res = await _cmData("ask", text);
    if (res.ok) { _cmPosted(res.id); _cmSet({ feedVersion: _cmState.feedVersion + 1 }); }
    return res;
  },
  feed: (opts) => _cmData("feed", opts),
  latest: () => _cmData("latest"),
  orchestras: () => _cmData("orchestras"),
  notifications: () => _cmData("notifications"),
  refreshUnread: () => _cmRefreshUnread(),
  // Looking at the list clears the bell at once; the backend is told too.
  markNotificationsSeen() { _cmSet({ unread: 0 }); return _cmData("notificationsSeen"); },
  openNotifications() { _cmSet({ openNotifications: _cmState.openNotifications + 1 }); },
  like: (postId, on) => _cmData("like", postId, on),
  save: (postId, on) => _cmData("save", postId, on),
  likeComment: (commentId, on) => _cmData("likeComment", commentId, on),
  comments: (postId, before) => _cmData("comments", postId, before || null),
  comment: (postId, body, parentId) => _cmData("comment", postId, body, parentId || null),
  deleteComment: (commentId, postId) => _cmData("deleteComment", commentId, postId),
  report: (target, reason) => _cmData("report", target, reason),
  block: (userId) => _cmData("block", userId),
  profile: (userId) => _cmData("profile", userId),
  follow: (userId, on) => _cmData("follow", userId, on),
  follows: (userId, which, offset) => _cmData("follows", userId, which, offset || 0),
};

/* Switch the app to another top-level view from anywhere (AppBody listens). */
function navigateTo(view) {
  window.dispatchEvent(new CustomEvent("compas:navigate", { detail: view }));
}

/* "just now", "5 minutes ago", "2 hours ago", "yesterday", "3 days ago", then
   a short date — the way a person would say it, in the DJ's language (the
   browser's own relative-time wording for the language in use). */
function communityAgo(iso) {
  const then = new Date(iso).getTime();
  if (!then) return "";
  const s = Math.max(0, (Date.now() - then) / 1000);
  if (s < 60) return tr("community.justNow");
  const lang = document.documentElement.lang || undefined;
  const rel = new Intl.RelativeTimeFormat(lang, { numeric: "auto" });
  if (s < 3600) return rel.format(-Math.floor(s / 60), "minute");
  if (s < 86400) return rel.format(-Math.floor(s / 3600), "hour");
  if (s < 7 * 86400) return rel.format(-Math.floor(s / 86400), "day");
  return new Date(then).toLocaleDateString(lang, { day: "numeric", month: "short" });
}

/* ---------- profile pictures ----------
   A DJ's picture is a photo (their Google photo, or one they uploaded — an
   https URL) or one of the pictures the app draws itself ("preset:<n>"). With
   nothing chosen, the app picks one of those from the DJ's id, so everyone has
   a steady, recognisable picture from the start. */
const CM_AVATAR_COUNT = 16;
const CM_AVATAR_PALETTES = [
  ["#C8463F", "#F7E8DA"], ["#2F5D8A", "#DCE9F5"], ["#3B7D5D", "#E3F1E6"], ["#C98B2C", "#FBF1DC"],
  ["#6C4B9F", "#EEE7F8"], ["#1F7B8D", "#DDF2F5"], ["#B94B7B", "#F9E4EE"], ["#454C56", "#E7E9ED"],
];
function communityPresetFor(id, avatar) {
  const m = /^preset:(\d{1,2})$/.exec(avatar || "");
  if (m && Number(m[1]) < CM_AVATAR_COUNT) return Number(m[1]);
  let h = 0;
  for (const ch of String(id || "")) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % CM_AVATAR_COUNT;
}
/* One of the drawn pictures: a colour and a motif — a record, a moon, dots,
   or waves. */
function CommunityPresetArt({ k }) {
  const [bg, fg] = CM_AVATAR_PALETTES[k % CM_AVATAR_PALETTES.length];
  const motif = (k + Math.floor(k / CM_AVATAR_PALETTES.length)) % 4;
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <circle cx="32" cy="32" r="32" fill={bg} />
      {motif === 0 && (
        <g fill="none" stroke={fg} strokeWidth="3.5">
          <circle cx="32" cy="32" r="22" /><circle cx="32" cy="32" r="13" /><circle cx="32" cy="32" r="4" fill={fg} stroke="none" />
        </g>
      )}
      {motif === 1 && <><circle cx="40" cy="27" r="20" fill={fg} /><circle cx="25" cy="42" r="9" fill={bg} /></>}
      {motif === 2 && (
        <g fill={fg}>
          {[16, 32, 48].map((x) => [16, 32, 48].map((y) => <circle key={x + "-" + y} cx={x} cy={y} r={x === 32 && y === 32 ? 6.5 : 4} />))}
        </g>
      )}
      {motif === 3 && (
        <g fill="none" stroke={fg} strokeWidth="3.5" strokeLinecap="round">
          {[20, 32, 44].map((y) => <path key={y} d={`M-4 ${y} q8 -7 16 0 t16 0 t16 0 t16 0`} />)}
        </g>
      )}
    </svg>
  );
}
/* The picture itself, at one of three sizes ("sm", "", "lg"). A photo that
   fails to load falls back to the drawn picture. */
function CommunityAvatar({ id, avatar, size, className }) {
  const [broken, setBroken] = React.useState(false);
  React.useEffect(() => { setBroken(false); }, [avatar]);
  const cls = "cm-avatar" + (size ? " " + size : "") + (className ? " " + className : "");
  if (avatar && /^https?:\/\//.test(avatar) && !broken) {
    return <img className={cls + " is-photo"} src={avatar} alt="" draggable={false} onError={() => setBroken(true)} />;
  }
  const k = communityPresetFor(id, avatar);
  return <span className={cls} data-preset={k} aria-hidden="true"><CommunityPresetArt k={k} /></span>;
}

function useCommunity() {
  const [, force] = React.useState(0);
  React.useEffect(() => CommunityStore.subscribe(() => force((n) => n + 1)), []);
  return CommunityStore.get();
}

/* Up to two initials for an avatar: from the display name, else the handle. */
function communityInitials(user) {
  const name = ((user && (user.displayName || user.handle)) || "").trim();
  if (!name) return "DJ";
  const parts = name.split(/[\s_]+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : name.slice(0, 2);
  return letters.toUpperCase();
}

Object.assign(window, { CommunityStore, useCommunity, communityInitials, navigateTo, communityAgo, CommunityAvatar, CommunityPresetArt, communityPresetFor, CM_AVATAR_COUNT });
