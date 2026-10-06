import {ipcRenderer, webFrame, webUtils} from 'electron';

// Apply the saved text size as early as possible — native page zoom rescales the
// layout viewport, so the app's fixed-height layout still fills the window at any
// size (unlike CSS zoom). Done here in the preload so it's in effect before the
// renderer paints, with no flash from 100% to the chosen size on launch.
try {
  const saved = parseInt(window.localStorage.getItem('compas.fontScale') || '', 10);
  if (!isNaN(saved)) webFrame.setZoomFactor(Math.max(70, Math.min(150, saved)) / 100);
} catch {
  /* localStorage unavailable — fall back to the default 100%. */
}

/** Set the app's text size (whole-page zoom). `factor` is a multiplier, e.g. 1.1. */
function setTextZoom(factor: number) {
  webFrame.setZoomFactor(factor);
}

/** The running app's version string (from package.json), for the About card. */
function getAppVersion(): Promise<string> {
  return ipcRenderer.invoke('app:version');
}

/** Open a vetted external link (About footer website / email) in the OS handler. */
function openExternal(url: string): Promise<void> {
  return ipcRenderer.invoke('app:openExternal', url);
}

/** Tell the main process which UI language is active, so the native menu and
 *  file dialogs match the renderer. */
function setLocale(locale: string): Promise<void> {
  return ipcRenderer.invoke('app:setLocale', locale);
}

/** Read the current library (folder tree + flat songs) from the database. */
function getLibrary() {
  return ipcRenderer.invoke('library:get');
}

/** Wipe all imported songs and library roots (leaves tandas that still have songs). */
function clearLibrary() {
  return ipcRenderer.invoke('library:clear');
}

/** Remove songs whose files no longer exist. Returns {removed, library}. */
function pruneMissingLibrary() {
  return ipcRenderer.invoke('library:pruneMissing');
}

/** Sync the library with the filesystem — picks up songs added, removed, or
 *  moved while the app was closed. Returns the fresh {library}. */
function reconcileLibrary() {
  return ipcRenderer.invoke('library:reconcile');
}

/** Remove one song iff its file is gone. Returns {removed, song, library}. */
function removeSongIfMissing(id: string) {
  return ipcRenderer.invoke('songs:removeIfMissing', id);
}

/** Delete songs from the library by id (e.g. a whole folder). Files stay on disk. Returns the fresh library. */
function deleteSongs(ids: string[]) {
  return ipcRenderer.invoke('songs:delete', ids);
}

/** Edit a song's metadata: writes the file's tags and the database row. Returns {song, library}. */
function updateSong(input: {
  id: string;
  title: string;
  orq: string;
  singer: string;
  album: string | null;
  year: number | null;
  genre: string;
  isCortina?: boolean;
}) {
  return ipcRenderer.invoke('songs:update', input);
}

/** Flag/unflag songs as cortinas (usage flag, independent of genre). Returns the fresh library. */
function setSongCortina(ids: string[], isCortina: boolean) {
  return ipcRenderer.invoke('songs:setCortina', {ids, isCortina});
}

/** Flag/unflag a whole folder as cortinas (persisted; future imports inherit). Returns the fresh library. */
function setFolderCortina(root: string, folderPath: string, isCortina: boolean) {
  return ipcRenderer.invoke('folders:setCortina', {root, folderPath, isCortina});
}

/** Preview Smart Organize proposals for the whole library. Returns {proposals, summary}. */
function previewSmartOrganize() {
  return ipcRenderer.invoke('smartOrganize:preview');
}

/** Apply the approved Smart Organize changes (Compás-only). Returns the fresh library. */
function applySmartOrganize(
  changes: {id: string; orq?: string; singer?: string; year?: number | null; genre?: string}[],
) {
  return ipcRenderer.invoke('smartOrganize:apply', changes);
}

/** Pick a folder and scan it for preview (nothing is saved). Returns the folder tree, or null if cancelled. */
function importScanPreview(kind?: 'folder' | 'playlist') {
  return ipcRenderer.invoke('import:scanPreview', {kind: kind || 'folder'});
}

/** Preview an import from a path the renderer already holds: a folder, a song (→ its folder) or an M3U/M3U8. */
function importScanPreviewPath(path: string) {
  return ipcRenderer.invoke('import:scanPreviewPath', path);
}

/** Absolute path of a File dropped onto the window (Electron hides File.path from the renderer). */
function pathForFile(file: File): string {
  try {
    return webUtils.getPathForFile(file);
  } catch {
    return '';
  }
}

/** Commit the previewed import with a per-folder style map and cortina-flag map. Returns the fresh library. */
function importCommit(types: Record<string, string>, cortinas?: Record<string, boolean>) {
  return ipcRenderer.invoke('import:commit', {types, cortinas: cortinas || {}});
}

/** Discard a pending import preview. */
function importCancel() {
  return ipcRenderer.invoke('import:cancel');
}

/** Set the style (genre) of many existing songs at once. Returns the fresh library. */
function setSongGenres(updates: {id: string; genre: string}[]) {
  return ipcRenderer.invoke('songs:setGenres', updates);
}

function listTandas() {
  return ipcRenderer.invoke('tandas:list');
}

/** Curated tandas the DJ fully owns, matched against their library. Returns an array of suggested-tanda objects. */
function suggestTandas() {
  return ipcRenderer.invoke('tandas:suggest');
}

function saveTanda(input: {
  id?: string | null;
  name?: string | null;
  songIds: string[];
  tags?: {cat: string; label: string}[];
}) {
  return ipcRenderer.invoke('tandas:save', input);
}

/** Keep a playlist-only tanda (made by a playlist import) in "My tandas". */
function keepTanda(id: string) {
  return ipcRenderer.invoke('tandas:keep', id);
}

function deleteTanda(id: string) {
  return ipcRenderer.invoke('tandas:delete', id);
}

function listPlaylists() {
  return ipcRenderer.invoke('playlists:list');
}

function savePlaylist(input: {
  id?: string | null;
  name?: string | null;
  items: {type: 'tanda' | 'cortina'; refId: string}[];
}) {
  return ipcRenderer.invoke('playlists:save', input);
}

function deletePlaylist(id: string) {
  return ipcRenderer.invoke('playlists:delete', id);
}

/** Export a playlist as M3U8 via a save dialog. Resolves to the written path, or null if cancelled. */
function exportPlaylist(id: string) {
  return ipcRenderer.invoke('playlists:export', id);
}

/** Pick an M3U/M3U8 and preview the tandas + cortinas it would create (nothing written yet). */
function importPlaylistPreview() {
  return ipcRenderer.invoke('playlists:importPreview');
}

/** Preview a playlist import from a path already in hand (after a folder import started from that file). */
function importPlaylistPreviewPath(path: string) {
  return ipcRenderer.invoke('playlists:importPreviewPath', path);
}

/** Commit the previewed playlist import, optionally renaming it. Returns the new playlist. */
function importPlaylistCommit(name?: string) {
  return ipcRenderer.invoke('playlists:importCommit', {name});
}

/** Discard a pending playlist import preview. */
function importPlaylistCancel() {
  return ipcRenderer.invoke('playlists:importCancel');
}

/** Current background-analysis state + DB stats (for the initial banner). */
function analysisState() {
  return ipcRenderer.invoke('analysis:state');
}

/** Subscribe to analysis progress. Returns an unsubscribe function. */
function onAnalysisProgress(cb: (state: unknown) => void) {
  const listener = (_event: unknown, state: unknown) => cb(state);
  ipcRenderer.on('analysis:progress', listener);
  return () => ipcRenderer.removeListener('analysis:progress', listener);
}

/** Subscribe to live library changes (files added/removed/renamed on disk).
 *  The callback receives the fresh library. Returns an unsubscribe function. */
function onLibraryChanged(cb: (library: unknown) => void) {
  const listener = (_event: unknown, library: unknown) => cb(library);
  ipcRenderer.on('library:changed', listener);
  return () => ipcRenderer.removeListener('library:changed', listener);
}

/** The update (if any) that has already finished downloading and is waiting to
 *  install — for a window that mounts after the download completed. Resolves to
 *  `{version, releaseNotes}` or null. */
function getUpdateStatus() {
  return ipcRenderer.invoke('update:status');
}

/** Quit and relaunch into the freshly-downloaded update. */
function installUpdate() {
  return ipcRenderer.invoke('update:install');
}

/** Hold/release a display-sleep blocker so the screen stays on while music
 *  plays. Pass the live play/pause state; the main process keeps a single
 *  blocker for the playing period and releases it on pause/stop. */
function setKeepAwake(keepAwake: boolean) {
  return ipcRenderer.invoke('power:keepAwake', keepAwake);
}

/** Subscribe to "a new version has downloaded" events. The callback receives
 *  `{version, releaseNotes}`. Returns an unsubscribe function. */
function onUpdateDownloaded(cb: (info: unknown) => void) {
  const listener = (_event: unknown, info: unknown) => cb(info);
  ipcRenderer.on('update:downloaded', listener);
  return () => ipcRenderer.removeListener('update:downloaded', listener);
}

/** Subscribe to text-size commands from the View ▸ Zoom menu / keyboard
 *  accelerators. The callback receives 'in' | 'out' | 'reset'. Returns an
 *  unsubscribe function. */
function onZoomCommand(cb: (dir: 'in' | 'out' | 'reset') => void) {
  const listener = (_event: unknown, dir: 'in' | 'out' | 'reset') => cb(dir);
  ipcRenderer.on('app:zoom', listener);
  return () => ipcRenderer.removeListener('app:zoom', listener);
}

/** Compás Community (accounts + shared tandas). Every call resolves to
 *  `{ok: true, state}` or `{ok: false, error}`; `state` is
 *  `{configured, user}` with `user` null when signed out. */
function communityState() {
  return ipcRenderer.invoke('community:state');
}

/** Sign in with Google in the system browser. Resolves when the browser comes
 *  back, the DJ cancels (communityCancelSignIn), or the attempt times out. */
function communitySignInGoogle() {
  return ipcRenderer.invoke('community:signInGoogle');
}

function communityCancelSignIn() {
  return ipcRenderer.invoke('community:cancelSignIn');
}

function communitySignInPassword(email: string, password: string) {
  return ipcRenderer.invoke('community:signInPassword', email, password);
}

/** Create an account. `pending: 'confirm-email'` on the result means the DJ
 *  must finish with communityConfirmSignUp(email, code). */
function communitySignUp(email: string, password: string) {
  return ipcRenderer.invoke('community:signUp', email, password);
}

function communityConfirmSignUp(email: string, code: string) {
  return ipcRenderer.invoke('community:confirmSignUp', email, code);
}

function communityResendSignUpCode(email: string) {
  return ipcRenderer.invoke('community:resendSignUpCode', email);
}

function communitySignOut() {
  return ipcRenderer.invoke('community:signOut');
}

function communityUpdateProfile(input: {displayName: string; handle: string; city: string | null; bio: string | null}) {
  return ipcRenderer.invoke('community:updateProfile', input);
}

/** Set the profile picture: "preset:<n>", the Google photo's URL, or null. */
function communityAvatarSet(value: string | null) {
  return ipcRenderer.invoke('community:avatarSet', value);
}
/** Choose an image file and upload it as the profile picture. Resolves to
 *  `{ok, state}`, or `{ok: false, cancelled: true}` if the dialog was closed. */
function communityAvatarPick() {
  return ipcRenderer.invoke('community:avatarPick');
}

/** Permanently delete the signed-in account and everything it posted. */
function communityDeleteAccount() {
  return ipcRenderer.invoke('community:deleteAccount');
}

/** Exactly what sharing a tanda would post (song details only), or why it
 *  can't be shared yet. Resolves to `{ok, tanda}` or `{ok: false, error}`. */
function communitySharePreview(tandaId: string, includeTags: boolean) {
  return ipcRenderer.invoke('community:sharePreview', tandaId, includeTags);
}

/** Share one of the DJ's tandas. Resolves to `{ok, postId, tandas}`. */
function communityShare(tandaId: string, note: string, includeTags: boolean) {
  return ipcRenderer.invoke('community:share', tandaId, note, includeTags);
}

/** Take a shared tanda back down. Resolves to `{ok, tandas}`. */
function communityUnshare(tandaId: string) {
  return ipcRenderer.invoke('community:unshare', tandaId);
}

function communityAsk(text: string) {
  return ipcRenderer.invoke('community:ask', text);
}

/** One page of the feed, each shared tanda already matched against the local
 *  library. `show` filters it, `sort` orders it, `offset` is the `nextOffset`
 *  of the previous page. Resolves to `{ok, posts, nextOffset, hasMore}`. */
function communityFeed(opts: {
  scope: 'all' | 'mine' | 'saved' | 'following';
  sort?: 'popular' | 'new' | 'liked';
  show?: 'all' | 'ready' | 'missing' | 'questions';
  orq?: string | null;
  postId?: string | null;
  // One DJ's posts (their profile page).
  author?: string | null;
  offset?: number;
}) {
  return ipcRenderer.invoke('community:feed', opts);
}

/** What other DJs did with the signed-in DJ's posts and comments, newest first.
 *  Resolves to `{ok, items}`; each item says whether it is `unread`. */
function communityNotifications() {
  return ipcRenderer.invoke('community:notifications');
}

/** How many notifications are new since the last look. Resolves to `{ok, unread}`. */
function communityNotificationsUnread() {
  return ipcRenderer.invoke('community:notificationsUnread');
}

/** Record that the DJ has looked at their notifications. */
function communityNotificationsSeen() {
  return ipcRenderer.invoke('community:notificationsSeen');
}

/** The orchestras that appear in shared tandas, most shared first. Resolves to
 *  `{ok, orchestras: [{key, name, tandas}]}`. */
function communityOrchestras() {
  return ipcRenderer.invoke('community:orchestras');
}

/** When the newest visible post was made — to notice new posts without
 *  reloading the feed. Resolves to `{ok, latestAt}`. */
function communityLatest() {
  return ipcRenderer.invoke('community:latest');
}

function communityLike(postId: string, on: boolean) {
  return ipcRenderer.invoke('community:like', postId, on);
}

function communitySave(postId: string, on: boolean) {
  return ipcRenderer.invoke('community:save', postId, on);
}

/** Earlier comments of a post, a page at a time. `before` is the created_at of
 *  the oldest comment already shown. Resolves to `{ok, comments, hasMore}`. */
function communityComments(postId: string, before: string | null) {
  return ipcRenderer.invoke('community:comments', postId, before);
}

/** Add a comment (or, with `parentId`, a reply). Resolves to `{ok, comment}`. */
function communityComment(postId: string, body: string, parentId: string | null) {
  return ipcRenderer.invoke('community:comment', postId, body, parentId);
}

function communityDeleteComment(commentId: string) {
  return ipcRenderer.invoke('community:deleteComment', commentId);
}

/** Delete one of the DJ's own posts. Resolves to `{ok, tandas}`. */
function communityDeletePost(postId: string) {
  return ipcRenderer.invoke('community:deletePost', postId);
}

function communityReport(target: {postId?: string; commentId?: string}, reason: string) {
  return ipcRenderer.invoke('community:report', target, reason);
}

function communityBlock(userId: string) {
  return ipcRenderer.invoke('community:block', userId);
}

/** One DJ as their page shows them. Resolves to `{ok, profile}` (null profile
 *  when there is no such DJ). */
function communityProfile(userId: string) {
  return ipcRenderer.invoke('community:profile', userId);
}
function communityFollow(userId: string, on: boolean) {
  return ipcRenderer.invoke('community:follow', userId, on);
}
/** Who follows a DJ, or whom they follow. Resolves to `{ok, people, hasMore, nextOffset}`. */
function communityFollows(userId: string, which: 'followers' | 'following', offset: number) {
  return ipcRenderer.invoke('community:follows', userId, which, offset);
}

/** Subscribe to sign-in state changes (sign in/out, profile edits). The
 *  callback receives the fresh state. Returns an unsubscribe function. */
function onCommunityChanged(cb: (state: unknown) => void) {
  const listener = (_event: unknown, state: unknown) => cb(state);
  ipcRenderer.on('community:changed', listener);
  return () => ipcRenderer.removeListener('community:changed', listener);
}

export {
  getAppVersion,
  openExternal,
  setLocale,
  getLibrary,
  clearLibrary,
  pruneMissingLibrary,
  reconcileLibrary,
  removeSongIfMissing,
  deleteSongs,
  updateSong,
  setSongCortina,
  setFolderCortina,
  previewSmartOrganize,
  applySmartOrganize,
  importScanPreview,
  importScanPreviewPath,
  pathForFile,
  importCommit,
  importCancel,
  setSongGenres,
  listTandas,
  suggestTandas,
  saveTanda,
  keepTanda,
  deleteTanda,
  listPlaylists,
  savePlaylist,
  deletePlaylist,
  exportPlaylist,
  importPlaylistPreview,
  importPlaylistPreviewPath,
  importPlaylistCommit,
  importPlaylistCancel,
  analysisState,
  onAnalysisProgress,
  onLibraryChanged,
  onZoomCommand,
  setTextZoom,
  getUpdateStatus,
  installUpdate,
  onUpdateDownloaded,
  setKeepAwake,
  communityState,
  communitySignInGoogle,
  communityCancelSignIn,
  communitySignInPassword,
  communitySignUp,
  communityConfirmSignUp,
  communityResendSignUpCode,
  communitySignOut,
  communityUpdateProfile,
  communityDeleteAccount,
  communityAvatarSet,
  communityAvatarPick,
  onCommunityChanged,
  communitySharePreview,
  communityShare,
  communityUnshare,
  communityAsk,
  communityFeed,
  communityLatest,
  communityOrchestras,
  communityNotifications,
  communityNotificationsUnread,
  communityNotificationsSeen,
  communityLike,
  communitySave,
  communityComments,
  communityComment,
  communityDeleteComment,
  communityDeletePost,
  communityReport,
  communityBlock,
  communityProfile,
  communityFollow,
  communityFollows,
};
