// community-data.jsx — Compás Community account state, shared by the top bar,
// the Community view and Settings. The main process owns the session and does
// all the network work; this just mirrors `{configured, user}` and forwards
// actions. Every action resolves to `{ok: true, state}` or `{ok: false, error}`
// so callers can show the message as-is.
// `feedVersion` ticks whenever something was posted or removed from outside the
// feed (sharing from the Tandas tab), so an open feed knows to reload.
// `unread` is the number of new notifications (the bell in the top bar);
// `openNotifications` ticks when the bell is clicked, so the Community tab
// knows to show them.
let _cmState = { loaded: false, configured: false, user: null, feedVersion: 0, unread: 0, openNotifications: 0 };
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
  // A different account (or none): its notifications, not the last one's.
  if (now !== was) { if (now) _cmRefreshUnread(); else _cmSet({ unread: 0 }); }
}
function _cmApi() { return window.compas && window.compas.community; }

async function _cmCall(name, ...args) {
  const api = _cmApi();
  const failed = { ok: false, error: "Something went wrong. Try again." };
  if (!api || !api[name]) return failed;
  try {
    const res = await api[name](...args);
    if (res && res.ok) _cmApply(res.state);
    return res || failed;
  } catch (e) {
    return failed;
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
  const failed = { ok: false, error: "Something went wrong. Try again." };
  if (!api || !api[name]) return failed;
  try { return (await api[name](...args)) || failed; } catch (e) { return failed; }
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

  sharePreview: (tandaId, includeTags) => _cmData("sharePreview", tandaId, includeTags),
  shareTanda: (tandaId, note, includeTags) => _cmDataTandas("share", tandaId, note, includeTags),
  unshareTanda: (tandaId) => _cmDataTandas("unshare", tandaId),
  deletePost: (postId) => _cmDataTandas("deletePost", postId),
  ask: (text) => _cmData("ask", text),
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
  comments: (postId, before) => _cmData("comments", postId, before || null),
  comment: (postId, body, parentId) => _cmData("comment", postId, body, parentId || null),
  deleteComment: (commentId) => _cmData("deleteComment", commentId),
  report: (target, reason) => _cmData("report", target, reason),
  block: (userId) => _cmData("block", userId),
};

/* Switch the app to another top-level view from anywhere (AppBody listens). */
function navigateTo(view) {
  window.dispatchEvent(new CustomEvent("compas:navigate", { detail: view }));
}

/* "just now", "5 minutes ago", "2 hours ago", "yesterday", "3 days ago", then
   a short date — the way a person would say it. */
function communityAgo(iso) {
  const then = new Date(iso).getTime();
  if (!then) return "";
  const s = Math.max(0, (Date.now() - then) / 1000);
  const n = (count, unit) => `${count} ${unit}${count === 1 ? "" : "s"} ago`;
  if (s < 60) return "just now";
  if (s < 3600) return n(Math.floor(s / 60), "minute");
  if (s < 86400) return n(Math.floor(s / 3600), "hour");
  if (s < 2 * 86400) return "yesterday";
  if (s < 7 * 86400) return n(Math.floor(s / 86400), "day");
  return new Date(then).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/* A steady colour for each DJ's avatar, picked from their id, so people are
   recognisable down the feed without photos. */
function communityAvatarClass(id) {
  let h = 0;
  for (const ch of String(id || "")) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return "av-" + (h % 6);
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

Object.assign(window, { CommunityStore, useCommunity, communityInitials, navigateTo, communityAgo, communityAvatarClass });
