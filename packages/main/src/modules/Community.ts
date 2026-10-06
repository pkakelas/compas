import type {AppModule} from '../AppModule.js';
import type {ModuleContext} from '../ModuleContext.js';
import {BrowserWindow, ipcMain} from 'electron';
import {
  CommunityService,
  type CommentRow,
  type CommunityResult,
  type CommunityState,
  type FeedScope,
  type FeedSort,
  type ProfileInput,
} from '../services/community.js';
import {buildSharedTanda, matchSharedTanda, type MatchedTanda} from '../services/community-share.js';
import {buildLibraryIndex} from '../services/suggest-tandas.js';
import {
  clearSharedPost,
  getLibrary,
  listCollectionTandas,
  setTandaSharedPost,
} from './Database.js';

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = (v: unknown): string | null => (typeof v === 'string' && UUID_RE.test(v) ? v : null);
const BAD_REQUEST = {ok: false as const, error: 'Something went wrong. Try again.'};

const FEED_PAGE = 20;
// An orchestra key as the backend files it: a lowercased surname.
const ORQ_KEY_RE = /^[a-z0-9']{1,40}$/;
// "Tandas I have all the songs for" can only be decided here, after matching
// against the library, so those two filters read ahead: up to this many pages
// per request, until one screenful has been found.
const FEED_SCAN_PAGES = 5;

/** What the feed shows: everything, tandas the DJ fully owns, tandas with
 *  songs missing from the library, or questions. */
type FeedShow = 'all' | 'ready' | 'missing' | 'questions';
// A post shows its newest few comments; the rest load a page at a time on demand,
// so neither the feed request nor a busy post grows without bound.
const COMMENT_PREVIEW = 3;
const COMMENT_PAGE = 20;

/** A comment as the renderer shows it. */
type FeedComment = {
  id: string;
  parentId: string | null;
  body: string;
  createdAt: string;
  mine: boolean;
  author: {id: string; handle: string; name: string};
};

/** A post as the renderer shows it: the backend row, plus what only this
 *  computer knows — which of a shared tanda's songs are in the library. */
type FeedPost = {
  id: string;
  kind: 'tanda' | 'question';
  note: string;
  createdAt: string;
  likeCount: number;
  commentCount: number;
  liked: boolean;
  saved: boolean;
  mine: boolean;
  author: {id: string; handle: string; name: string; city: string | null};
  tanda: MatchedTanda | null;
  // The DJ's own tanda this post was shared from, when it is theirs.
  localTandaId: string | null;
  comments: FeedComment[];
};

function toFeedComment(row: CommentRow, userId: string): FeedComment {
  return {
    id: row.id,
    parentId: row.parent_id,
    body: str(row.body, 1000),
    createdAt: row.created_at,
    mine: row.author_id === userId,
    author: {
      id: row.author_id,
      handle: str(row.author?.handle, 24),
      name: str(row.author?.display_name, 60) || 'DJ',
    },
  };
}

/**
 * Compás Community: accounts and (later) the shared-tanda feed. Every call the
 * renderer makes lands here; the network side lives in services/community.ts.
 * Handlers resolve to a result object rather than throwing, so the UI can show
 * the message as-is.
 */
export class CommunityModule implements AppModule {
  async enable({app}: ModuleContext): Promise<void> {
    await app.whenReady();

    const broadcast = (state: CommunityState): void => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send('community:changed', state);
      }
    };
    const community = new CommunityService(app.getPath('userData'), broadcast);

    ipcMain.handle('community:state', (): Promise<CommunityState> => community.getState());

    // Google sign-in happens in the system browser; bring Compás back to the
    // front once it finishes so the DJ isn't left looking at a browser tab.
    ipcMain.handle('community:signInGoogle', async (): Promise<CommunityResult> => {
      const result = await community.signInWithGoogle();
      if (result.ok) {
        const win = BrowserWindow.getAllWindows().find(w => !w.isDestroyed());
        if (win) {
          if (win.isMinimized()) win.restore();
          win.show();
          win.focus();
        }
      }
      return result;
    });
    ipcMain.handle('community:cancelSignIn', (): void => community.cancelSignIn());

    ipcMain.handle('community:signInPassword', (_event, email: unknown, password: unknown) =>
      community.signInWithPassword(str(email, 254), str(password, 256)),
    );
    ipcMain.handle('community:signUp', (_event, email: unknown, password: unknown) =>
      community.signUp(str(email, 254), str(password, 256)),
    );
    ipcMain.handle('community:confirmSignUp', (_event, email: unknown, code: unknown) =>
      community.confirmSignUp(str(email, 254), str(code, 12)),
    );
    ipcMain.handle('community:resendSignUpCode', (_event, email: unknown) =>
      community.resendSignUpCode(str(email, 254)),
    );
    ipcMain.handle('community:signOut', () => community.signOut());

    ipcMain.handle('community:updateProfile', (_event, input: Partial<ProfileInput> | null) =>
      community.updateProfile({
        displayName: str(input?.displayName, 200),
        handle: str(input?.handle, 200),
        city: str(input?.city, 200) || null,
      }),
    );
    ipcMain.handle('community:deleteAccount', () => community.deleteAccount());

    // ---- sharing ---------------------------------------------------------------

    const findTanda = (id: unknown) => listCollectionTandas().find(t => t.id === String(id));

    // Exactly what would be posted for a tanda (song details only), or why it
    // can't be shared yet — shown in the share dialog before anything is sent.
    ipcMain.handle('community:sharePreview', (_event, tandaId: unknown, includeTags: unknown) => {
      const tanda = findTanda(tandaId);
      if (!tanda) return {ok: false, error: 'That tanda no longer exists.'};
      return buildSharedTanda(tanda, includeTags !== false);
    });

    ipcMain.handle(
      'community:share',
      async (_event, tandaId: unknown, note: unknown, includeTags: unknown) => {
        const tanda = findTanda(tandaId);
        if (!tanda) return {ok: false, error: 'That tanda no longer exists.'};
        if (tanda.sharedPostId) return {ok: false, error: 'This tanda is already shared.'};
        const built = buildSharedTanda(tanda, includeTags !== false);
        if (!built.ok) return built;
        const posted = await community.createPost({
          kind: 'tanda',
          note: str(note, 500).trim(),
          tanda: built.tanda,
        });
        if (!posted.ok) return posted;
        setTandaSharedPost(tanda.id, posted.id);
        return {ok: true, postId: posted.id, tandas: listCollectionTandas()};
      },
    );

    ipcMain.handle('community:unshare', async (_event, tandaId: unknown) => {
      const tanda = findTanda(tandaId);
      if (!tanda) return {ok: false, error: 'That tanda no longer exists.'};
      if (tanda.sharedPostId) {
        const removed = await community.deletePost(tanda.sharedPostId);
        if (!removed.ok) return removed;
        setTandaSharedPost(tanda.id, null);
      }
      return {ok: true, tandas: listCollectionTandas()};
    });

    ipcMain.handle('community:ask', (_event, text: unknown) => {
      const note = str(text, 500).trim();
      if (!note) return {ok: false, error: 'Write something first.'};
      return community.createPost({kind: 'question', note});
    });

    // ---- feed ------------------------------------------------------------------

    ipcMain.handle(
      'community:feed',
      async (_event, opts: {scope?: unknown; sort?: unknown; show?: unknown; orq?: unknown; postId?: unknown; offset?: unknown} | null) => {
        const scope: FeedScope = opts?.scope === 'mine' || opts?.scope === 'saved' ? opts.scope : 'all';
        const sort: FeedSort = opts?.sort === 'new' || opts?.sort === 'liked' ? opts.sort : 'popular';
        const show: FeedShow =
          opts?.show === 'ready' || opts?.show === 'missing' || opts?.show === 'questions' ? opts.show : 'all';
        let offset = Number.isInteger(opts?.offset) && (opts!.offset as number) > 0 ? (opts!.offset as number) : 0;
        const kind = show === 'questions' ? 'question' : show === 'all' ? null : 'tanda';
        const orq = typeof opts?.orq === 'string' && ORQ_KEY_RE.test(opts.orq) ? opts.orq : null;
        // One post on its own (opened from a notification), whatever the filters say.
        const postId = uuid(opts?.postId);

        // Matching happens here, on this computer: the backend never learns what
        // is in the library.
        const index = buildLibraryIndex(getLibrary());
        const localByPost = new Map<string, string>();
        for (const t of listCollectionTandas()) if (t.sharedPostId) localByPost.set(t.sharedPostId, t.id);

        const posts: FeedPost[] = [];
        let hasMore = true;
        for (let scanned = 0; scanned < FEED_SCAN_PAGES && hasMore && posts.length < FEED_PAGE; scanned++) {
          // One extra row tells us whether there is another page.
          const page = await community.listPosts(
            postId
              ? {scope: 'all', sort: 'new', kind: null, orq: null, id: postId, offset: 0, limit: 1}
              : {scope, sort, kind, orq, offset, limit: FEED_PAGE + 1},
          );
          if (!page.ok) return page;
          const rows = page.rows.slice(0, FEED_PAGE);
          hasMore = page.rows.length > FEED_PAGE;
          offset += rows.length;
          for (const r of rows) {
            const tanda = r.kind === 'tanda' ? matchSharedTanda(index, r.tanda) : null;
            if (!postId && show === 'ready' && !tanda?.ready) continue;
            if (!postId && show === 'missing' && (!tanda || tanda.ready)) continue;
            posts.push({
              id: r.id,
              kind: r.kind === 'question' ? 'question' : 'tanda',
              note: str(r.note, 500),
              createdAt: r.created_at,
              likeCount: Math.max(0, Number(r.like_count) || 0),
              commentCount: Math.max(0, Number(r.comment_count) || 0),
              liked: !!r.viewer_liked,
              saved: !!r.viewer_saved,
              mine: r.author_id === page.userId,
              author: {
                id: r.author_id,
                handle: str(r.author_handle, 24),
                name: str(r.author_name, 60) || 'DJ',
                city: str(r.author_city, 60) || null,
              },
              tanda,
              localTandaId: localByPost.get(r.id) ?? null,
              comments: [],
            });
          }
        }

        // Comments are a nicety: if they fail to load, the posts still show.
        const state = await community.getState();
        const loaded = await community.listCommentPreviews(posts.map(p => p.id), COMMENT_PREVIEW);
        if (loaded.ok) {
          const byPost = new Map(posts.map(p => [p.id, p] as const));
          for (const row of loaded.rows) byPost.get(row.post_id)?.comments.push(toFeedComment(row, state.user?.id ?? ''));
          // They arrive newest first; a conversation reads oldest first.
          for (const p of posts) p.comments.sort((x, y) => x.createdAt.localeCompare(y.createdAt));
        }

        // `nextOffset` is where the next request carries on reading from.
        return {ok: true, posts, nextOffset: offset, hasMore};
      },
    );

    ipcMain.handle('community:latest', () => community.latestPostAt());

    // ---- notifications ---------------------------------------------------------

    ipcMain.handle('community:notifications', async () => {
      const listed = await community.listNotifications(50);
      if (!listed.ok) return listed;
      const items = listed.rows.map(r => ({
        key: `${r.kind}:${r.comment_id ?? `${r.post_id}:${r.actor_id}`}`,
        kind: r.kind === 'like' || r.kind === 'reply' || r.kind === 'welcome' ? r.kind : 'comment',
        createdAt: r.created_at,
        actor: {id: r.actor_id, name: str(r.actor_name, 60) || 'DJ'},
        postId: r.post_id,
        postKind: r.post_kind === 'question' ? 'question' : 'tanda',
        postTitle: str(r.post_title, 120),
        body: str(r.body, 140),
        unread: !listed.seenAt || r.created_at > listed.seenAt,
      }));
      return {ok: true, items};
    });
    ipcMain.handle('community:notificationsUnread', () => community.unreadNotifications());
    ipcMain.handle('community:notificationsSeen', () => community.markNotificationsSeen());

    ipcMain.handle('community:orchestras', async () => {
      const listed = await community.listOrchestras();
      if (!listed.ok) return listed;
      const orchestras = listed.rows
        .filter(r => typeof r.key === 'string' && ORQ_KEY_RE.test(r.key))
        .map(r => ({key: r.key, name: str(r.name, 120) || r.key, tandas: Math.max(0, Number(r.tandas) || 0)}));
      return {ok: true, orchestras};
    });

    ipcMain.handle('community:like', (_event, postId: unknown, on: unknown) => {
      const id = uuid(postId);
      return id ? community.setLiked(id, on !== false) : BAD_REQUEST;
    });
    ipcMain.handle('community:save', (_event, postId: unknown, on: unknown) => {
      const id = uuid(postId);
      return id ? community.setSaved(id, on !== false) : BAD_REQUEST;
    });

    // Earlier comments of one post, a page at a time. Resolves to the page in
    // reading order (oldest first) and whether there is more before it.
    ipcMain.handle('community:comments', async (_event, postId: unknown, before: unknown) => {
      const id = uuid(postId);
      if (!id) return BAD_REQUEST;
      const state = await community.getState();
      const cursor = typeof before === 'string' ? before.slice(0, 40) : null;
      const page = await community.listCommentsPage(id, cursor, COMMENT_PAGE + 1);
      if (!page.ok) return page;
      const comments = page.rows
        .slice(0, COMMENT_PAGE)
        .map(row => toFeedComment(row, state.user?.id ?? ''))
        .reverse();
      return {ok: true, comments, hasMore: page.rows.length > COMMENT_PAGE};
    });

    ipcMain.handle(
      'community:comment',
      async (_event, postId: unknown, body: unknown, parentId: unknown) => {
        const id = uuid(postId);
        const text = str(body, 1000).trim();
        if (!id) return BAD_REQUEST;
        if (!text) return {ok: false, error: 'Write a comment first.'};
        const state = await community.getState();
        const added = await community.addComment(id, text, uuid(parentId));
        if (!added.ok) return added;
        return {ok: true, comment: toFeedComment(added.row, state.user?.id ?? '')};
      },
    );
    ipcMain.handle('community:deleteComment', (_event, commentId: unknown) => {
      const id = uuid(commentId);
      return id ? community.deleteComment(id) : BAD_REQUEST;
    });

    // Deleting a post that one of the DJ's tandas was shared as also unmarks
    // that tanda, so "My tandas" never shows a stale "Shared".
    ipcMain.handle('community:deletePost', async (_event, postId: unknown) => {
      const id = uuid(postId);
      if (!id) return BAD_REQUEST;
      const removed = await community.deletePost(id);
      if (!removed.ok) return removed;
      clearSharedPost(id);
      return {ok: true, tandas: listCollectionTandas()};
    });

    ipcMain.handle(
      'community:report',
      (_event, target: {postId?: unknown; commentId?: unknown} | null, reason: unknown) => {
        const postId = uuid(target?.postId);
        const commentId = uuid(target?.commentId);
        const text = str(reason, 500).trim();
        if ((postId ? 1 : 0) + (commentId ? 1 : 0) !== 1) return BAD_REQUEST;
        if (!text) return {ok: false, error: 'Say briefly what is wrong.'};
        return community.report({postId, commentId}, text);
      },
    );
    ipcMain.handle('community:block', (_event, userId: unknown) => {
      const id = uuid(userId);
      return id ? community.block(id) : BAD_REQUEST;
    });
  }
}

export function communityModule(): CommunityModule {
  return new CommunityModule();
}
