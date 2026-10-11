import {test, expect, type ElectronApplication, type Page} from '@playwright/test';
import {mkdtempSync, readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {launchApp, stubFolderDialog, gotoView} from './helpers/app.js';
import {makeMusicFixture} from './helpers/wav.js';
import {
  startCommunityStub,
  STUB_ACCOUNT,
  STUB_ANON_KEY,
  STUB_LUCIA,
  STUB_LUCIA_POST,
  STUB_MARTA,
  STUB_MARTA_POST,
  STUB_NEW_ACCOUNT,
  type CommunityStub,
} from './helpers/community-stub.js';

// Sharing and the feed, end to end against the local stub backend: a real
// imported library, a real tanda, the real matching in the main process.
//
// The fixture library has "Bahia Blanca", "Nido Gaucho" and "Verdemar" (among
// others). The stub's seeded tanda from another DJ lists Nido Gaucho, Verdemar
// and "Tristeza Marina" — so two of its three songs are owned here.

const ME = '11111111-1111-4111-8111-111111111111';
const TANDA_NAME = 'Di Sarli instrumental';
const TANDA_TITLES = ['Bahia Blanca', 'Nido Gaucho', 'Verdemar'];

let stub: CommunityStub;
let app: ElectronApplication;
let page: Page;
let musicRoot: string;

const post = (id: string) => page.locator(`.cm-post[data-post-id="${id}"]`);
const myPost = () => stub.posts.find(p => p.author_id === ME && p.kind === 'tanda');

test.describe.configure({mode: 'serial'});

test.beforeAll(async () => {
  stub = await startCommunityStub({seedFeed: true});
  const launched = await launchApp(undefined, {
    env: {COMPAS_COMMUNITY_URL: stub.url, COMPAS_COMMUNITY_KEY: STUB_ANON_KEY},
    args: ['--use-mock-keychain'],
  });
  app = launched.app;
  page = launched.page;

  // Import the fixture library through the real UI.
  musicRoot = mkdtempSync(join(tmpdir(), 'compas-music-'));
  const counts = makeMusicFixture(musicRoot);
  await stubFolderDialog(app, musicRoot);
  await gotoView(page, 'Tandas');
  await page.getByRole('button', {name: /Choose a folder/i}).click();
  await expect(page.getByText(/Import — set folder genres/i)).toBeVisible();
  await page.getByRole('button', {name: 'Import', exact: true}).click();
  await expect
    .poll(async () => page.evaluate(async () => (await (window as any).compas.getLibrary()).songs.length), {timeout: 15_000})
    .toBe(counts.total);

  // Sign in.
  await gotoView(page, 'Community');
  await page.getByLabel('Email').fill(STUB_ACCOUNT.email);
  await page.getByLabel('Password').fill(STUB_ACCOUNT.password);
  await page.getByRole('button', {name: 'Sign in', exact: true}).click();
  await expect(page.locator('.cm-me-name')).toHaveText('Test DJ');
});

test.afterAll(async () => {
  await app?.close();
  await stub?.close();
});

test('a tanda whose songs have no orchestra is shared without one', async () => {
  // The fixture files are untagged, so the songs have no orchestra. They are
  // posted as they are; readers' libraries are simply never matched on them.
  const preview = await page.evaluate(async ({name, titles}) => {
    const c = (window as any).compas;
    const lib = await c.getLibrary();
    const ids = titles.map((t: string) => lib.songs.find((s: any) => s.title === t).id);
    const tanda = await c.saveTanda({name, songIds: ids, tags: [{cat: 'type', label: 'Tango'}]});
    return c.community.sharePreview(tanda.id, true);
  }, {name: TANDA_NAME, titles: TANDA_TITLES});
  expect(preview.ok).toBe(true);
  expect(preview.tanda.songs.map((s: any) => s.orq)).toEqual([null, null, null]);
  expect(preview.tanda.songs.every((s: any) => !('orq_key' in s))).toBe(true);

  // Give the songs their orchestra (Compás-only, like Smart Organize does).
  await page.evaluate(async () => {
    const c = (window as any).compas;
    const lib = await c.getLibrary();
    await c.applySmartOrganize(lib.songs.map((s: any) => ({id: s.id, orq: s.folder.includes('Biagi') ? 'Rodolfo Biagi' : 'Carlos Di Sarli'})));
  });
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
});

test('the feed shows other DJs’ posts matched against this library', async () => {
  await gotoView(page, 'Community');
  const marta = post(STUB_MARTA_POST);
  await expect(marta).toContainText('Marta Kowalczyk');
  // The headline names the tanda: "Marta Kowalczyk shared Di Sarli, late night".
  await expect(marta.locator('.cm-post-author')).toHaveText(/Marta Kowalczyk\s+shared\s+Di Sarli, late night/);
  await expect(marta).toContainText('For the last hour, when the lights are low.');
  await expect(marta.locator('.cm-match')).toHaveText('2 of 3 in your library');
  await expect(marta.locator('.cm-post-song', {hasText: 'Nido Gaucho'}).getByRole('img', {name: 'In your library'})).toBeVisible();
  await expect(marta.locator('.cm-post-song', {hasText: 'Tristeza Marina'})).toContainText('Missing');
  await expect(marta.getByRole('button', {name: 'Play tanda'})).toHaveCount(0);

  const lucia = post(STUB_LUCIA_POST);
  await expect(lucia.locator('.cm-post-author')).toContainText('posted');
  await expect(lucia).toContainText('What do you play right after a Pugliese tanda?');
  await expect(lucia).toContainText('A light vals. Nothing heavy.');

  // The feed ends on an invitation to share.
  await expect(page.getByText('That’s it for now.')).toBeVisible();

  // The two controls start on "Everything", sorted by "Popular".
  await expect(page.getByLabel('Show')).toHaveValue('all');
  await expect(page.getByLabel('Sort by')).toHaveValue('popular');
});

test('sharing a tanda posts song details only', async () => {
  await gotoView(page, 'Tandas');
  await page.getByRole('tab', {name: /My tandas/}).click();
  await page.getByRole('button', {name: 'Share', exact: true}).click();

  const dialog = page.getByRole('dialog', {name: 'Share to Community'});
  await expect(dialog).toContainText('Posting as Test DJ');
  for (const title of TANDA_TITLES) await expect(dialog.locator('.cm-post-song', {hasText: title})).toBeVisible();
  await expect(dialog).toContainText('Only song details are shared');
  await dialog.getByLabel(/Add a note/).fill('Warm opener for the first hour.');
  await dialog.getByRole('button', {name: 'Share tanda'}).click();

  await expect(dialog).toHaveCount(0);
  // The card's share control now reads "Shared".
  await expect(page.getByRole('button', {name: 'Shared', exact: true})).toBeVisible();
  await expect(page.getByRole('button', {name: 'Share', exact: true})).toHaveCount(0);

  const shared = myPost();
  expect(shared).toBeTruthy();
  expect(shared!.note).toBe('Warm opener for the first hour.');
  expect(shared!.tanda).toMatchObject({
    name: TANDA_NAME,
    tags: [{cat: 'type', label: 'Tango'}],
    // Each song carries the orchestra's key, for filtering the feed by orchestra.
    songs: TANDA_TITLES.map(title => ({title, orq: 'Carlos Di Sarli', orq_key: 'sarli'})),
  });
  // Nothing about the files or the library went out.
  const sent = JSON.stringify(shared);
  expect(sent).not.toContain(musicRoot);
  expect(sent).not.toMatch(/\.wav|\.flac|\.aiff/i);
  expect(sent).not.toContain('Di Sarli - Tango');
});

test('my shared tanda is ready to play from the feed', async () => {
  await gotoView(page, 'Community');
  const mine = post(myPost()!.id);
  await expect(mine).toContainText('Test DJ');
  // Ready: the title row offers Play instead of a "missing songs" count, and
  // there is nothing to add — it is already the DJ's own tanda.
  await expect(mine.getByRole('button', {name: 'Play tanda'})).toBeVisible();
  await expect(mine.locator('.cm-match')).toHaveCount(0);
  await expect(mine.getByRole('button', {name: 'Add to my tandas'})).toHaveCount(0);

  // "Show" filters the feed; the two tanda choices depend on this library.
  const show = page.getByLabel('Show');
  await show.selectOption({label: 'Tandas I can play'});
  await expect(page.locator('.cm-post')).toHaveCount(1);
  await expect(mine).toBeVisible();
  await show.selectOption({label: 'Tandas I can’t play yet'});
  await expect(page.locator('.cm-post')).toHaveCount(1);
  await expect(post(STUB_MARTA_POST)).toBeVisible();
  await show.selectOption({label: 'Discussions'});
  await expect(page.locator('.cm-post')).toHaveCount(1);
  await expect(post(STUB_LUCIA_POST)).toBeVisible();
  await show.selectOption({label: 'Everything'});
  await expect(page.locator('.cm-post')).toHaveCount(3);

  // "Sort by": newest puts the post just shared first; most liked follows the
  // likes; popular weighs both, so the fresh post beats two old quiet ones.
  const sortBy = page.getByLabel('Sort by');
  const firstPost = page.locator('.cm-post').first();
  await sortBy.selectOption({label: 'Newest'});
  await expect(firstPost).toHaveAttribute('data-post-id', myPost()!.id);
  stub.likes.add(`${STUB_LUCIA_POST}|${STUB_MARTA}`);
  await sortBy.selectOption({label: 'Most liked'});
  await expect(firstPost).toHaveAttribute('data-post-id', STUB_LUCIA_POST);
  await sortBy.selectOption({label: 'Popular'});
  await expect(firstPost).toHaveAttribute('data-post-id', myPost()!.id);
  stub.likes.delete(`${STUB_LUCIA_POST}|${STUB_MARTA}`);
  await page.getByRole('button', {name: 'Refresh'}).click();
  await expect(page.locator('.cm-post')).toHaveCount(3);

  // Play starts the tanda in place: its first song shows as playing.
  await mine.getByRole('button', {name: 'Play tanda'}).click();
  await expect(mine.locator('.cm-post-song.playing')).toHaveCount(1, {timeout: 15_000});
  await expect(mine.locator('.cm-post-song.playing')).toContainText(/Bahia Blanca|Nido Gaucho|Verdemar/);
});

test('posts that arrive while reading are offered, not forced', async () => {
  await expect(page.getByRole('button', {name: 'New posts'})).toHaveCount(0);
  stub.posts.push({
    id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    author_id: STUB_MARTA,
    kind: 'question',
    note: 'Anyone playing Fresedo tonight?',
    tanda: null,
    created_at: new Date().toISOString(),
  });
  // Coming back to the window checks for something newer than what is loaded.
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  const pill = page.getByRole('button', {name: 'New posts'});
  await expect(pill).toBeVisible();
  await expect(page.locator('.cm-post')).toHaveCount(3);

  await pill.click();
  await expect(page.locator('.cm-post')).toHaveCount(4);
  await expect(page.locator('.cm-post').first()).toContainText('Anyone playing Fresedo tonight?');
  await expect(pill).toHaveCount(0);

  // Leave the feed as the next tests expect it.
  stub.posts.splice(stub.posts.findIndex(p => p.id === 'ffffffff-ffff-4fff-8fff-ffffffffffff'), 1);
  await page.getByRole('button', {name: 'Refresh'}).click();
  await expect(page.locator('.cm-post')).toHaveCount(3);
});

test('the feed can be narrowed to one orchestra', async () => {
  // A second orchestra turns up: a Biagi tanda from another DJ.
  stub.posts.push({
    id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    author_id: STUB_MARTA,
    kind: 'tanda',
    note: 'Two valses.',
    tanda: {name: 'Biagi valses', tags: [], songs: [
      {title: 'Lagrimas y Sonrisas', orq: 'Rodolfo Biagi', singer: null, year: 1941, genre: 'vals'},
      {title: 'Viejo Porton', orq: 'Rodolfo Biagi', singer: null, year: 1938, genre: 'vals'},
    ]},
    created_at: '2026-01-03T10:00:00.000Z',
  });
  await page.getByRole('button', {name: 'Refresh'}).click();
  await expect(page.locator('.cm-post')).toHaveCount(4);

  // The list offers every shared orchestra, most shared first.
  // (Other tabs have their own "Orchestra" pickers; this is the feed's.)
  const orchestra = page.locator('.cm-filters').getByLabel('Orchestra');
  await expect(orchestra.locator('option')).toHaveText(['All orchestras', 'Carlos Di Sarli', 'Rodolfo Biagi']);

  await orchestra.selectOption({label: 'Rodolfo Biagi'});
  await expect(page.locator('.cm-post')).toHaveCount(1);
  await expect(page.locator('.cm-post')).toContainText('Biagi valses');

  // Clicking an orchestra's name on a post does the same.
  await orchestra.selectOption({label: 'All orchestras'});
  await expect(page.locator('.cm-post')).toHaveCount(4);
  await post(STUB_MARTA_POST).getByRole('button', {name: 'Carlos Di Sarli'}).click();
  await expect(orchestra).toHaveValue('sarli');
  await expect(page.locator('.cm-post')).toHaveCount(2);
  await expect(post(STUB_LUCIA_POST)).toHaveCount(0);

  // It combines with "Show": of Di Sarli's tandas, only the one fully owned.
  await page.getByLabel('Show').selectOption({label: 'Tandas I can play'});
  await expect(page.locator('.cm-post')).toHaveCount(1);
  await expect(post(myPost()!.id)).toBeVisible();

  // Leave the feed as the next tests expect it.
  await page.getByLabel('Show').selectOption({label: 'Everything'});
  await orchestra.selectOption({label: 'All orchestras'});
  stub.posts.splice(stub.posts.findIndex(p => p.id === 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'), 1);
  await page.getByRole('button', {name: 'Refresh'}).click();
  await expect(page.locator('.cm-post')).toHaveCount(3);
});

test('likes, comments and replies reach the backend', async () => {
  const marta = post(STUB_MARTA_POST);
  // Totals ride on the buttons, and only once there is something to count.
  const comment = (p: ReturnType<typeof post>) => p.getByRole('button', {name: /^Comment/});
  await expect(marta.locator('.cm-act-n')).toHaveCount(0);
  await marta.getByRole('button', {name: 'Like', exact: true}).click();
  await expect(marta.getByRole('button', {name: 'Liked'})).toHaveAttribute('aria-pressed', 'true');
  await expect(marta.getByRole('button', {name: 'Liked'})).toHaveText(/Liked\s*1/);
  await expect.poll(() => stub.likes.has(`${STUB_MARTA_POST}|${ME}`)).toBe(true);

  await marta.getByRole('button', {name: 'Liked'}).click();
  await expect(marta.getByRole('button', {name: 'Like', exact: true})).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => stub.likes.size).toBe(0);

  // A post nobody has commented on keeps its comment box tucked away.
  await expect(marta.getByLabel('Write a comment')).toHaveCount(0);
  await comment(marta).click();
  await expect(marta.getByLabel('Write a comment')).toBeFocused();
  await marta.getByLabel('Write a comment').fill('Nido gaucho as the opener is brave.');
  await marta.getByRole('button', {name: 'Post comment'}).click();
  await expect(marta.locator('.cm-bubble', {hasText: 'Nido gaucho as the opener is brave.'})).toContainText('Test DJ');
  await expect(comment(marta)).toHaveText(/Comment\s*1/);

  // Reply to Marta's comment on the question post.
  const lucia = post(STUB_LUCIA_POST);
  await lucia.locator('.cm-comment', {hasText: 'A light vals'}).getByRole('button', {name: 'Reply'}).click();
  await expect(lucia).toContainText('Replying to Marta Kowalczyk');
  await lucia.getByLabel('Write a comment').fill('Biagi works well for that.');
  await lucia.getByRole('button', {name: 'Post comment'}).click();
  await expect(lucia.locator('.cm-comment.is-reply')).toContainText('Biagi works well for that.');

  const reply = stub.comments.find(c => c.body === 'Biagi works well for that.');
  const parent = stub.comments.find(c => c.body === 'A light vals. Nothing heavy.');
  expect(reply?.parent_id).toBe(parent?.id);
  expect(reply?.author_id).toBe(ME);

  // My own comment can be deleted; Marta's cannot.
  await expect(lucia.locator('.cm-comment', {hasText: 'A light vals'}).first().getByRole('button', {name: 'Delete'})).toHaveCount(0);
  // Deleting asks first; cancelling keeps the comment.
  await lucia.locator('.cm-comment.is-reply').getByRole('button', {name: 'Delete'}).click();
  await page.getByRole('alertdialog').getByRole('button', {name: 'Cancel'}).click();
  await expect(lucia.locator('.cm-comment.is-reply')).toHaveCount(1);
  await lucia.locator('.cm-comment.is-reply').getByRole('button', {name: 'Delete'}).click();
  await page.getByRole('alertdialog').getByRole('button', {name: 'Delete comment'}).click();
  await expect(lucia.locator('.cm-comment.is-reply')).toHaveCount(0);
  await expect.poll(() => stub.comments.some(c => c.body === 'Biagi works well for that.')).toBe(false);
});

test('a long conversation loads a page at a time and scrolls inside the post', async () => {
  // 30 more comments on the question, from the other DJ. Ten of them (3–12)
  // were made in the same instant, and the first page ends among them: none
  // may be skipped on the way to the next page.
  const base = Date.parse('2026-01-01T12:00:00Z');
  for (let i = 1; i <= 30; i++) {
    stub.comments.push({
      id: `dddddddd-dddd-4ddd-8ddd-${String(i).padStart(12, '0')}`,
      post_id: STUB_LUCIA_POST,
      parent_id: null,
      author_id: STUB_MARTA,
      body: `Bulk comment ${i}.`,
      created_at: new Date(base + (i >= 3 && i <= 12 ? 12 : i) * 60_000).toISOString(),
    });
  }
  await page.getByRole('button', {name: 'Refresh'}).click();
  const lucia = post(STUB_LUCIA_POST);
  await expect(lucia.getByRole('button', {name: /^Comment/})).toHaveText(/Comment\s*31/);

  // Only the newest three arrive with the feed.
  await expect(lucia.locator('.cm-comment')).toHaveCount(3);
  await expect(lucia.locator('.cm-comment').last()).toContainText('Bulk comment 30.');

  // Earlier ones come 20 at a time, into a list that scrolls instead of growing.
  await lucia.getByRole('button', {name: 'View 28 earlier comments'}).click();
  await expect(lucia.locator('.cm-comment')).toHaveCount(23);
  const list = await lucia.locator('.cm-comments').evaluate(el => ({shown: el.clientHeight, all: el.scrollHeight}));
  expect(list.shown).toBeLessThanOrEqual(380);
  expect(list.all).toBeGreaterThan(list.shown);

  await lucia.getByRole('button', {name: 'View 8 earlier comments'}).click();
  await expect(lucia.locator('.cm-comment')).toHaveCount(31);
  await expect(lucia.locator('.cm-comment').first()).toContainText('A light vals');
  for (let i = 1; i <= 30; i++) await expect(lucia.getByText(`Bulk comment ${i}.`, {exact: true})).toHaveCount(1);
  await expect(lucia.getByRole('button', {name: /earlier comment/})).toHaveCount(0);

  // Back to the single seeded comment for the tests that follow.
  const keep = stub.comments.filter(c => !c.body.startsWith('Bulk comment'));
  stub.comments.splice(0, stub.comments.length, ...keep);
  await page.getByRole('button', {name: 'Refresh'}).click();
  await expect(lucia.getByRole('button', {name: /^Comment/})).toHaveText(/Comment\s*1$/);
  await expect(lucia.locator('.cm-comment')).toHaveCount(1);
});

test('deleting a comment shows the count the backend has afterwards', async () => {
  const lucia = post(STUB_LUCIA_POST);
  await lucia.getByLabel('Write a comment').fill('I go for a milonga.');
  await lucia.getByRole('button', {name: 'Post comment'}).click();
  await expect(lucia.getByRole('button', {name: /^Comment/})).toHaveText(/Comment\s*2$/);
  const mine = stub.comments.find(c => c.body === 'I go for a milonga.')!;

  // Meanwhile, unseen here: Marta answers it twice, and Lucía adds a comment.
  const later = (n: number) => new Date(Date.now() + n * 1000).toISOString();
  stub.comments.push(
    {id: 'eeeeeeee-eeee-4eee-8eee-000000000001', post_id: STUB_LUCIA_POST, parent_id: mine.id, author_id: STUB_MARTA, body: 'Brave.', created_at: later(1)},
    {id: 'eeeeeeee-eeee-4eee-8eee-000000000002', post_id: STUB_LUCIA_POST, parent_id: mine.id, author_id: STUB_MARTA, body: 'Which one?', created_at: later(2)},
    {id: 'eeeeeeee-eeee-4eee-8eee-000000000003', post_id: STUB_LUCIA_POST, parent_id: null, author_id: STUB_LUCIA, body: 'Thanks all!', created_at: later(3)},
  );

  // Deleting mine takes Marta's replies with it; the count is the backend's
  // (the seeded comment and Lucía's), not a guess from what was loaded.
  await lucia.locator('.cm-comment', {hasText: 'I go for a milonga.'}).getByRole('button', {name: 'Delete'}).click();
  await page.getByRole('alertdialog').getByRole('button', {name: 'Delete comment'}).click();
  await expect(lucia.getByRole('button', {name: /^Comment/})).toHaveText(/Comment\s*2$/);
  expect(stub.comments.filter(c => c.post_id === STUB_LUCIA_POST).map(c => c.body)).toEqual(['A light vals. Nothing heavy.', 'Thanks all!']);

  // Back to the single seeded comment for the tests that follow.
  stub.comments.splice(stub.comments.findIndex(c => c.body === 'Thanks all!'), 1);
  await page.getByRole('button', {name: 'Refresh'}).click();
  await expect(lucia.locator('.cm-comment')).toHaveCount(1);
});

test('a post is written in the composer', async () => {
  // One text field, with "Add a tanda" and "Post" under it. "Post" is always
  // there, and works as soon as there is something to post.
  const field = page.getByLabel('Write a post');
  const postButton = page.getByRole('button', {name: 'Post', exact: true});
  await expect(page.locator('.cm-composer textarea')).toHaveCount(1);
  await expect(page.locator('.cm-composer').getByRole('button')).toHaveText(['Add a tanda', 'Post']);
  await expect(postButton).toBeDisabled();
  await field.fill('Which transfer');
  await expect(postButton).toBeEnabled();
  await field.fill('');
  await expect(postButton).toBeDisabled();

  await field.fill('Which transfer of Verdemar do you use?');
  await postButton.click();

  const first = page.locator('.cm-post').first();
  await expect(first.locator('.cm-post-author')).toHaveText(/Test DJ\s+posted/);
  await expect(first).toContainText('Which transfer of Verdemar do you use?');
  expect(stub.posts.some(p => p.kind === 'question' && p.author_id === ME)).toBe(true);
  await expect(field).toHaveValue('');
  await expect(postButton).toBeDisabled();
});

test('likes and comments on my posts arrive as notifications', async () => {
  const bell = page.locator('.tp-bell');
  // A DJ who has never looked has one notification waiting: the welcome.
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(bell).toHaveAccessibleName('Notifications, 1 new');
  // The count rides on the Community tab as well.
  await expect(page.getByRole('tab', {name: /Community/}).locator('.tp-nav-n')).toHaveText('1');

  // Another DJ likes my tanda and comments on it.
  const mine = myPost()!;
  stub.likes.add(`${mine.id}|${STUB_MARTA}`);
  stub.comments.push({
    id: 'abababab-abab-4bab-8bab-abababababab',
    post_id: mine.id,
    parent_id: null,
    author_id: STUB_MARTA,
    body: 'Great opener, borrowing it.',
    created_at: new Date().toISOString(),
  });
  // Coming back to the window refreshes the bell.
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(bell).toHaveAccessibleName('Notifications, 3 new');

  // The bell opens the list, which says who did what.
  await bell.click();
  const nav = page.getByRole('navigation', {name: 'Community'});
  await expect(nav.getByRole('button', {name: /Notifications/})).toHaveAttribute('aria-current', 'page');
  const rows = page.locator('.cm-notif');
  await expect(rows).toHaveCount(3);
  await expect(rows.last()).toContainText('Welcome to the Community.');
  await expect(rows.filter({hasText: 'liked your tanda'})).toContainText(`Marta Kowalczyk liked your tanda ${TANDA_NAME}`);
  await expect(rows.filter({hasText: 'commented on your tanda'})).toContainText('Great opener, borrowing it.');
  await expect(page.locator('.cm-notif-dot')).toHaveCount(3);
  // Having looked, the bell is quiet again, and so is the tab.
  await expect(bell).toHaveAccessibleName('Notifications');
  await expect(page.locator('.tp-nav-n')).toHaveCount(0);

  // A notification opens its post, with a way back.
  await rows.filter({hasText: 'commented on your tanda'}).click();
  await expect(page.locator('.cm-post')).toHaveCount(1);
  await expect(post(mine.id)).toContainText('Great opener, borrowing it.');
  await page.getByRole('button', {name: 'Back to notifications'}).click();
  await expect(page.locator('.cm-notif')).toHaveCount(3);
  // Nothing is new on a second visit.
  await expect(page.locator('.cm-notif-dot')).toHaveCount(0);

  // The welcome leads to the feed.
  await page.locator('.cm-notif', {hasText: 'Welcome to the Community.'}).click();
  await expect(page.getByRole('navigation', {name: 'Community'}).getByRole('button', {name: 'Feed'})).toHaveAttribute('aria-current', 'page');

  // Leave the feed as the next tests expect it.
  stub.likes.delete(`${mine.id}|${STUB_MARTA}`);
  stub.comments.splice(stub.comments.findIndex(c => c.id === 'abababab-abab-4bab-8bab-abababababab'), 1);
  await nav.getByRole('button', {name: 'Feed'}).click();
  await expect(page.locator('.cm-post')).toHaveCount(4);
});

test('saved posts and my posts have their own lists', async () => {
  await post(STUB_MARTA_POST).getByRole('button', {name: 'Save', exact: true}).click();
  await expect(post(STUB_MARTA_POST).getByRole('button', {name: 'Saved'})).toHaveAttribute('aria-pressed', 'true');

  // Posting belongs to the feed: the other two lists have no composer.
  const composer = page.locator('.cm-composer');
  const nav = page.getByRole('navigation', {name: 'Community'});
  await nav.getByRole('button', {name: 'Saved'}).click();
  await expect(page.locator('.cm-post')).toHaveCount(1);
  await expect(post(STUB_MARTA_POST)).toBeVisible();
  await expect(composer).toHaveCount(0);
  await expect(page.getByLabel('Show')).toBeVisible();

  await nav.getByRole('button', {name: 'My posts'}).click();
  await expect(page.locator('.cm-post')).toHaveCount(2);
  await expect(post(STUB_MARTA_POST)).toHaveCount(0);
  await expect(composer).toHaveCount(0);
  // …and no "Show" filter either (your own tandas are always yours) — only the order.
  await expect(page.getByLabel('Show')).toHaveCount(0);
  await expect(page.getByLabel('Sort by')).toBeVisible();
  await expect(page.getByRole('heading', {name: 'My posts'})).toBeVisible();

  // The Community tab in the top bar always goes back to the general feed.
  await page.getByRole('tab', {name: 'Community'}).click();
  await expect(nav.getByRole('button', {name: 'Feed'})).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.cm-post')).toHaveCount(4);
  await expect(composer).toBeVisible();
});

test('a DJ has a page, and can be followed', async () => {
  // A name on a post opens the DJ's page: who they are, and their posts.
  const marta = post(STUB_MARTA_POST);
  await marta.locator('.cm-post-head').getByRole('button', {name: 'Marta Kowalczyk'}).click();
  const card = page.locator('.cm-profile');
  await expect(card.getByRole('heading', {name: 'Marta Kowalczyk'})).toBeVisible();
  await expect(card).toContainText('@marta · Kraków');
  await expect(card.getByRole('tab', {name: '1 post'})).toHaveAttribute('aria-selected', 'true');
  await expect(card.getByRole('tab', {name: '0 followers'})).toBeVisible();
  await expect(page.locator('.cm-post')).toHaveCount(1);
  await expect(marta).toBeVisible();
  await expect(page.locator('.cm-composer')).toHaveCount(0);

  // Follow: the button and the count say so, and the backend has it.
  const follow = card.getByRole('button', {name: 'Follow', exact: true});
  await follow.click();
  await expect(card.getByRole('button', {name: 'Following'})).toHaveAttribute('aria-pressed', 'true');
  await expect(card.getByRole('tab', {name: '1 follower'})).toBeVisible();
  expect(stub.follows.has(`${ME}|${STUB_MARTA}`)).toBe(true);
  await card.getByRole('tab', {name: '1 follower'}).click();
  await expect(page.locator('.cm-person')).toHaveCount(1);
  await expect(page.locator('.cm-person')).toContainText('Test DJ');
  await expect(page.locator('.cm-post')).toHaveCount(0);

  // "Following" in the rail lists only what the DJs I follow posted.
  const nav = page.getByRole('navigation', {name: 'Community'});
  await nav.getByRole('button', {name: 'Following'}).click();
  await expect(page.locator('.cm-post')).toHaveCount(1);
  await expect(marta).toBeVisible();

  // Being followed back is a notification, and shows on their page.
  stub.follows.add(`${STUB_MARTA}|${ME}`);
  stub.followedAt.set(`${STUB_MARTA}|${ME}`, new Date().toISOString());
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  const bell = page.locator('.tp-bell');
  await expect(bell).toHaveAccessibleName('Notifications, 1 new');
  await bell.click();
  const row = page.locator('.cm-notif', {hasText: 'started following you'});
  await expect(row).toContainText('Marta Kowalczyk started following you');
  await row.click();
  await expect(card.getByRole('heading', {name: 'Marta Kowalczyk'})).toBeVisible();
  await expect(card).toContainText('Follows you');

  // Unfollow, and back to the feed as the next tests expect it.
  await card.getByRole('button', {name: 'Following'}).click();
  await expect(card.getByRole('button', {name: 'Follow', exact: true})).toBeVisible();
  expect(stub.follows.has(`${ME}|${STUB_MARTA}`)).toBe(false);
  stub.follows.delete(`${STUB_MARTA}|${ME}`);
  await page.getByRole('button', {name: 'Back', exact: true}).click();
  await expect(card).toHaveCount(0);
  await nav.getByRole('button', {name: 'Feed'}).click();
  await expect(marta).toBeVisible();
});

test('a post can be edited by its author', async () => {
  // Write something, then change it from the post's menu.
  await gotoView(page, 'Community');
  await page.getByLabel('Write a post').fill('Which transfer of Bahia Blanca?');
  await page.getByRole('button', {name: 'Post', exact: true}).click();
  await expect(page.locator('.cm-post', {hasText: 'Which transfer of Bahia Blanca?'})).toHaveCount(1);
  // By id from here on: while it is being edited, its words are in the edit box.
  const mine = post((await page.locator('.cm-post', {hasText: 'Which transfer of Bahia Blanca?'}).getAttribute('data-post-id'))!);
  await expect(mine.locator('.cm-post-edited')).toHaveCount(0);

  await mine.getByRole('button', {name: 'Post options'}).click();
  await mine.getByRole('menuitem', {name: 'Edit post'}).click();
  const box = mine.getByLabel('Edit your post');
  await expect(box).toHaveValue('Which transfer of Bahia Blanca?');
  // Unchanged, or emptied (a post without a tanda is only its words): no saving.
  const save = mine.getByRole('button', {name: 'Save changes'});
  await expect(save).toBeDisabled();
  await box.fill('   ');
  await expect(save).toBeDisabled();
  // Escape leaves the words as they were.
  await box.press('Escape');
  await expect(mine.locator('.cm-post-note')).toHaveText('Which transfer of Bahia Blanca?');

  await mine.getByRole('button', {name: 'Post options'}).click();
  await mine.getByRole('menuitem', {name: 'Edit post'}).click();
  await mine.getByLabel('Edit your post').fill('Which transfer of Bahia Blanca do you use?');
  await mine.getByRole('button', {name: 'Save changes'}).click();
  const edited = mine;
  await expect(edited.locator('.cm-post-note')).toHaveText('Which transfer of Bahia Blanca do you use?');
  await expect(edited.locator('.cm-post-edited')).toContainText('edited');
  const stored = stub.posts.find(p => p.note === 'Which transfer of Bahia Blanca do you use?');
  expect(stored?.edited_at).toBeTruthy();

  // Someone else's post offers no editing.
  await post(STUB_MARTA_POST).getByRole('button', {name: 'Post options'}).click();
  await expect(post(STUB_MARTA_POST).getByRole('menuitem', {name: 'Edit post'})).toHaveCount(0);
  await page.keyboard.press('Escape');
  await post(STUB_MARTA_POST).getByRole('button', {name: 'Post options'}).click();

  // Gone again, for the tests that follow.
  stub.posts.splice(stub.posts.indexOf(stored!), 1);
  await page.getByRole('button', {name: 'Refresh'}).click();
  await expect(edited).toHaveCount(0);
});

test('a post can be reported, and its author blocked', async () => {
  const marta = post(STUB_MARTA_POST);
  await marta.getByRole('button', {name: 'Post options'}).click();
  await marta.getByRole('menuitem', {name: 'Report post…'}).click();
  const report = page.getByRole('dialog', {name: 'Report this post'});
  await report.getByLabel('Abusive or hateful').check();
  await report.getByRole('button', {name: 'Send report'}).click();
  await expect(report).toHaveCount(0);
  expect(stub.reports).toEqual([expect.objectContaining({post_id: STUB_MARTA_POST, reason: 'Abusive or hateful', reporter_id: ME})]);

  await marta.getByRole('button', {name: 'Post options'}).click();
  await marta.getByRole('menuitem', {name: 'Block Marta Kowalczyk'}).click();
  await page.getByRole('alertdialog').getByRole('button', {name: 'Block'}).click();
  await expect(post(STUB_MARTA_POST)).toHaveCount(0);
  expect(stub.blocks.has(`${ME}|${STUB_MARTA}`)).toBe(true);
  // Her comment on the question disappears with her.
  await expect(post(STUB_LUCIA_POST)).not.toContainText('A light vals');
});

test('unsharing takes the post down and unmarks the tanda', async () => {
  await gotoView(page, 'Tandas');
  // Clicking "Shared" asks before taking the tanda down.
  await page.getByRole('button', {name: 'Shared', exact: true}).click();
  await page.getByRole('alertdialog').getByRole('button', {name: 'Unshare'}).click();

  await expect(page.getByRole('button', {name: 'Share', exact: true})).toBeVisible();
  await expect(page.getByRole('button', {name: 'Shared', exact: true})).toHaveCount(0);
  expect(myPost()).toBeUndefined();

  await gotoView(page, 'Community');
  await expect(page.locator('.cm-post', {hasText: TANDA_NAME})).toHaveCount(0);
});

test('a tanda can be added to a post from the composer', async () => {
  // (The tanda was unshared by the test above, so it can be shared again.)
  const field = page.getByLabel('Write a post');
  await field.fill('Trying this as an opener on Friday.');
  // The tandas are listed right under the button; no dialog. A click elsewhere
  // puts the list away.
  const add = page.getByRole('button', {name: 'Add a tanda'});
  const list = page.getByRole('menu', {name: 'Your tandas'});
  await add.click();
  await expect(list).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await field.click();
  await expect(list).toHaveCount(0);
  await add.click();
  await list.getByRole('menuitem', {name: new RegExp(TANDA_NAME)}).click();
  await expect(list).toHaveCount(0);

  // The tanda sits in the composer, with what was typed still there.
  await expect(page.locator('.cm-attached')).toContainText(TANDA_NAME);
  await expect(page.locator('.cm-compose-hint')).toContainText('Only the song details are shared');
  await expect(page.getByRole('button', {name: 'Add a tanda'})).toHaveCount(0);
  await expect(field).toHaveValue('Trying this as an opener on Friday.');
  await page.getByRole('button', {name: 'Post', exact: true}).click();

  // It is posted as a shared tanda, with those words as its note.
  const first = page.locator('.cm-post').first();
  await expect(first.locator('.cm-post-author')).toHaveText(new RegExp(`Test DJ\\s+shared\\s+${TANDA_NAME}`));
  await expect(first).toContainText('Trying this as an opener on Friday.');
  expect(myPost()).toMatchObject({kind: 'tanda', note: 'Trying this as an opener on Friday.'});
  await expect(page.locator('.cm-attached')).toHaveCount(0);
});

test('another account on this computer sees its own "Shared" markers', async () => {
  // Test DJ's tanda is shared (by the test above). Someone else signs in here…
  await gotoView(page, 'Tandas');
  await expect(page.getByRole('button', {name: 'Shared', exact: true})).toBeVisible();
  await gotoView(page, 'Settings');
  await page.getByRole('button', {name: 'Sign out'}).click();
  await gotoView(page, 'Community');
  await page.getByRole('button', {name: 'Create an account'}).click();
  await page.getByLabel('Email').fill(STUB_NEW_ACCOUNT.email);
  await page.getByLabel('Password').fill(STUB_NEW_ACCOUNT.password);
  await page.getByRole('button', {name: 'Create account', exact: true}).click();
  await page.getByLabel('Confirmation code').fill(STUB_NEW_ACCOUNT.code);
  await page.getByRole('button', {name: 'Confirm email'}).click();
  await expect(page.locator('.cm-me-name')).toHaveText('New DJ');

  // …and sees the tanda as not shared: Test DJ's post isn't theirs to take down.
  await gotoView(page, 'Tandas');
  await expect(page.getByRole('button', {name: 'Share', exact: true})).toBeVisible();
  await expect(page.getByRole('button', {name: 'Shared', exact: true})).toHaveCount(0);

  // Back as Test DJ, the marker is there again, still pointing at their post.
  await gotoView(page, 'Settings');
  await page.getByRole('button', {name: 'Sign out'}).click();
  await gotoView(page, 'Community');
  await page.getByLabel('Email').fill(STUB_ACCOUNT.email);
  await page.getByLabel('Password').fill(STUB_ACCOUNT.password);
  await page.getByRole('button', {name: 'Sign in', exact: true}).click();
  await expect(page.locator('.cm-me-name')).toHaveText('Test DJ');
  await gotoView(page, 'Tandas');
  await expect(page.getByRole('button', {name: 'Shared', exact: true})).toBeVisible();
  expect(myPost()).toBeDefined();
});

test('the Community follows the language, its error messages included', async () => {
  // Expected words come from the locale files, so rewording a translation
  // doesn't break this test.
  const locales = fileURLToPath(new URL('../packages/renderer/locales/', import.meta.url));
  const el = (ns: string): Record<string, string> => JSON.parse(readFileSync(join(locales, 'el', `${ns}.json`), 'utf8'));
  const [common, community, errors] = [el('common'), el('community'), el('communityErrors')];
  const language = page.locator('select.tp-set-select').filter({has: page.locator('option[value="el"]')});
  const tab = (name: string) => page.locator('.tp-navset').getByRole('tab', {name: new RegExp(`^${name}`)});

  await gotoView(page, 'Settings');
  await language.selectOption('el');
  await tab(common['nav.Community']).click();
  const nav = page.getByRole('navigation', {name: common['nav.Community']});
  await expect(nav.getByRole('button', {name: community.navFeed})).toBeVisible();
  await expect(page.getByLabel(community.writePost)).toBeVisible();
  // No message left as its raw key anywhere on screen.
  const text = await page.locator('.tp-app').innerText();
  expect(text.match(/\b(community|communityErrors)\.[a-z]\w*/)?.[0]).toBeUndefined();

  // A message from the main process arrives as a key and is worded here.
  const res = await page.evaluate(() => (window as any).CommunityStore.ask('   '));
  expect(res).toEqual({ok: false, error: errors.writeSomething});

  // Back to English for whatever runs next.
  await tab(common['nav.Settings']).click();
  await language.selectOption('en');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
});
