// community.ts — the Compás Community backend client (Supabase), main-process
// only. The renderer never talks to the network: it asks for things over IPC
// (see modules/Community.ts) and this service does the signing in, keeps the
// session, and reads/writes the DJ's profile.
//
// Which backend: VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are baked in at
// build time (packages/main/.env.development → staging, .env.production →
// production). COMPAS_COMMUNITY_URL / COMPAS_COMMUNITY_KEY override them at
// launch — the e2e tests use that to point at a local stub, or to switch the
// feature off with an empty value. With no URL the feature is simply absent.
//
// The session is encrypted with the OS keychain (safeStorage) and kept in
// userData, one file per backend so a staging session never meets production.
import {safeStorage, shell} from 'electron';
import {createServer, type Server} from 'node:http';
import {existsSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {createClient, type SupabaseClient} from '@supabase/supabase-js';

export type CommunityUser = {
  id: string;
  email: string | null;
  // Null when the profile row couldn't be read (offline, or the backend isn't
  // migrated yet) — the account still works, it just has no public face.
  handle: string | null;
  displayName: string | null;
  city: string | null;
  bio: string | null;
  // An https URL (Google photo or upload), "preset:<n>", or null (the app
  // picks a preset from the id).
  avatar: string | null;
  // The picture Google gave at sign-in, if any — offered as a choice.
  googleAvatar: string | null;
};

export type CommunityState = {
  configured: boolean;
  user: CommunityUser | null;
};

export type CommunityResult =
  | {ok: true; state: CommunityState; pending?: 'confirm-email'}
  | {ok: false; error: string; cancelled?: boolean};

export type ProfileInput = {displayName: string; handle: string; city: string | null; bio: string | null};

/** A row of the backend's `feed_posts` view. `tanda` is another user's JSON:
 *  treat it as untrusted (services/community-share.ts checks it). */
export type FeedRow = {
  id: string;
  author_id: string;
  kind: 'tanda' | 'question';
  note: string;
  tanda: unknown;
  like_count: number;
  comment_count: number;
  created_at: string;
  author_handle: string;
  author_name: string;
  author_city: string | null;
  viewer_liked: boolean;
  viewer_saved: boolean;
  author_followed: boolean;
  author_avatar: string | null;
};

/** A row of the backend's `profile_cards` view: a DJ as their page shows them. */
export type ProfileRow = {
  id: string;
  handle: string;
  display_name: string;
  city: string | null;
  bio: string | null;
  created_at: string;
  tanda_count: number;
  post_count: number;
  follower_count: number;
  following_count: number;
  viewer_follows: boolean;
  follows_viewer: boolean;
  avatar_url: string | null;
};

/** One entry of a followers / following list. */
export type FollowRow = {
  created_at: string;
  profile: {id: string; handle: string; display_name: string; city: string | null; avatar_url: string | null} | null;
};

export type CommentRow = {
  id: string;
  post_id: string;
  parent_id: string | null;
  author_id: string;
  body: string;
  created_at: string;
  author: {handle: string; display_name: string; avatar_url: string | null} | null;
};

/** A row of the backend's `my_notifications` view: something another DJ did
 *  with one of the signed-in DJ's posts or comments — or the one `welcome`
 *  entry every DJ gets from Compás itself, which is about no post. */
export type NotificationRow = {
  kind: 'like' | 'comment' | 'reply' | 'follow' | 'welcome';
  created_at: string;
  actor_id: string;
  actor_name: string;
  post_id: string | null;
  post_kind: 'tanda' | 'question' | null;
  post_title: string | null;
  comment_id: string | null;
  body: string | null;
  actor_avatar: string | null;
};

export type FeedScope = 'all' | 'mine' | 'saved' | 'following';
/** How the feed is ordered: by the backend's popularity score (recent posts
 *  that people liked and talked about), by date, or by likes of all time. */
export type FeedSort = 'popular' | 'new' | 'liked';

/** The outcome of a backend call that carries data instead of sign-in state. */
export type Outcome<T> = ({ok: true} & T) | {ok: false; error: string};

type Config = {url: string; anonKey: string};

/** Read the backend config, or null when Community is not set up in this build. */
export function communityConfig(): Config | null {
  const url = (process.env.COMPAS_COMMUNITY_URL ?? import.meta.env.VITE_SUPABASE_URL ?? '').trim();
  const anonKey = (process.env.COMPAS_COMMUNITY_KEY ?? import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim();
  if (!url || !anonKey) return null;
  try {
    const u = new URL(url);
    const loopback = u.hostname === '127.0.0.1' || u.hostname === 'localhost';
    // Plain http is only ever acceptable for a local stub.
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && loopback)) return null;
    return {url: u.origin, anonKey};
  } catch {
    return null;
  }
}

/**
 * The auth client's key/value store, encrypted at rest. If the OS offers no
 * encryption the session lives in memory only — it is never written in clear.
 */
class SessionStore {
  readonly #file: string;
  #data: Record<string, string> = {};
  #loaded = false;

  constructor(file: string) {
    this.#file = file;
  }

  #load(): void {
    if (this.#loaded) return;
    this.#loaded = true;
    try {
      if (!existsSync(this.#file) || !safeStorage.isEncryptionAvailable()) return;
      const parsed: unknown = JSON.parse(safeStorage.decryptString(readFileSync(this.#file)));
      if (parsed && typeof parsed === 'object') this.#data = parsed as Record<string, string>;
    } catch {
      // Unreadable (keychain changed, file damaged): start signed out.
      this.#data = {};
    }
  }

  #save(): void {
    try {
      if (!safeStorage.isEncryptionAvailable()) return;
      if (Object.keys(this.#data).length === 0) {
        rmSync(this.#file, {force: true});
        return;
      }
      writeFileSync(this.#file, safeStorage.encryptString(JSON.stringify(this.#data)), {mode: 0o600});
    } catch (e) {
      console.error('community: could not persist the session', e);
    }
  }

  getItem(key: string): string | null {
    this.#load();
    return this.#data[key] ?? null;
  }

  setItem(key: string, value: string): void {
    this.#load();
    this.#data[key] = value;
    this.#save();
  }

  removeItem(key: string): void {
    this.#load();
    delete this.#data[key];
    this.#save();
  }
}

// Google sends the browser back to a tiny one-shot server on this machine.
// The ports are fixed because each redirect URL must be allow-listed in the
// Supabase dashboard (Auth → URL Configuration).
const CALLBACK_PORTS = [47821, 47822, 47823];
const CALLBACK_PATH = '/auth/callback';
const SIGN_IN_TIMEOUT_MS = 5 * 60_000;

function listenOn(port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve(server);
    });
  });
}

async function listenOnCallbackPort(): Promise<{server: Server; port: number}> {
  for (const port of CALLBACK_PORTS) {
    try {
      return {server: await listenOn(port), port};
    } catch {
      // In use — try the next one.
    }
  }
  throw new Error('no callback port available');
}

/** What the browser tab shows after Google hands back. Static: nothing from the
 *  request is ever echoed into it. */
function callbackPage(ok: boolean): string {
  const title = ok ? 'You’re signed in' : 'Sign-in didn’t complete';
  const body = ok
    ? 'You can close this tab and go back to Compás.'
    : 'Close this tab, go back to Compás and try again.';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Compás</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #14100A;
    color: #F3ECDC; font: 16px/1.5 system-ui, sans-serif; }
  main { max-width: 360px; padding: 32px; text-align: center; }
  h1 { margin: 0 0 8px; font-size: 22px; }
  p { margin: 0; color: #B3A78E; }
</style></head><body><main><h1>${title}</h1><p>${body}</p></main></body></html>`;
}

/** Dev-only trace of the sign-in flow and raw backend errors, in the terminal
 *  that runs `pnpm start`. Never logs tokens, passwords or codes. */
function debug(...args: unknown[]): void {
  if (import.meta.env.DEV) console.log('[community]', ...args);
}

const HANDLE_RE = /^[a-z0-9_]{3,24}$/;

// Where a profile picture may come from (the backend enforces the same rule,
// supabase/migrations/…_avatar_sources.sql): one of the app's drawn pictures,
// the DJ's own upload, or a Google photo.
const PRESET_RE = /^preset:\d{1,2}$/;
const UPLOAD_RE = /^upload:(\d{1,20})$/;
const GOOGLE_PHOTO_RE = /^https:\/\/lh\d{1,2}\.googleusercontent\.com\/[A-Za-z0-9_/=.~-]+$/;
const isGooglePhoto = (v: unknown): v is string => typeof v === 'string' && v.length <= 2000 && GOOGLE_PHOTO_RE.test(v);

/** The picture Google gave for the account, if any. */
function googlePicture(meta: Record<string, unknown> | undefined): string | null {
  for (const key of ['avatar_url', 'picture']) {
    const v = meta?.[key];
    if (isGooglePhoto(v)) return v;
  }
  return null;
}

// A comment with its author's public name. The `!author_id` hint is required:
// comments also reach profiles through comment_likes, and without it the
// backend refuses the query as ambiguous.
const COMMENT_COLUMNS =
  'id, post_id, parent_id, author_id, body, created_at, author:profiles!author_id(handle, display_name, avatar_url)';
const NOT_CONFIGURED_MESSAGE = 'Community isn’t available in this build.';
const NOT_CONFIGURED: CommunityResult = {ok: false, error: NOT_CONFIGURED_MESSAGE};

/** Turn a backend error into a sentence a DJ can act on. */
function friendly(error: unknown, fallback: string): string {
  const e = (error ?? {}) as {message?: string; code?: string; status?: number; name?: string};
  const msg = e.message ?? '';
  debug('error:', {name: e.name, code: e.code, status: e.status, message: msg});
  if (e.name === 'AuthRetryableFetchError' || /fetch failed|network|ENOTFOUND|ECONNREFUSED|ETIMEDOUT/i.test(msg)) {
    return 'Can’t reach the Community server. Check your connection and try again.';
  }
  switch (e.code) {
    case 'invalid_credentials':
      return 'That email and password don’t match.';
    case 'email_not_confirmed':
      return 'Confirm your email first — enter the code we sent you.';
    case 'user_already_exists':
    case 'email_exists':
      return 'There’s already an account with that email. Sign in instead.';
    case 'weak_password':
      return 'Choose a longer password (at least 8 characters).';
    case 'otp_expired':
      return 'That code is wrong or has expired. Ask for a new one.';
    case 'email_address_not_authorized':
      return 'The Community server isn’t set up to send email to that address yet.';
    case 'over_email_send_rate_limit':
    case 'over_request_rate_limit':
      return 'Too many attempts. Wait a minute and try again.';
    case 'email_address_invalid':
    case 'validation_failed':
      return 'That doesn’t look like a valid email address.';
    case '23505':
      return 'That handle is taken. Try another.';
    case '42501':
      return 'You can’t do that.';
    case 'PGRST301':
      return 'Your session expired. Sign in again.';
    case '23514':
      return 'Check the name and handle: handles are 3–24 lowercase letters, numbers or underscores.';
    default:
      return msg && msg.length < 140 ? msg : fallback;
  }
}

export class CommunityService {
  readonly #config: Config | null;
  readonly #userDataDir: string;
  readonly #onChange: (state: CommunityState) => void;
  #clientInstance: SupabaseClient | null = null;
  #profile: {userId: string; handle: string; displayName: string; city: string | null; bio: string | null; avatar: string | null} | null = null;
  #pendingSignIn: {cancel: () => void} | null = null;

  /** `onChange` fires whenever the signed-in state may have changed (sign in/out,
   *  token refresh, profile edit). Construct after the app is ready. */
  constructor(userDataDir: string, onChange: (state: CommunityState) => void) {
    this.#config = communityConfig();
    this.#userDataDir = userDataDir;
    this.#onChange = onChange;
  }

  /** What to show for a DJ's stored picture: a drawn one ("preset:<n>"), a
   *  photo URL, or null (the app draws one from the id). An upload is only
   *  ever the DJ's own file on this backend: its URL is built here from the
   *  profile id, never taken from the database. */
  avatarUrl(userId: string, value: unknown): string | null {
    if (typeof value !== 'string') return null;
    if (PRESET_RE.test(value) || isGooglePhoto(value)) return value;
    const upload = UPLOAD_RE.exec(value);
    if (upload && this.#config && /^[0-9a-f-]{36}$/i.test(userId)) {
      return `${this.#config.url.replace(/\/+$/, '')}/storage/v1/object/public/avatars/${userId}.jpg?v=${upload[1]}`;
    }
    return null;
  }

  #client(): SupabaseClient | null {
    if (!this.#config) return null;
    if (this.#clientInstance) return this.#clientInstance;
    const ref = new URL(this.#config.url).host.replace(/[^a-z0-9.-]/gi, '_');
    const client = createClient(this.#config.url, this.#config.anonKey, {
      auth: {
        flowType: 'pkce',
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        storage: new SessionStore(join(this.#userDataDir, `community-session-${ref}.bin`)),
      },
    });
    // The callback must not call back into the auth client synchronously (it
    // holds the client's lock), so re-read the state on the next tick.
    client.auth.onAuthStateChange(() => {
      setTimeout(() => {
        this.getState().then(this.#onChange).catch(() => {});
      }, 0);
    });
    this.#clientInstance = client;
    return client;
  }

  async getState(): Promise<CommunityState> {
    const client = this.#client();
    if (!client) return {configured: false, user: null};
    const {data} = await client.auth.getSession();
    const authUser = data.session?.user;
    if (!authUser) {
      this.#profile = null;
      return {configured: true, user: null};
    }
    if (this.#profile?.userId !== authUser.id) {
      this.#profile = null;
      const {data: row, error: profileError} = await client
        .from('profiles')
        .select('handle, display_name, city, bio, avatar_url')
        .eq('id', authUser.id)
        .maybeSingle();
      if (row) {
        this.#profile = {userId: authUser.id, handle: row.handle, displayName: row.display_name, city: row.city, bio: row.bio, avatar: row.avatar_url};
      }
      debug(`signed in as ${authUser.id}; profile ${row ? 'loaded (@' + row.handle + ')' : 'NOT readable'}`, profileError ?? '');
    }
    return {
      configured: true,
      user: {
        id: authUser.id,
        email: authUser.email ?? null,
        handle: this.#profile?.handle ?? null,
        displayName: this.#profile?.displayName ?? null,
        city: this.#profile?.city ?? null,
        bio: this.#profile?.bio ?? null,
        avatar: this.avatarUrl(authUser.id, this.#profile?.avatar),
        googleAvatar: googlePicture(authUser.user_metadata),
      },
    };
  }

  async #done(pending?: 'confirm-email'): Promise<CommunityResult> {
    const state = await this.getState();
    return pending ? {ok: true, state, pending} : {ok: true, state};
  }

  /** Sign in with Google in the system browser. Resolves once the browser has
   *  come back to us, the DJ cancels, or five minutes pass. */
  async signInWithGoogle(): Promise<CommunityResult> {
    const client = this.#client();
    if (!client || !this.#config) return NOT_CONFIGURED;
    this.cancelSignIn();

    let server: Server;
    let port: number;
    try {
      ({server, port} = await listenOnCallbackPort());
    } catch {
      return {ok: false, error: 'Couldn’t start Google sign-in on this computer. Close other copies of Compás and try again.'};
    }

    type Outcome = {code: string} | {failed: true} | {cancelled: true};
    let timer: ReturnType<typeof setTimeout> | undefined;
    const outcome = new Promise<Outcome>(resolve => {
      timer = setTimeout(() => resolve({cancelled: true}), SIGN_IN_TIMEOUT_MS);
      this.#pendingSignIn = {cancel: () => resolve({cancelled: true})};
      server.on('request', (req, res) => {
        const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
        if (url.pathname !== CALLBACK_PATH) {
          res.writeHead(404).end();
          return;
        }
        const code = url.searchParams.get('code');
        if (!code) {
          debug('Google sign-in: callback had no code:', {
            error: url.searchParams.get('error'),
            error_code: url.searchParams.get('error_code'),
            error_description: url.searchParams.get('error_description'),
          });
        }
        res.writeHead(200, {'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store'});
        res.end(callbackPage(!!code));
        resolve(code ? {code} : {failed: true});
      });
    });

    try {
      const {data, error} = await client.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `http://127.0.0.1:${port}${CALLBACK_PATH}`,
          skipBrowserRedirect: true,
          queryParams: {prompt: 'select_account'},
        },
      });
      if (error || !data?.url) return {ok: false, error: friendly(error, 'Couldn’t start Google sign-in.')};
      // Only ever hand the OS our own backend's authorize URL.
      if (new URL(data.url).origin !== this.#config.url) {
        return {ok: false, error: 'Couldn’t start Google sign-in.'};
      }
      debug(`Google sign-in: browser opened, waiting on http://127.0.0.1:${port}${CALLBACK_PATH}`);
      await shell.openExternal(data.url);

      const result = await outcome;
      debug('Google sign-in: browser came back —', 'code' in result ? 'with a code' : 'cancelled' in result ? 'cancelled / timed out' : 'without a code');
      if ('cancelled' in result) return {ok: false, error: 'Sign-in was cancelled.', cancelled: true};
      if ('failed' in result) return {ok: false, error: 'Google sign-in didn’t complete. Try again.'};
      const {error: exchangeError} = await client.auth.exchangeCodeForSession(result.code);
      if (exchangeError) return {ok: false, error: friendly(exchangeError, 'Google sign-in didn’t complete. Try again.')};
      return await this.#done();
    } catch (e) {
      return {ok: false, error: friendly(e, 'Google sign-in didn’t complete. Try again.')};
    } finally {
      clearTimeout(timer);
      this.#pendingSignIn = null;
      server.close();
      server.closeAllConnections();
    }
  }

  /** Abandon a Google sign-in that is waiting on the browser. */
  cancelSignIn(): void {
    this.#pendingSignIn?.cancel();
  }

  async signInWithPassword(email: string, password: string): Promise<CommunityResult> {
    const client = this.#client();
    if (!client) return NOT_CONFIGURED;
    const {error} = await client.auth.signInWithPassword({email: email.trim(), password});
    if (error) return {ok: false, error: friendly(error, 'Couldn’t sign in. Try again.')};
    return this.#done();
  }

  /** Create an account. When the backend requires email confirmation there is
   *  no session yet: the result carries `pending: 'confirm-email'` and the DJ
   *  finishes with confirmSignUp(). */
  async signUp(email: string, password: string): Promise<CommunityResult> {
    const client = this.#client();
    if (!client) return NOT_CONFIGURED;
    if (password.length < 8) return {ok: false, error: 'Choose a password of at least 8 characters.'};
    const {data, error} = await client.auth.signUp({email: email.trim(), password});
    if (error) return {ok: false, error: friendly(error, 'Couldn’t create the account. Try again.')};
    // An address that is already registered (e.g. through Google) gets no error
    // and no email from the backend — just a placeholder user with no
    // identities. Say so, instead of sending the DJ to wait for a code.
    if (!data.session && data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      debug('sign-up: that email is already registered — no confirmation email is sent');
      return {
        ok: false,
        error: 'There’s already an account with that email. Sign in instead — with Google, if that’s how you joined.',
      };
    }
    debug(data.session ? 'sign-up: account created and signed in' : 'sign-up: account created, confirmation email requested');
    return this.#done(data.session ? undefined : 'confirm-email');
  }

  async confirmSignUp(email: string, code: string): Promise<CommunityResult> {
    const client = this.#client();
    if (!client) return NOT_CONFIGURED;
    const {error} = await client.auth.verifyOtp({email: email.trim(), token: code.trim(), type: 'signup'});
    if (error) return {ok: false, error: friendly(error, 'That code didn’t work. Try again.')};
    return this.#done();
  }

  async resendSignUpCode(email: string): Promise<CommunityResult> {
    const client = this.#client();
    if (!client) return NOT_CONFIGURED;
    const {error} = await client.auth.resend({type: 'signup', email: email.trim()});
    if (error) return {ok: false, error: friendly(error, 'Couldn’t send a new code. Try again in a minute.')};
    return this.#done('confirm-email');
  }

  /** Sign out on this computer only (other devices stay signed in). */
  async signOut(): Promise<CommunityResult> {
    const client = this.#client();
    if (!client) return NOT_CONFIGURED;
    this.cancelSignIn();
    await client.auth.signOut({scope: 'local'});
    this.#profile = null;
    return this.#done();
  }

  async updateProfile(input: ProfileInput): Promise<CommunityResult> {
    const client = this.#client();
    if (!client) return NOT_CONFIGURED;
    const displayName = (input.displayName ?? '').trim();
    const handle = (input.handle ?? '').trim().toLowerCase();
    const city = (input.city ?? '').trim() || null;
    const bio = (input.bio ?? '').trim() || null;
    if (displayName.length < 1 || displayName.length > 60) return {ok: false, error: 'Your name should be 1–60 characters.'};
    if (!HANDLE_RE.test(handle)) {
      return {ok: false, error: 'Handles are 3–24 lowercase letters, numbers or underscores.'};
    }
    if (city && city.length > 60) return {ok: false, error: 'City should be at most 60 characters.'};
    if (bio && bio.length > 280) return {ok: false, error: 'The bio should be at most 280 characters.'};

    const {data: session} = await client.auth.getSession();
    const userId = session.session?.user.id;
    if (!userId) return {ok: false, error: 'Sign in first.'};
    const {data: row, error} = await client
      .from('profiles')
      .update({display_name: displayName, handle, city, bio})
      .eq('id', userId)
      .select('handle, display_name, city, bio, avatar_url')
      .maybeSingle();
    if (error) return {ok: false, error: friendly(error, 'Couldn’t save your profile. Try again.')};
    if (!row) return {ok: false, error: 'Couldn’t save your profile. Try again.'};
    this.#profile = {userId, handle: row.handle, displayName: row.display_name, city: row.city, bio: row.bio, avatar: row.avatar_url};
    const state = await this.getState();
    this.#onChange(state);
    return {ok: true, state};
  }

  /** Set the profile picture: "preset:<n>", the Google photo's URL, or null
   *  for the app's own choice. Uploads go through uploadAvatar. */
  async setAvatar(value: string | null): Promise<CommunityResult> {
    const client = this.#client();
    if (!client) return NOT_CONFIGURED;
    const {data: session} = await client.auth.getSession();
    const userId = session.session?.user.id;
    if (!userId) return {ok: false, error: 'Sign in first.'};
    // Only a preset, or the picture Google gave this very account.
    const google = googlePicture(session.session?.user.user_metadata);
    const avatar = value && PRESET_RE.test(value) ? value : value && value === google ? value : null;
    if (value && !avatar) return {ok: false, error: 'That picture can’t be used.'};
    return this.#saveAvatar(client, userId, avatar);
  }

  /** Upload an (already resized) JPEG as the profile picture. */
  async uploadAvatar(jpeg: Buffer): Promise<CommunityResult> {
    const client = this.#client();
    if (!client) return NOT_CONFIGURED;
    const {data: session} = await client.auth.getSession();
    const userId = session.session?.user.id;
    if (!userId) return {ok: false, error: 'Sign in first.'};
    if (jpeg.length > 1_000_000) return {ok: false, error: 'That picture is too large.'};
    const name = `${userId}.jpg`;
    const {error} = await client.storage.from('avatars').upload(name, jpeg, {contentType: 'image/jpeg', upsert: true});
    if (error) return {ok: false, error: friendly(error, 'Couldn’t upload the picture. Try again.')};
    // A new version under the same name: the version goes in the URL, so caches
    // fetch the new picture.
    return this.#saveAvatar(client, userId, `upload:${Date.now()}`);
  }

  /** Remove the DJ's uploaded photo from the public bucket. Nothing there is
   *  fine; a failure is reported, so a photo is never left behind silently. */
  async #removeUpload(client: SupabaseClient, userId: string): Promise<{ok: true} | {ok: false; error: string}> {
    const {error} = await client.storage.from('avatars').remove([`${userId}.jpg`]);
    if (error) return {ok: false, error: friendly(error, 'Couldn’t remove your photo. Try again.')};
    return {ok: true};
  }

  async #saveAvatar(client: SupabaseClient, userId: string, avatar: string | null): Promise<CommunityResult> {
    // Moving away from an uploaded photo deletes the file, not just the link to it.
    if (!avatar?.startsWith('upload:') && this.#profile?.userId === userId && this.#profile.avatar?.startsWith('upload:')) {
      const removed = await this.#removeUpload(client, userId);
      if (!removed.ok) return removed;
    }
    const {data: row, error} = await client
      .from('profiles')
      .update({avatar_url: avatar})
      .eq('id', userId)
      .select('handle, display_name, city, bio, avatar_url')
      .maybeSingle();
    if (error) return {ok: false, error: friendly(error, 'Couldn’t save the picture. Try again.')};
    if (!row) return {ok: false, error: 'Couldn’t save the picture. Try again.'};
    this.#profile = {userId, handle: row.handle, displayName: row.display_name, city: row.city, bio: row.bio, avatar: row.avatar_url};
    const state = await this.getState();
    this.#onChange(state);
    return {ok: true, state};
  }

  /** Permanently delete the account and everything it posted, then sign out.
   *  An uploaded photo is removed first: it lives in a public bucket, outside
   *  what deleting the account's rows takes with it. */
  async deleteAccount(): Promise<CommunityResult> {
    const client = this.#client();
    if (!client) return NOT_CONFIGURED;
    const userId = await this.#userId(client);
    if (!userId) return {ok: false, error: 'Sign in first.'};
    const removed = await this.#removeUpload(client, userId);
    if (!removed.ok) return removed;
    const {error} = await client.rpc('delete_my_account');
    if (error) return {ok: false, error: friendly(error, 'Couldn’t delete the account. Try again.')};
    await client.auth.signOut({scope: 'local'});
    this.#profile = null;
    return this.#done();
  }

  // ---- posts, likes, comments -------------------------------------------------

  async #userId(client: SupabaseClient): Promise<string | null> {
    const {data} = await client.auth.getSession();
    return data.session?.user.id ?? null;
  }

  /** Publish a post: a shared tanda (song details only) or a question. */
  async createPost(input: {kind: 'tanda' | 'question'; note: string; tanda?: unknown}): Promise<Outcome<{id: string}>> {
    const client = this.#client();
    if (!client) return {ok: false, error: NOT_CONFIGURED_MESSAGE};
    if (!(await this.#userId(client))) return {ok: false, error: 'Sign in first.'};
    const row: Record<string, unknown> = {kind: input.kind, note: input.note};
    if (input.kind === 'tanda') row.tanda = input.tanda;
    const {data, error} = await client.from('posts').insert(row).select('id').single();
    if (error || !data) return {ok: false, error: friendly(error, 'Couldn’t post that. Try again.')};
    return {ok: true, id: data.id as string};
  }

  /** Delete one of the signed-in DJ's own posts. A post that is already gone
   *  counts as deleted; one that is still there afterwards belongs to another
   *  account (the rules let a DJ delete only their own), and says so. */
  async deletePost(id: string): Promise<Outcome<object>> {
    const client = this.#client();
    if (!client) return {ok: false, error: NOT_CONFIGURED_MESSAGE};
    const {data, error} = await client.from('posts').delete().eq('id', id).select('id');
    if (error) return {ok: false, error: friendly(error, 'Couldn’t delete that post. Try again.')};
    if ((data ?? []).length === 0) {
      const {data: still, error: checkError} = await client.from('posts').select('id').eq('id', id).limit(1);
      if (checkError) return {ok: false, error: friendly(checkError, 'Couldn’t delete that post. Try again.')};
      if ((still ?? []).length > 0) return {ok: false, error: 'That post was shared from another Community account.'};
    }
    return {ok: true};
  }

  /** Which of these posts the signed-in DJ wrote. */
  async ownPostIds(ids: string[]): Promise<Set<string>> {
    const client = this.#client();
    if (!client || ids.length === 0) return new Set();
    const userId = await this.#userId(client);
    if (!userId) return new Set();
    const {data} = await client.from('posts').select('id').in('id', ids).eq('author_id', userId);
    return new Set((data ?? []).map(r => r.id as string));
  }

  /** One page of the feed: `limit` posts starting at `offset` in the chosen
   *  order, optionally only tandas or only questions. */
  async listPosts(opts: {
    scope: FeedScope;
    sort: FeedSort;
    kind: 'tanda' | 'question' | null;
    // Only tandas with this orchestra (a normalised key such as "pugliese").
    orq: string | null;
    // Just this one post (opened from a notification).
    id?: string | null;
    // Just one DJ's posts (their profile page).
    author?: string | null;
    offset: number;
    limit: number;
  }): Promise<Outcome<{rows: FeedRow[]; userId: string}>> {
    const client = this.#client();
    if (!client) return {ok: false, error: NOT_CONFIGURED_MESSAGE};
    const userId = await this.#userId(client);
    if (!userId) return {ok: false, error: 'Sign in first.'};

    const run = (sort: FeedSort) => {
      let query = client.from('feed_posts').select('*');
      if (opts.scope === 'mine') query = query.eq('author_id', userId);
      if (opts.scope === 'following') query = query.eq('author_followed', true);
      if (opts.author) query = query.eq('author_id', opts.author);
      // Saved posts are filtered by the view itself, so they page like any other
      // list, however many there are.
      if (opts.scope === 'saved') query = query.eq('viewer_saved', true);
      if (opts.kind) query = query.eq('kind', opts.kind);
      if (opts.orq) query = query.contains('orq_keys', [opts.orq]);
      if (opts.id) query = query.eq('id', opts.id);
      if (sort === 'popular') query = query.order('popularity', {ascending: false});
      if (sort === 'liked') query = query.order('like_count', {ascending: false});
      return query
        .order('created_at', {ascending: false})
        .order('id', {ascending: false})
        .range(opts.offset, opts.offset + opts.limit - 1);
    };

    let {data, error} = await run(opts.sort);
    // A backend that predates the popularity score (migration not applied yet)
    // has no such column: show the newest posts rather than an error.
    if (error && error.code === '42703' && opts.sort === 'popular') {
      debug('feed: no popularity column on this backend yet — falling back to newest');
      ({data, error} = await run('new'));
    }
    if (error) return {ok: false, error: friendly(error, 'Couldn’t load the feed. Try again.')};
    return {ok: true, rows: (data ?? []) as FeedRow[], userId};
  }

  /** The signed-in DJ's latest notifications, newest first, and when they last
   *  looked (null if never) — what is newer than that is unread. */
  async listNotifications(limit: number): Promise<Outcome<{rows: NotificationRow[]; seenAt: string | null}>> {
    const client = this.#client();
    if (!client) return {ok: false, error: NOT_CONFIGURED_MESSAGE};
    const {data, error} = await client
      .from('my_notifications')
      .select('*')
      .order('created_at', {ascending: false})
      .limit(limit);
    if (error) return {ok: false, error: friendly(error, 'Couldn’t load your notifications.')};
    const {data: state} = await client.from('notification_state').select('seen_at').maybeSingle();
    return {ok: true, rows: (data ?? []) as NotificationRow[], seenAt: (state?.seen_at as string | undefined) ?? null};
  }

  /** How many notifications are newer than the DJ's last look. */
  async unreadNotifications(): Promise<Outcome<{unread: number}>> {
    const client = this.#client();
    if (!client) return {ok: false, error: NOT_CONFIGURED_MESSAGE};
    if (!(await this.#userId(client))) return {ok: true, unread: 0};
    const {data, error} = await client.rpc('unread_notifications');
    if (error) return {ok: false, error: friendly(error, 'Couldn’t check your notifications.')};
    return {ok: true, unread: Math.max(0, Number(data) || 0)};
  }

  /** Record that the DJ has looked: everything so far is seen. */
  async markNotificationsSeen(): Promise<Outcome<object>> {
    const client = this.#client();
    if (!client) return {ok: false, error: NOT_CONFIGURED_MESSAGE};
    const {error} = await client.rpc('mark_notifications_seen');
    if (error) return {ok: false, error: friendly(error, 'Couldn’t update your notifications.')};
    return {ok: true};
  }

  /** The orchestras that appear in shared tandas, most shared first — the
   *  choices of the feed's orchestra filter. */
  async listOrchestras(): Promise<Outcome<{rows: {key: string; name: string; tandas: number}[]}>> {
    const client = this.#client();
    if (!client) return {ok: false, error: NOT_CONFIGURED_MESSAGE};
    const {data, error} = await client
      .from('feed_orchestras')
      .select('key, name, tandas')
      .order('tandas', {ascending: false})
      .order('name', {ascending: true})
      .limit(200);
    if (error) return {ok: false, error: friendly(error, 'Couldn’t load the orchestras.')};
    return {ok: true, rows: (data ?? []) as {key: string; name: string; tandas: number}[]};
  }

  /** When the newest post the signed-in DJ can see was made (null if there are
   *  none) — a cheap way to tell whether the feed has something new. */
  async latestPostAt(): Promise<Outcome<{latestAt: string | null}>> {
    const client = this.#client();
    if (!client) return {ok: false, error: NOT_CONFIGURED_MESSAGE};
    const {data, error} = await client
      .from('feed_posts')
      .select('created_at')
      .order('created_at', {ascending: false})
      .limit(1);
    if (error) return {ok: false, error: friendly(error, 'Couldn’t check for new posts.')};
    return {ok: true, latestAt: (data?.[0]?.created_at as string | undefined) ?? null};
  }

  /** The newest `perPost` comments of each given post — the preview shown under
   *  a post in the feed. Newest first within a post. */
  async listCommentPreviews(postIds: string[], perPost: number): Promise<Outcome<{rows: CommentRow[]}>> {
    const client = this.#client();
    if (!client) return {ok: false, error: NOT_CONFIGURED_MESSAGE};
    if (postIds.length === 0) return {ok: true, rows: []};
    const {data, error} = await client
      .from('posts')
      .select(`id, comments!post_id(${COMMENT_COLUMNS})`)
      .in('id', postIds)
      .order('created_at', {referencedTable: 'comments', ascending: false})
      .order('id', {referencedTable: 'comments', ascending: false})
      .limit(perPost, {referencedTable: 'comments'});
    if (error) return {ok: false, error: friendly(error, 'Couldn’t load comments.')};
    const rows = ((data ?? []) as unknown as {comments: CommentRow[] | null}[]).flatMap(p => p.comments ?? []);
    return {ok: true, rows};
  }

  /** One page of a post's comments, newest first, before `before` (the oldest
   *  comment already shown). Ordered by time and then id, and the cursor has
   *  both, so comments made in the same instant are neither skipped nor
   *  repeated across pages. */
  async listCommentsPage(
    postId: string,
    before: {createdAt: string; id: string} | null,
    limit: number,
  ): Promise<Outcome<{rows: CommentRow[]}>> {
    const client = this.#client();
    if (!client) return {ok: false, error: NOT_CONFIGURED_MESSAGE};
    let query = client.from('comments').select(COMMENT_COLUMNS).eq('post_id', postId);
    if (before) {
      const at = `"${before.createdAt}"`;
      query = query.or(`created_at.lt.${at},and(created_at.eq.${at},id.lt.${before.id})`);
    }
    const {data, error} = await query
      .order('created_at', {ascending: false})
      .order('id', {ascending: false})
      .limit(limit);
    if (error) return {ok: false, error: friendly(error, 'Couldn’t load comments.')};
    return {ok: true, rows: (data ?? []) as unknown as CommentRow[]};
  }

  async addComment(postId: string, body: string, parentId: string | null): Promise<Outcome<{row: CommentRow}>> {
    const client = this.#client();
    if (!client) return {ok: false, error: NOT_CONFIGURED_MESSAGE};
    const {data, error} = await client
      .from('comments')
      .insert({post_id: postId, body, parent_id: parentId})
      .select(COMMENT_COLUMNS)
      .single();
    if (error || !data) return {ok: false, error: friendly(error, 'Couldn’t post your comment. Try again.')};
    return {ok: true, row: data as unknown as CommentRow};
  }

  /** Delete a comment (and with it, its replies). Resolves to the post's
   *  comment count afterwards — the backend's own, since replies not loaded
   *  here go too — or null if it couldn't be read. */
  async deleteComment(id: string, postId: string): Promise<Outcome<{commentCount: number | null}>> {
    const client = this.#client();
    if (!client) return {ok: false, error: NOT_CONFIGURED_MESSAGE};
    const {error} = await client.from('comments').delete().eq('id', id);
    if (error) return {ok: false, error: friendly(error, 'Couldn’t delete that comment. Try again.')};
    const {data} = await client.from('feed_posts').select('comment_count').eq('id', postId).limit(1);
    const count = Number(data?.[0]?.comment_count);
    return {ok: true, commentCount: Number.isFinite(count) ? Math.max(0, count) : null};
  }

  /** Like/unlike or save/unsave a post. Repeating the current state is fine. */
  async #toggle(table: 'post_likes' | 'saves', postId: string, on: boolean): Promise<Outcome<object>> {
    const client = this.#client();
    if (!client) return {ok: false, error: NOT_CONFIGURED_MESSAGE};
    const userId = await this.#userId(client);
    if (!userId) return {ok: false, error: 'Sign in first.'};
    const {error} = on
      ? await client.from(table).insert({post_id: postId})
      : await client.from(table).delete().eq('post_id', postId).eq('user_id', userId);
    // 23505: already liked/saved — the state the DJ asked for.
    if (error && error.code !== '23505') return {ok: false, error: friendly(error, 'That didn’t go through. Try again.')};
    return {ok: true};
  }

  setLiked(postId: string, on: boolean): Promise<Outcome<object>> {
    return this.#toggle('post_likes', postId, on);
  }

  setSaved(postId: string, on: boolean): Promise<Outcome<object>> {
    return this.#toggle('saves', postId, on);
  }

  // ---- profiles and following -----------------------------------------------

  /** One DJ as their page shows them, or null if there is no such DJ. */
  async getProfile(id: string): Promise<Outcome<{row: ProfileRow | null; userId: string}>> {
    const client = this.#client();
    if (!client) return {ok: false, error: NOT_CONFIGURED_MESSAGE};
    const userId = await this.#userId(client);
    if (!userId) return {ok: false, error: 'Sign in first.'};
    const {data, error} = await client.from('profile_cards').select('*').eq('id', id).maybeSingle();
    if (error) return {ok: false, error: friendly(error, 'Couldn’t load that profile. Try again.')};
    return {ok: true, row: (data as ProfileRow | null) ?? null, userId};
  }

  /** Follow (or stop following) a DJ. Already following counts as done. */
  async setFollow(id: string, on: boolean): Promise<Outcome<object>> {
    const client = this.#client();
    if (!client) return {ok: false, error: NOT_CONFIGURED_MESSAGE};
    const userId = await this.#userId(client);
    if (!userId) return {ok: false, error: 'Sign in first.'};
    if (id === userId) return {ok: false, error: 'That’s you.'};
    const {error} = on
      ? await client.from('follows').insert({followee_id: id})
      : await client.from('follows').delete().eq('follower_id', userId).eq('followee_id', id);
    if (error && error.code !== '23505') {
      return {ok: false, error: friendly(error, on ? 'Couldn’t follow that DJ. Try again.' : 'Couldn’t unfollow. Try again.')};
    }
    return {ok: true};
  }

  /** Who follows a DJ, or whom they follow, newest first. */
  async listFollows(
    id: string,
    which: 'followers' | 'following',
    offset: number,
    limit: number,
  ): Promise<Outcome<{rows: FollowRow[]; userId: string}>> {
    const client = this.#client();
    if (!client) return {ok: false, error: NOT_CONFIGURED_MESSAGE};
    const userId = await this.#userId(client);
    if (!userId) return {ok: false, error: 'Sign in first.'};
    // The other side of each row, embedded by the foreign key it means.
    const side = which === 'followers' ? 'follower_id' : 'followee_id';
    const {data, error} = await client
      .from('follows')
      .select(`created_at, profile:profiles!${side}(id, handle, display_name, city, avatar_url)`)
      .eq(which === 'followers' ? 'followee_id' : 'follower_id', id)
      .order('created_at', {ascending: false})
      .range(offset, offset + limit - 1);
    if (error) return {ok: false, error: friendly(error, 'Couldn’t load that list. Try again.')};
    return {ok: true, rows: (data ?? []) as unknown as FollowRow[], userId};
  }

  /** The ids of every DJ the signed-in DJ follows (to mark them in lists). */
  async followingIds(): Promise<Set<string>> {
    const client = this.#client();
    if (!client) return new Set();
    const {data} = await client.from('follows').select('followee_id').limit(1000);
    return new Set((data ?? []).map(r => r.followee_id as string));
  }

  async report(target: {postId?: string | null; commentId?: string | null}, reason: string): Promise<Outcome<object>> {
    const client = this.#client();
    if (!client) return {ok: false, error: NOT_CONFIGURED_MESSAGE};
    const {error} = await client
      .from('reports')
      .insert({post_id: target.postId ?? null, comment_id: target.commentId ?? null, reason});
    if (error) return {ok: false, error: friendly(error, 'Couldn’t send the report. Try again.')};
    return {ok: true};
  }

  /** Hide everything a DJ posts from the signed-in DJ. */
  async block(userId: string): Promise<Outcome<object>> {
    const client = this.#client();
    if (!client) return {ok: false, error: NOT_CONFIGURED_MESSAGE};
    const {error} = await client.from('blocks').insert({blocked_id: userId});
    if (error && error.code !== '23505') return {ok: false, error: friendly(error, 'Couldn’t block that DJ. Try again.')};
    return {ok: true};
  }
}
