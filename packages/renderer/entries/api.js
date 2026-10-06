// Bridge between the contextBridge-exposed preload functions and the design
// files, which are classic scripts that read globals off `window`.
// `@app/preload` resolves to the virtual browser module, whose exports map to
// the values exposed by the preload via `contextBridge.exposeInMainWorld`.
import * as preload from "@app/preload";
import {Howl, Howler} from "howler";

// The design files are classic scripts that read globals — expose Howler too.
window.Howl = Howl;
window.Howler = Howler;

const AUDIO_SCHEME = "compas-audio";

window.compas = {
  getAppVersion: preload.getAppVersion,
  openExternal: preload.openExternal,
  getLibrary: preload.getLibrary,
  clearLibrary: preload.clearLibrary,
  pruneMissing: preload.pruneMissingLibrary,
  reconcile: preload.reconcileLibrary,
  removeSongIfMissing: preload.removeSongIfMissing,
  deleteSongs: preload.deleteSongs,
  updateSong: preload.updateSong,
  setSongCortina: preload.setSongCortina,
  setFolderCortina: preload.setFolderCortina,
  previewSmartOrganize: preload.previewSmartOrganize,
  applySmartOrganize: preload.applySmartOrganize,
  importScanPreview: preload.importScanPreview,
  importScanPreviewPath: preload.importScanPreviewPath,
  pathForFile: preload.pathForFile,
  importCommit: preload.importCommit,
  importCancel: preload.importCancel,
  setSongGenres: preload.setSongGenres,
  listTandas: preload.listTandas,
  suggestTandas: preload.suggestTandas,
  saveTanda: preload.saveTanda,
  keepTanda: preload.keepTanda,
  deleteTanda: preload.deleteTanda,
  listPlaylists: preload.listPlaylists,
  savePlaylist: preload.savePlaylist,
  deletePlaylist: preload.deletePlaylist,
  exportPlaylist: preload.exportPlaylist,
  importPlaylistPreview: preload.importPlaylistPreview,
  importPlaylistPreviewPath: preload.importPlaylistPreviewPath,
  importPlaylistCommit: preload.importPlaylistCommit,
  importPlaylistCancel: preload.importPlaylistCancel,
  // Background loudness/silence analysis: read state and subscribe to progress
  // for the banner.
  analysisState: preload.analysisState,
  onAnalysisProgress: preload.onAnalysisProgress,
  // Live library sync: fires when songs are added/removed/renamed on disk.
  onLibraryChanged: preload.onLibraryChanged,
  // Text-size commands from the View ▸ Zoom menu / Cmd·Ctrl +/-/0 accelerators,
  // and the setter that applies the chosen size as native page zoom.
  onZoomCommand: preload.onZoomCommand,
  setTextZoom: preload.setTextZoom,
  // Auto-update: read a pending (already-downloaded) update, subscribe to the
  // "downloaded" event, and restart into the new version on demand.
  getUpdateStatus: preload.getUpdateStatus,
  installUpdate: preload.installUpdate,
  onUpdateDownloaded: preload.onUpdateDownloaded,
  // Hold the display awake while playing so the screen never sleeps mid-set
  // (and the renderer never gets occluded + throttled).
  setKeepAwake: preload.setKeepAwake,
  // URL the audio engine can stream a song from (range requests supported).
  audioUrl: (id) => `${AUDIO_SCHEME}://song/${id}`,
  // Compás Community: accounts (and, later, the shared-tanda feed). All network
  // work happens in the main process; these just ask it.
  community: {
    state: preload.communityState,
    signInGoogle: preload.communitySignInGoogle,
    cancelSignIn: preload.communityCancelSignIn,
    signInPassword: preload.communitySignInPassword,
    signUp: preload.communitySignUp,
    confirmSignUp: preload.communityConfirmSignUp,
    resendSignUpCode: preload.communityResendSignUpCode,
    signOut: preload.communitySignOut,
    updateProfile: preload.communityUpdateProfile,
    deleteAccount: preload.communityDeleteAccount,
    avatarSet: preload.communityAvatarSet,
    avatarPick: preload.communityAvatarPick,
    onChanged: preload.onCommunityChanged,
    sharePreview: preload.communitySharePreview,
    share: preload.communityShare,
    unshare: preload.communityUnshare,
    ask: preload.communityAsk,
    feed: preload.communityFeed,
    latest: preload.communityLatest,
    orchestras: preload.communityOrchestras,
    notifications: preload.communityNotifications,
    notificationsUnread: preload.communityNotificationsUnread,
    notificationsSeen: preload.communityNotificationsSeen,
    like: preload.communityLike,
    save: preload.communitySave,
    comments: preload.communityComments,
    comment: preload.communityComment,
    deleteComment: preload.communityDeleteComment,
    deletePost: preload.communityDeletePost,
    report: preload.communityReport,
    block: preload.communityBlock,
    profile: preload.communityProfile,
    follow: preload.communityFollow,
    follows: preload.communityFollows,
  },
};
