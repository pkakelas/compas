import {createServer, type IncomingMessage, type Server, type ServerResponse} from 'node:http';
import type {AddressInfo} from 'node:net';

/**
 * A tiny in-process stand-in for the Community backend (Supabase): just enough
 * of the auth and REST endpoints for the app's account flows. One hard-coded
 * account exists; a second can be created through sign-up + code confirmation.
 * Nothing here is a real credential — the values only exist inside this stub.
 */
export const STUB_ANON_KEY = 'stub-anon-key';
export const STUB_ACCOUNT = {email: 'dj@example.test', password: 'stub-password-1'};
export const STUB_NEW_ACCOUNT = {email: 'new-dj@example.test', password: 'stub-password-2', code: '123456'};

type Profile = {id: string; handle: string; display_name: string; city: string | null; bio?: string | null; avatar_url?: string | null};

export type StubPost = {
  id: string;
  author_id: string;
  kind: 'tanda' | 'question';
  note: string;
  tanda: unknown;
  created_at: string;
};
export type StubComment = {
  id: string;
  post_id: string;
  parent_id: string | null;
  author_id: string;
  body: string;
  created_at: string;
};

/** Two other DJs and their posts, for specs that exercise the feed. */
export const STUB_MARTA = '33333333-3333-4333-8333-333333333333';
export const STUB_LUCIA = '44444444-4444-4444-8444-444444444444';
export const STUB_MARTA_POST = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const STUB_LUCIA_POST = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

export type CommunityStub = {
  url: string;
  /** Profile rows by user id — tests read these to assert writes landed. */
  profiles: Map<string, Profile>;
  /** User ids removed through delete_my_account. */
  deleted: Set<string>;
  /** Every access token ever issued, to check none is stored in clear. */
  issuedTokens: string[];
  posts: StubPost[];
  comments: StubComment[];
  /** "postId|userId" pairs. */
  likes: Set<string>;
  saves: Set<string>;
  /** "blockerId|blockedId" pairs. */
  blocks: Set<string>;
  /** "followerId|followeeId" pairs, and when each started (ISO time). */
  follows: Set<string>;
  followedAt: Map<string, string>;
  reports: Record<string, unknown>[];
  /** Files in the `avatars` bucket, by name ("<user id>.jpg"). */
  uploads: Map<string, Buffer>;
  close(): Promise<void>;
};

const b64url = (v: unknown): string => Buffer.from(JSON.stringify(v)).toString('base64url');

function readRaw(req: IncomingMessage): Promise<Buffer> {
  return new Promise(resolve => {
    const chunks: Buffer[] = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });
}
function parseBody(raw: Buffer): Record<string, unknown> {
  try {
    return raw.length ? JSON.parse(raw.toString('utf8')) : {};
  } catch {
    return {};
  }
}

export async function startCommunityStub(opts: {seedFeed?: boolean} = {}): Promise<CommunityStub> {
  const users = new Map<string, {id: string; password: string; confirmed: boolean}>([
    [STUB_ACCOUNT.email, {id: '11111111-1111-4111-8111-111111111111', password: STUB_ACCOUNT.password, confirmed: true}],
  ]);
  const profiles = new Map<string, Profile>([
    ['11111111-1111-4111-8111-111111111111', {id: '11111111-1111-4111-8111-111111111111', handle: 'dj_test', display_name: 'Test DJ', city: null}],
  ]);
  const deleted = new Set<string>();
  const issuedTokens: string[] = [];
  let issued = 0;

  const posts: StubPost[] = [];
  const comments: StubComment[] = [];
  const likes = new Set<string>();
  const saves = new Set<string>();
  const blocks = new Set<string>();
  const follows = new Set<string>();
  // When each follow started ("followerId|followeeId" → ISO time).
  const followedAt = new Map<string, string>();
  // When each user last looked at their notifications.
  const seenAt = new Map<string, string>();
  // When each like was given ("postId|userId" → ISO time).
  const likedAt = new Map<string, string>();
  const reports: Record<string, unknown>[] = [];
  const uploads = new Map<string, Buffer>();
  let nextId = 0;
  const newId = () => `cccccccc-cccc-4ccc-8ccc-${String(++nextId).padStart(12, '0')}`;
  if (opts.seedFeed) {
    profiles.set(STUB_MARTA, {id: STUB_MARTA, handle: 'marta', display_name: 'Marta Kowalczyk', city: 'Kraków'});
    profiles.set(STUB_LUCIA, {id: STUB_LUCIA, handle: 'lucia', display_name: 'Lucía Rivas', city: null});
    posts.push({
      id: STUB_MARTA_POST,
      author_id: STUB_MARTA,
      kind: 'tanda',
      note: 'For the last hour, when the lights are low.',
      // Two of these are in the specs' fixture library; "Tristeza Marina" is not.
      tanda: {
        name: 'Di Sarli, late night',
        tags: [{cat: 'type', label: 'Tango'}, {cat: 'mood', label: 'Lyrical'}],
        songs: [
          {title: 'Nido Gaucho', orq: 'Carlos Di Sarli', singer: 'Alberto Podestá', year: 1942, genre: 'tango'},
          {title: 'Verdemar', orq: 'Carlos Di Sarli', singer: 'Alberto Podestá', year: 1943, genre: 'tango'},
          {title: 'Tristeza Marina', orq: 'Carlos Di Sarli', singer: 'Alberto Podestá', year: 1943, genre: 'tango'},
        ],
      },
      created_at: '2026-01-02T10:00:00.000Z',
    });
    posts.push({
      id: STUB_LUCIA_POST,
      author_id: STUB_LUCIA,
      kind: 'question',
      note: 'What do you play right after a Pugliese tanda?',
      tanda: null,
      created_at: '2026-01-01T10:00:00.000Z',
    });
    comments.push({
      id: newId(),
      post_id: STUB_LUCIA_POST,
      parent_id: null,
      author_id: STUB_MARTA,
      body: 'A light vals. Nothing heavy.',
      created_at: '2026-01-01T11:00:00.000Z',
    });
  }
  // PostgREST filter values: "eq.x", "lt.x", "in.(a,b)".
  const eq = (url: URL, key: string): string | null => {
    const v = url.searchParams.get(key);
    return v && v.startsWith('eq.') ? v.slice(3) : null;
  };
  const inList = (url: URL, key: string): string[] | null => {
    const v = url.searchParams.get(key);
    if (!v || !v.startsWith('in.(')) return null;
    return v.slice(4, -1).split(',').map(x => x.replace(/^"|"$/g, '')).filter(Boolean);
  };
  // The orchestra keys the real backend files a tanda under: the key the app
  // sent per song, else the last word of the orchestra's name.
  const songKey = (song: {orq?: string; orq_key?: string}): string =>
    (song.orq_key ?? (song.orq ?? '').trim().split(/\s+/).pop() ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9']/g, '');
  const tandaSongs = (p: StubPost): {orq?: string; orq_key?: string}[] =>
    p.kind === 'tanda' ? ((p.tanda as {songs?: {orq?: string; orq_key?: string}[]})?.songs ?? []) : [];
  const orqKeys = (p: StubPost): string[] => [...new Set(tandaSongs(p).map(songKey).filter(Boolean))];
  // What the real `my_notifications` view returns: other people's likes and
  // comments on my posts, and their replies to my comments elsewhere.
  const notificationsFor = (me: string) => {
    const title = (p: StubPost) => (p.tanda as {name?: string} | null)?.name || p.note.slice(0, 80) || null;
    const name = (id: string) => profiles.get(id)?.display_name ?? '';
    const rows: Record<string, unknown>[] = [];
    for (const key of likes) {
      const [postId, userId] = key.split('|');
      const p = posts.find(x => x.id === postId);
      if (!p || p.author_id !== me || userId === me || blocks.has(`${me}|${userId}`)) continue;
      rows.push({kind: 'like', created_at: likedAt.get(key) ?? '2026-01-01T00:00:00.000Z', actor_id: userId, actor_name: name(userId), actor_avatar: profiles.get(userId)?.avatar_url ?? null,
        post_id: p.id, post_kind: p.kind, post_title: title(p), comment_id: null, body: null});
    }
    for (const c of comments) {
      const p = posts.find(x => x.id === c.post_id);
      if (!p || c.author_id === me || blocks.has(`${me}|${c.author_id}`)) continue;
      const parent = c.parent_id ? comments.find(x => x.id === c.parent_id) : null;
      const kind = p.author_id === me ? 'comment' : parent?.author_id === me ? 'reply' : null;
      if (!kind) continue;
      rows.push({kind, created_at: c.created_at, actor_id: c.author_id, actor_name: name(c.author_id), actor_avatar: profiles.get(c.author_id)?.avatar_url ?? null,
        post_id: p.id, post_kind: p.kind, post_title: title(p), comment_id: c.id, body: c.body.slice(0, 140)});
    }
    for (const key of follows) {
      const [follower, followee] = key.split('|');
      if (followee !== me || blocks.has(`${me}|${follower}`)) continue;
      rows.push({kind: 'follow', created_at: followedAt.get(key) ?? '2026-01-01T00:00:00.000Z', actor_id: follower, actor_name: name(follower), actor_avatar: profiles.get(follower)?.avatar_url ?? null,
        post_id: null, post_kind: null, post_title: null, comment_id: null, body: null});
    }
    // Every DJ's first notification, from Compás itself, dated when they joined.
    rows.push({kind: 'welcome', created_at: '2025-12-31T00:00:00.000Z', actor_id: me, actor_name: 'Compás', actor_avatar: null,
      post_id: null, post_kind: null, post_title: null, comment_id: null, body: null});
    return rows.sort((x, y) => String(y.created_at).localeCompare(String(x.created_at)));
  };
  const feedRow = (p: StubPost, me: string) => {
    const a = profiles.get(p.author_id);
    return {
      ...p,
      like_count: [...likes].filter(k => k.startsWith(p.id + '|')).length,
      comment_count: comments.filter(c => c.post_id === p.id).length,
      author_handle: a?.handle ?? '',
      author_name: a?.display_name ?? '',
      author_city: a?.city ?? null,
      viewer_liked: likes.has(`${p.id}|${me}`),
      viewer_saved: saves.has(`${p.id}|${me}`),
      orq_keys: orqKeys(p),
      author_followed: follows.has(`${me}|${p.author_id}`),
      author_avatar: a?.avatar_url ?? null,
    };
  };
  // What the real `profile_cards` view returns for one DJ.
  const profileCard = (pr: Profile, me: string) => ({
    id: pr.id,
    handle: pr.handle,
    display_name: pr.display_name,
    city: pr.city,
    bio: pr.bio ?? null,
    created_at: '2026-01-01T00:00:00.000Z',
    tanda_count: posts.filter(p => p.author_id === pr.id && p.kind === 'tanda').length,
    post_count: posts.filter(p => p.author_id === pr.id).length,
    follower_count: [...follows].filter(k => k.endsWith('|' + pr.id)).length,
    following_count: [...follows].filter(k => k.startsWith(pr.id + '|')).length,
    viewer_follows: follows.has(`${me}|${pr.id}`),
    follows_viewer: follows.has(`${pr.id}|${me}`),
    avatar_url: pr.avatar_url ?? null,
  });
  const commentRow = (c: StubComment) => {
    const a = profiles.get(c.author_id);
    return {...c, author: a ? {handle: a.handle, display_name: a.display_name, avatar_url: a.avatar_url ?? null} : null};
  };

  const userJson = (email: string, id: string) => ({
    id,
    aud: 'authenticated',
    role: 'authenticated',
    email,
    app_metadata: {provider: 'email', providers: ['email']},
    user_metadata: {},
    created_at: '2026-01-01T00:00:00Z',
  });
  const session = (email: string, id: string) => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const token = `${b64url({alg: 'HS256', typ: 'JWT'})}.${b64url({sub: id, email, role: 'authenticated', aud: 'authenticated', exp, n: ++issued})}.stub`;
    issuedTokens.push(token);
    return {
      access_token: token,
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: exp,
      refresh_token: `stub-refresh-${id}`,
      user: userJson(email, id),
    };
  };
  const json = (res: ServerResponse, status: number, body?: unknown) => {
    res.writeHead(status, {'content-type': 'application/json'});
    res.end(body === undefined ? '' : JSON.stringify(body));
  };
  // The signed-in user id, read back out of the bearer token this stub issued.
  const bearerUser = (req: IncomingMessage): string | null => {
    const token = (req.headers.authorization ?? '').replace(/^Bearer /, '');
    if (!issuedTokens.includes(token)) return null;
    return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).sub;
  };

  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://stub');
    const route = `${req.method} ${url.pathname}`;
    const raw = req.method === 'GET' ? Buffer.alloc(0) : await readRaw(req);
    const body = parseBody(raw);
    const wantsObject = (req.headers.accept ?? '').includes('vnd.pgrst.object');

    if (route === 'POST /auth/v1/token') {
      const grant = url.searchParams.get('grant_type');
      if (grant === 'password') {
        const email = String(body.email ?? '');
        const user = users.get(email);
        if (!user || user.password !== body.password || deleted.has(user.id)) {
          return json(res, 400, {code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials'});
        }
        if (!user.confirmed) return json(res, 400, {code: 400, error_code: 'email_not_confirmed', msg: 'Email not confirmed'});
        return json(res, 200, session(email, user.id));
      }
      if (grant === 'refresh_token') {
        const id = String(body.refresh_token ?? '').replace('stub-refresh-', '');
        const entry = [...users].find(([, u]) => u.id === id);
        if (!entry || deleted.has(id)) return json(res, 400, {code: 400, error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token'});
        return json(res, 200, session(entry[0], id));
      }
    }
    if (route === 'POST /auth/v1/signup') {
      const email = String(body.email ?? '');
      // Like the real backend: an already-registered address gets a placeholder
      // user with no identities, no error, and no email.
      if (users.get(email)?.confirmed) {
        return json(res, 200, {...userJson(email, '99999999-9999-4999-8999-999999999999'), identities: []});
      }
      const id = '22222222-2222-4222-8222-222222222222';
      users.set(email, {id, password: String(body.password ?? ''), confirmed: false});
      profiles.set(id, {id, handle: 'dj_2222222222', display_name: 'New DJ', city: null});
      return json(res, 200, {...userJson(email, id), identities: [{provider: 'email'}], confirmation_sent_at: new Date().toISOString()});
    }
    if (route === 'POST /auth/v1/verify') {
      const email = String(body.email ?? '');
      const user = users.get(email);
      if (!user || body.token !== STUB_NEW_ACCOUNT.code) {
        return json(res, 403, {code: 403, error_code: 'otp_expired', msg: 'Token has expired or is invalid'});
      }
      user.confirmed = true;
      return json(res, 200, session(email, user.id));
    }
    if (route === 'POST /auth/v1/logout') return json(res, 204);
    if (route === 'GET /auth/v1/user') {
      const id = bearerUser(req);
      const entry = [...users].find(([, u]) => u.id === id);
      return entry ? json(res, 200, userJson(entry[0], entry[1].id)) : json(res, 401, {msg: 'unauthorized'});
    }

    if (url.pathname === '/rest/v1/profiles') {
      const me = bearerUser(req);
      if (!me) return json(res, 401, {message: 'unauthorized'});
      const id = (url.searchParams.get('id') ?? '').replace(/^eq\./, '');
      // Row-level security in miniature: you can only change your own row.
      if (req.method === 'PATCH' && id === me && profiles.has(id)) {
        Object.assign(profiles.get(id)!, body);
      }
      const rows = profiles.has(id) && (req.method === 'GET' || id === me) ? [profiles.get(id)!] : [];
      if (wantsObject) return rows.length ? json(res, 200, rows[0]) : json(res, 406, {code: 'PGRST116', message: 'no rows'});
      return json(res, 200, rows);
    }
    if (route === 'POST /rest/v1/rpc/delete_my_account') {
      const me = bearerUser(req);
      if (!me) return json(res, 401, {message: 'unauthorized'});
      deleted.add(me);
      profiles.delete(me);
      return json(res, 204);
    }

    // ---- the `avatars` storage bucket: public to read, your own file to write ----
    if (url.pathname.startsWith('/storage/v1/object/')) {
      const rest = url.pathname.slice('/storage/v1/object/'.length);
      if (req.method === 'GET' && rest.startsWith('public/avatars/')) {
        const bytes = uploads.get(rest.slice('public/avatars/'.length));
        if (!bytes) return json(res, 404, {statusCode: '404', error: 'not_found', message: 'Object not found'});
        res.writeHead(200, {'content-type': 'image/jpeg'});
        return res.end(bytes);
      }
      // remove(): DELETE …/object/avatars with {prefixes: [names]}; only your own file goes.
      if (req.method === 'DELETE' && rest === 'avatars') {
        const me = bearerUser(req);
        if (!me) return json(res, 401, {statusCode: '401', error: 'Unauthorized', message: 'unauthorized'});
        const names = Array.isArray(body.prefixes) ? (body.prefixes as unknown[]).map(String) : [];
        const removed = names.filter(n => n === `${me}.jpg` && uploads.delete(n));
        return json(res, 200, removed.map(name => ({name, bucket_id: 'avatars'})));
      }
      if ((req.method === 'POST' || req.method === 'PUT') && rest.startsWith('avatars/')) {
        const me = bearerUser(req);
        if (!me) return json(res, 401, {statusCode: '401', error: 'Unauthorized', message: 'unauthorized'});
        const name = rest.slice('avatars/'.length);
        if (name !== `${me}.jpg`) return json(res, 403, {statusCode: '403', error: 'Unauthorized', message: 'new row violates row-level security policy'});
        if (req.headers['content-type'] !== 'image/jpeg') return json(res, 415, {statusCode: '415', error: 'invalid_mime_type', message: 'mime type not supported'});
        uploads.set(name, raw);
        return json(res, 200, {Key: `avatars/${name}`, Id: name});
      }
    }

    // ---- posts, likes, saves, comments (signed-in only, like the real rules) ----
    if (url.pathname.startsWith('/rest/v1/')) {
      const me = bearerUser(req);
      if (!me) return json(res, 401, {code: '42501', message: 'permission denied'});
      const table = url.pathname.slice('/rest/v1/'.length);
      const created = (row: unknown) => (wantsObject ? json(res, 201, row) : json(res, 201, [row]));

      if (table === 'feed_posts' && req.method === 'GET') {
        const author = eq(url, 'author_id');
        const onlyId = eq(url, 'id');
        const followedOnly = eq(url, 'author_followed') === 'true';
        const savedOnly = eq(url, 'viewer_saved') === 'true';
        const kind = eq(url, 'kind');
        const ids = inList(url, 'id');
        // "orq_keys=cs.{pugliese}" → posts whose keys contain it.
        const orq = url.searchParams.get('orq_keys')?.replace(/^cs\.\{"?|"?\}$/g, '') ?? null;
        const offset = Number(url.searchParams.get('offset') ?? 0);
        const limit = Number(url.searchParams.get('limit') ?? 100);
        // "order=popularity.desc,created_at.desc,id.desc" → compare column by column.
        const order = (url.searchParams.get('order') ?? 'created_at.desc').split(',').map(o => o.split('.'));
        const rows = posts
          .filter(p => !blocks.has(`${me}|${p.author_id}`))
          .filter(p => !author || p.author_id === author)
          .filter(p => !followedOnly || follows.has(`${me}|${p.author_id}`))
          .filter(p => !savedOnly || saves.has(`${p.id}|${me}`))
          .filter(p => !kind || p.kind === kind)
          .filter(p => !onlyId || p.id === onlyId)
          .filter(p => !ids || ids.includes(p.id))
          .filter(p => !orq || orqKeys(p).includes(orq))
          .map(p => {
            const row = feedRow(p, me);
            // The same score the real view computes.
            const ageDays = Math.max(0, (Date.now() - Date.parse(p.created_at)) / 86_400_000);
            return {...row, popularity: (row.like_count + 2 * row.comment_count + 1) / Math.pow(ageDays + 1, 1.2)};
          })
          .sort((x, y) => {
            for (const [col, dir] of order) {
              const xv = (x as Record<string, unknown>)[col] as string | number;
              const yv = (y as Record<string, unknown>)[col] as string | number;
              if (xv === yv) continue;
              return (xv < yv ? -1 : 1) * (dir === 'desc' ? -1 : 1);
            }
            return 0;
          })
          .slice(offset, offset + limit);
        return json(res, 200, rows);
      }
      if (table === 'profile_cards' && req.method === 'GET') {
        const id = eq(url, 'id');
        const pr = id ? profiles.get(id) : undefined;
        const rows = pr ? [profileCard(pr, me)] : [];
        if (wantsObject) return rows.length ? json(res, 200, rows[0]) : json(res, 200, null);
        return json(res, 200, rows);
      }
      if (table === 'follows' && req.method === 'GET') {
        const select = url.searchParams.get('select') ?? '';
        const person = (id: string) => {
          const pr = profiles.get(id);
          return pr ? {id: pr.id, handle: pr.handle, display_name: pr.display_name, city: pr.city, avatar_url: pr.avatar_url ?? null} : null;
        };
        const offset = Number(url.searchParams.get('offset') ?? 0);
        const limit = Number(url.searchParams.get('limit') ?? 100);
        const entries = [...follows].map(k => {
          const [follower, followee] = k.split('|');
          return {follower, followee, created_at: followedAt.get(k) ?? '2026-01-01T00:00:00.000Z'};
        }).sort((x, y) => y.created_at.localeCompare(x.created_at));
        // Followers of a DJ, embedded through the follower; whom they follow,
        // through the followee; or just the ids the signed-in DJ follows.
        if (/profiles!follower_id/.test(select)) {
          const followee = eq(url, 'followee_id');
          return json(res, 200, entries.filter(e => e.followee === followee).slice(offset, offset + limit)
            .map(e => ({created_at: e.created_at, profile: person(e.follower)})));
        }
        if (/profiles!followee_id/.test(select)) {
          const follower = eq(url, 'follower_id');
          return json(res, 200, entries.filter(e => e.follower === follower).slice(offset, offset + limit)
            .map(e => ({created_at: e.created_at, profile: person(e.followee)})));
        }
        return json(res, 200, entries.filter(e => e.follower === me).map(e => ({followee_id: e.followee})));
      }
      if (table === 'follows' && req.method === 'POST') {
        const key = `${me}|${body.followee_id}`;
        if (follows.has(key)) return json(res, 409, {code: '23505', message: 'duplicate key value violates unique constraint'});
        follows.add(key);
        followedAt.set(key, new Date().toISOString());
        return json(res, 201);
      }
      if (table === 'follows' && req.method === 'DELETE') {
        if (eq(url, 'follower_id') === me) follows.delete(`${me}|${eq(url, 'followee_id')}`);
        return json(res, 204);
      }
      if (table === 'my_notifications' && req.method === 'GET') {
        return json(res, 200, notificationsFor(me).slice(0, Number(url.searchParams.get('limit') ?? 100)));
      }
      if (table === 'notification_state' && req.method === 'GET') {
        return json(res, 200, seenAt.has(me) ? [{seen_at: seenAt.get(me)}] : []);
      }
      if (table === 'rpc/unread_notifications') {
        const since = seenAt.get(me) ?? '';
        return json(res, 200, notificationsFor(me).filter(n => String(n.created_at) > since).length);
      }
      if (table === 'rpc/mark_notifications_seen') {
        seenAt.set(me, new Date().toISOString());
        return json(res, 200, seenAt.get(me));
      }
      // Orchestras that appear in shared tandas, with how many tandas each is in.
      if (table === 'feed_orchestras' && req.method === 'GET') {
        const byKey = new Map<string, {key: string; name: string; tandas: number}>();
        for (const p of posts.filter(x => !blocks.has(`${me}|${x.author_id}`))) {
          const seen = new Set<string>();
          for (const song of tandaSongs(p)) {
            const key = songKey(song);
            if (!key || seen.has(key)) continue;
            seen.add(key);
            const row = byKey.get(key) ?? {key, name: (song.orq ?? '').trim(), tandas: 0};
            row.tandas += 1;
            byKey.set(key, row);
          }
        }
        return json(res, 200, [...byKey.values()].sort((x, y) => y.tandas - x.tandas || x.name.localeCompare(y.name)));
      }
      if (table === 'posts' && req.method === 'POST') {
        const post: StubPost = {
          id: newId(),
          author_id: me,
          kind: body.kind === 'question' ? 'question' : 'tanda',
          note: String(body.note ?? ''),
          tanda: body.tanda ?? null,
          created_at: new Date().toISOString(),
        };
        posts.push(post);
        return created({id: post.id});
      }
      if (table === 'posts' && req.method === 'DELETE') {
        const id = eq(url, 'id');
        const i = posts.findIndex(p => p.id === id && p.author_id === me);
        const gone = i >= 0 ? posts.splice(i, 1) : [];
        // With `select`, like PostgREST, answer with the rows actually deleted.
        if (url.searchParams.get('select')) return json(res, 200, gone.map(p => ({id: p.id})));
        return json(res, 204);
      }
      if ((table === 'post_likes' || table === 'saves') && req.method !== 'GET') {
        const set = table === 'post_likes' ? likes : saves;
        if (req.method === 'POST') {
          const key = `${body.post_id}|${me}`;
          if (set.has(key)) return json(res, 409, {code: '23505', message: 'duplicate key value'});
          set.add(key);
          if (table === 'post_likes') likedAt.set(key, new Date().toISOString());
          return json(res, 201);
        }
        if (req.method === 'DELETE') {
          set.delete(`${eq(url, 'post_id')}|${me}`);
          return json(res, 204);
        }
      }
      if (table === 'saves' && req.method === 'GET') {
        const mine = [...saves].filter(k => k.endsWith('|' + me)).map(k => ({post_id: k.split('|')[0]}));
        return json(res, 200, mine);
      }
      // Like the real backend, refuse an author embed that doesn't say which
      // relationship it means (comments also reach profiles via comment_likes).
      if ((table === 'comments' || table === 'posts') && /profiles\(/.test(url.searchParams.get('select') ?? '')) {
        return json(res, 300, {code: 'PGRST201', message: 'Could not embed because more than one relationship was found'});
      }
      // Plain id lookups: does a post exist, which of these did I write.
      if (table === 'posts' && req.method === 'GET' && url.searchParams.get('select') === 'id') {
        const one = eq(url, 'id');
        const ids = inList(url, 'id');
        const author = eq(url, 'author_id');
        return json(res, 200, posts
          .filter(p => (!one || p.id === one) && (!ids || ids.includes(p.id)) && (!author || p.author_id === author))
          .map(p => ({id: p.id})));
      }
      // The feed's comment preview: each post with its newest few comments.
      if (table === 'posts' && req.method === 'GET') {
        const ids = inList(url, 'id') ?? [];
        const perPost = Number(url.searchParams.get('comments.limit') ?? 100);
        return json(res, 200, ids.filter(id => posts.some(p => p.id === id)).map(id => ({
          id,
          comments: comments
            .filter(c => c.post_id === id && !blocks.has(`${me}|${c.author_id}`))
            .sort((x, y) => y.created_at.localeCompare(x.created_at) || y.id.localeCompare(x.id))
            .slice(0, perPost)
            .map(commentRow),
        })));
      }
      // One page of a post's comments, newest first.
      if (table === 'comments' && req.method === 'GET') {
        const postId = eq(url, 'post_id');
        // The cursor, as the app sends it:
        //   or=(created_at.lt."T",and(created_at.eq."T",id.lt.ID))
        const cursor = /^\(created_at\.lt\."([^"]+)",and\(created_at\.eq\."[^"]+",id\.lt\.([\w-]+)\)\)$/.exec(url.searchParams.get('or') ?? '');
        const limit = Number(url.searchParams.get('limit') ?? 100);
        // Timestamps compared as instants (the cursor may be written with +00:00).
        const ms = (t: string) => Date.parse(t);
        const rows = comments
          .filter(c => c.post_id === postId && !blocks.has(`${me}|${c.author_id}`))
          .filter(c => !cursor || ms(c.created_at) < ms(cursor[1]) || (ms(c.created_at) === ms(cursor[1]) && c.id < cursor[2]))
          .sort((x, y) => y.created_at.localeCompare(x.created_at) || y.id.localeCompare(x.id))
          .slice(0, limit)
          .map(commentRow);
        return json(res, 200, rows);
      }
      if (table === 'comments' && req.method === 'POST') {
        const comment: StubComment = {
          id: newId(),
          post_id: String(body.post_id),
          parent_id: (body.parent_id as string | null) ?? null,
          author_id: me,
          body: String(body.body ?? ''),
          created_at: new Date().toISOString(),
        };
        comments.push(comment);
        return created(commentRow(comment));
      }
      if (table === 'comments' && req.method === 'DELETE') {
        const id = eq(url, 'id');
        // Your own comment only — and then its replies too, as the real cascade does.
        if (comments.some(c => c.id === id && c.author_id === me)) {
          for (let i = comments.length - 1; i >= 0; i--) {
            if (comments[i].id === id || comments[i].parent_id === id) comments.splice(i, 1);
          }
        }
        return json(res, 204);
      }
      if (table === 'reports' && req.method === 'POST') {
        reports.push({...body, reporter_id: me});
        return json(res, 201);
      }
      if (table === 'blocks' && req.method === 'POST') {
        blocks.add(`${me}|${body.blocked_id}`);
        return json(res, 201);
      }
    }

    json(res, 404, {message: `stub has no route for ${route}`});
  });

  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const {port} = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    profiles,
    deleted,
    issuedTokens,
    posts,
    comments,
    likes,
    saves,
    blocks,
    follows,
    followedAt,
    reports,
    uploads,
    close: () =>
      new Promise<void>(resolve => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
