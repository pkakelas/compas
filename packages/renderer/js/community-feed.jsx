// community-feed.jsx — the signed-in Community tab: a feed of shared tandas and
// questions, with the conversation shown under each post.
//
// Every shared tanda arrives already matched against this computer's library
// (the main process does that locally), so a post knows which of its songs the
// DJ owns: all of them → "Ready to play", otherwise how many are missing.

const CM_REPORT_REASONS = ["Spam", "Abusive or hateful", "Not about tango DJing", "Something else"];

function cmInitials(name) { return communityInitials({ displayName: name }); }

/* ---------- report a post ---------- */
function ReportModal({ onCancel, onSend }) {
  const [reason, setReason] = React.useState(CM_REPORT_REASONS[0]);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const send = async (e) => {
    e.preventDefault();
    setBusy(true); setError("");
    const res = await onSend(reason);
    setBusy(false);
    if (!res.ok) setError(res.error);
  };
  return (
    <div className="tp-modal-scrim" onMouseDown={busy ? undefined : onCancel}>
      <form className="tp-modal cm-report" role="dialog" aria-modal="true" aria-label="Report this post"
        onMouseDown={(e) => e.stopPropagation()} onSubmit={send}>
        <div className="tp-modal-title">Report this post</div>
        <div className="tp-modal-msg">What is wrong with it? Reports are private.</div>
        <div className="cm-report-list" role="radiogroup" aria-label="Reason">
          {CM_REPORT_REASONS.map((r) => (
            <label key={r} className="cm-check">
              <input type="radio" name="cm-report-reason" checked={reason === r} onChange={() => setReason(r)} /> {r}
            </label>
          ))}
        </div>
        {error && <div className="cm-error" role="alert">{error}</div>}
        <div className="tp-modal-actions">
          <button type="button" className="tp-modal-cancel" onClick={onCancel} disabled={busy}>Cancel</button>
          <button type="submit" className="tp-modal-confirm accent" disabled={busy}>{busy ? "Sending…" : "Send report"}</button>
        </div>
      </form>
    </div>
  );
}

/* ---------- the tanda inside a post ---------- */
function PostTanda({ post, inMyTandas, preview, onPlay, onAdd, onPickOrq }) {
  const t = post.tanda;
  const total = t.songs.length;
  // Up to two orchestras, each once, with the key the feed filters on.
  const orqList = [];
  for (const s of t.songs) {
    // (A song can be posted without its orchestra, when the sharer didn't know it.)
    if (s.orq && !orqList.some((o) => o.key === s.orqKey)) orqList.push({ key: s.orqKey, name: s.orq });
  }
  const shownOrqs = orqList.slice(0, 2);
  const singers = [...new Set(t.songs.map((s) => s.singer).filter(Boolean))].slice(0, 2).join(", ");
  // Mood tags are the sharer's private shorthand; the feed leaves them out.
  // …and orchestra tags would only repeat the name printed beside them.
  const tags = t.tags.filter((g) => g.cat !== "mood" && g.cat !== "orquesta");
  return (
    <div className="cm-post-tanda">
      {/* The tanda is named in the post's own headline ("… shared <name>"), so
          this row only adds who plays it, and the one thing to do with it: play
          it when every song is here, otherwise how much of it is. */}
      <div className="cm-post-tanda-row">
        <div className="cm-post-tanda-by">
          {/* Clicking an orchestra shows only its tandas. */}
          {shownOrqs.map((o) => (
            o.key && onPickOrq
              ? <button type="button" key={o.key} className="cm-orq-link" onClick={() => onPickOrq(o.key)}
                  title={`Show only tandas by ${o.name}`}>{o.name}</button>
              : <span key={o.name}>{o.name}</span>
          ))}
          {orqList.length === 0 && <span>Orchestra unknown</span>}
          {singers && <span>{singers}</span>}
          {tags.length > 0 && <TagPills tags={tags} />}
        </div>
        {t.ready ? (
          <div className="cm-post-tanda-actions">
            {/* Two small icon buttons: keep the tanda, and play it. */}
            {/* Someone else's tanda can be kept (a tick once it has been); the
                DJ's own post needs neither. */}
            {!post.mine && (inMyTandas
              ? <span className="cm-icon-btn is-done" role="img" aria-label="In your tandas" title="Already in your tandas"><I.check s={15} /></span>
              : <button type="button" className="cm-icon-btn" onClick={onAdd}
                  aria-label="Add to my tandas" title="Add to my tandas"><I.download s={16} /></button>)}
            <button type="button" className="cm-icon-btn" onClick={onPlay}
              aria-label="Play tanda" title="Play tanda"><I.play s={15} /></button>
          </div>
        ) : (
          <div className="cm-match cm-match-partial">
            {t.owned === 0 ? "None in your library" : `${t.owned} of ${total} in your library`}
          </div>
        )}
      </div>
      <div className="cm-post-songs">
        {t.songs.map((s, i) => {
          // A song the DJ owns can be listened to in place, like on a tanda
          // card, and shows as playing while it is.
          const own = s.songId ? Store.songById(s.songId) : null;
          const isPlaying = !!(own && preview && preview.previewId === own.id && preview.playing);
          return (
            <div key={i}
              className={"cm-post-song" + (s.songId ? "" : " is-missing") + (own && preview ? " is-clickable" : "") + (isPlaying ? " playing" : "")}
              onClick={own && preview ? () => preview.toggle(own) : undefined}
              title={own ? previewTitle(preview, isPlaying) : undefined}>
              <span className="n">
                <span className="num">{i + 1}</span>
                {own && <PreviewGlyph preview={preview} playing={isPlaying} n={null} s={11} />}
              </span>
              <span className="t">{s.title}</span>
              {s.songId
                ? <span className="own" role="img" aria-label="In your library"><I.check s={14} /></span>
                : <span className="miss">{s.orq || orqList.length === 0 ? "Missing" : "Orchestra unknown"}</span>}
              <span className="d">{s.year || ""}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- one comment (bubble + actions) ---------- */
function PostComment({ c, isReply, onReply, onDelete }) {
  return (
    <div className={"cm-comment" + (isReply ? " is-reply" : "")}>
      <div className={"cm-avatar sm " + communityAvatarClass(c.author.id)} aria-hidden="true">{cmInitials(c.author.name)}</div>
      <div className="cm-comment-main">
        <div className="cm-bubble">
          <div className="cm-bubble-name">{c.author.name}</div>
          <div className="cm-bubble-text">{c.body}</div>
        </div>
        <div className="cm-comment-meta">
          <span>{communityAgo(c.createdAt)}</span>
          <button type="button" className="cm-meta-btn" onClick={() => onReply(c)}>Reply</button>
          {c.mine && <button type="button" className="cm-meta-btn" onClick={() => onDelete(c)}>Delete</button>}
        </div>
      </div>
    </div>
  );
}

/* ---------- a post ---------- */
function CommunityPost({ post, me, tandaSigs, onChange, onRemove, onReload, onPickOrq, flash, ask }) {
  const player = usePlayer();
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [loadingOlder, setLoadingOlder] = React.useState(false);
  const listRef = React.useRef(null);
  const [draft, setDraft] = React.useState("");
  const [replyTo, setReplyTo] = React.useState(null);
  const [sending, setSending] = React.useState(false);
  const [reporting, setReporting] = React.useState(false);
  const inputRef = React.useRef(null);
  // The comment box stays out of the way until there is a conversation or the
  // DJ asks for it; `focusTick` puts the cursor in it once it has rendered.
  const [commentOpen, setCommentOpen] = React.useState(false);
  const [focusTick, setFocusTick] = React.useState(0);
  React.useEffect(() => { if (focusTick && inputRef.current) inputRef.current.focus(); }, [focusTick]);
  const openComment = () => { setCommentOpen(true); setFocusTick((n) => n + 1); };
  // A like just given plays a small pop on its heart.
  const [likePop, setLikePop] = React.useState(false);

  const ownedIds = post.tanda ? post.tanda.songs.map((s) => s.songId).filter(Boolean) : [];
  const inMyTandas = ownedIds.length > 0 && tandaSigs.has(ownedIds.slice().sort().join(","));

  const play = () => {
    const songs = ownedIds.map((id) => Store.songById(id)).filter(Boolean);
    if (songs.length) player.playTanda({ songs });
  };
  const addToMine = async () => {
    const t = post.tanda;
    await Store.saveTanda({ name: t.name || null, songIds: ownedIds, tags: t.tags });
    flash("Added to your tandas");
  };

  // Likes and saves flip at once and are undone if the backend refuses.
  const toggle = async (field, countField, call) => {
    const on = !post[field];
    const apply = (v) => onChange(post.id, (p) => ({
      ...p, [field]: v, ...(countField ? { [countField]: Math.max(0, p[countField] + (v ? 1 : -1)) } : {}),
    }));
    apply(on);
    const res = await call(post.id, on);
    if (!res.ok) { apply(!on); flash(res.error); }
  };

  // The post arrives with its newest few comments; earlier ones load a page at
  // a time into a list that scrolls rather than growing the post. A reply sits
  // under its parent when the parent is loaded, and on its own line otherwise.
  const loaded = post.comments;
  const loadedIds = new Set(loaded.map((c) => c.id));
  const tops = loaded.filter((c) => !c.parentId || !loadedIds.has(c.parentId));
  const repliesOf = (id) => loaded.filter((c) => c.parentId === id);
  const earlier = post.commentsExhausted ? 0 : Math.max(0, post.commentCount - loaded.length);
  const scrollList = (toEnd) => requestAnimationFrame(() => {
    const el = listRef.current;
    if (el) el.scrollTop = toEnd ? el.scrollHeight : 0;
  });
  const loadEarlier = async () => {
    if (loadingOlder) return;
    setLoadingOlder(true);
    const res = await CommunityStore.comments(post.id, loaded.length ? loaded[0].createdAt : null);
    setLoadingOlder(false);
    if (!res.ok) { flash(res.error); return; }
    onChange(post.id, (p) => ({
      ...p,
      comments: res.comments.filter((c) => !p.comments.some((x) => x.id === c.id)).concat(p.comments),
      commentsExhausted: !res.hasMore,
    }));
    scrollList(false);
  };

  const startReply = (c) => { setReplyTo(c); openComment(); };
  const sendComment = async (e) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    // Replies are one level deep: answering a reply answers its parent.
    const parentId = replyTo ? (replyTo.parentId || replyTo.id) : null;
    const res = await CommunityStore.comment(post.id, text, parentId);
    setSending(false);
    if (!res.ok) { flash(res.error); return; }
    setDraft(""); setReplyTo(null);
    onChange(post.id, (p) => ({ ...p, comments: p.comments.concat(res.comment), commentCount: p.commentCount + 1 }));
    scrollList(true);
  };
  // Deleting a comment can't be undone (and takes its replies with it), so ask.
  const deleteComment = (c) => {
    const replies = loaded.filter((x) => x.parentId === c.id).length;
    ask({
      title: "Delete this comment?",
      message: replies
        ? `It will be removed for everyone, along with ${replies === 1 ? "its reply" : `its ${replies} replies`}.`
        : "It will be removed for everyone.",
      confirmLabel: "Delete comment",
      onConfirm: async () => {
        const res = await CommunityStore.deleteComment(c.id);
        if (!res.ok) { flash(res.error); return; }
        onChange(post.id, (p) => {
          const gone = p.comments.filter((x) => x.id === c.id || x.parentId === c.id).length;
          return {
            ...p,
            comments: p.comments.filter((x) => x.id !== c.id && x.parentId !== c.id),
            commentCount: Math.max(0, p.commentCount - gone),
          };
        });
      },
    });
  };

  const deletePost = () => {
    setMenuOpen(false);
    ask({
      title: "Delete this post?",
      message: post.tanda
        ? "It will be removed from the Community, along with its likes and comments. The tanda stays in your collection."
        : "It will be removed from the Community, along with its likes and comments.",
      confirmLabel: "Delete post",
      onConfirm: async () => {
        const res = await CommunityStore.deletePost(post.id);
        if (res.ok) { onRemove(post.id); flash("Post deleted"); } else flash(res.error);
      },
    });
  };
  const blockAuthor = () => {
    setMenuOpen(false);
    ask({
      title: `Block ${post.author.name}?`,
      message: "You won’t see their posts or comments any more. They are not told.",
      confirmLabel: "Block",
      onConfirm: async () => {
        const res = await CommunityStore.block(post.author.id);
        if (res.ok) { flash(`${post.author.name} blocked`); onReload(); } else flash(res.error);
      },
    });
  };
  const sendReport = async (reason) => {
    const res = await CommunityStore.report({ postId: post.id }, reason);
    if (res.ok) { setReporting(false); flash("Report sent. Thank you."); }
    return res;
  };

  const where = [post.author.city, communityAgo(post.createdAt)].filter(Boolean).join(" · ");
  return (
    <article className={"cm-post" + (post.kind === "question" ? " is-question" : "")} data-post-id={post.id}>
      <div className="cm-post-head">
        <div className={"cm-avatar " + communityAvatarClass(post.author.id)} aria-hidden="true">{cmInitials(post.author.name)}</div>
        <div className="tp-flex1">
          <div className="cm-post-author">
            <b>{post.author.name}</b>{" "}
            {post.kind === "question" ? <span>posted</span>
              : post.tanda && post.tanda.name ? <><span>shared</span> <b className="cm-post-tname">{post.tanda.name}</b></>
              : <span>shared a tanda</span>}
          </div>
          <div className="cm-post-where">{where}</div>
        </div>
        <div className="cm-menu-wrap">
          <button type="button" className="tv-tcbtn del" aria-label="Post options" aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}><I.dots s={16} /></button>
          {menuOpen && (
            <div className="cm-menu" role="menu">
              {post.mine ? (
                <button type="button" role="menuitem" onClick={deletePost}><I.trash s={14} /> Delete post</button>
              ) : (
                <>
                  <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); setReporting(true); }}>Report post…</button>
                  <button type="button" role="menuitem" onClick={blockAuthor}>Block {post.author.name}</button>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {post.note && <p className="cm-post-note">{post.note}</p>}

      {post.tanda && <PostTanda post={post} inMyTandas={inMyTandas} preview={player.preview} onPlay={play} onAdd={addToMine} onPickOrq={onPickOrq} />}

      {/* A light row of actions, each with its count once there is one. */}
      <div className="cm-post-actions">
        <button type="button" className={"cm-act" + (post.liked ? " on" : "") + (likePop ? " pop" : "")} aria-pressed={post.liked}
          onClick={() => { setLikePop(!post.liked); toggle("liked", "likeCount", CommunityStore.like); }}>
          {post.liked ? <I.heartFill s={17} /> : <I.heart s={17} />} {post.liked ? "Liked" : "Like"}
          {post.likeCount > 0 && <>{" "}<span className="cm-act-n">{post.likeCount}</span></>}
        </button>
        <button type="button" className="cm-act" onClick={openComment}>
          <I.chat s={17} /> Comment
          {post.commentCount > 0 && <>{" "}<span className="cm-act-n">{post.commentCount}</span></>}
        </button>
        <button type="button" className={"cm-act" + (post.saved ? " on" : "")} aria-pressed={post.saved}
          onClick={() => toggle("saved", null, CommunityStore.save)}>
          {post.saved ? <I.bookmarkFill s={17} /> : <I.bookmark s={17} />} {post.saved ? "Saved" : "Save"}
        </button>
      </div>

      {earlier > 0 && (
        <button type="button" className="cm-more" onClick={loadEarlier} disabled={loadingOlder}>
          {loadingOlder ? "Loading…" : `View ${earlier} earlier ${earlier === 1 ? "comment" : "comments"}`}
        </button>
      )}
      {tops.length > 0 && (
        <div className={"cm-comments" + (loaded.length > 5 ? " is-long" : "")} ref={listRef}>
          {tops.map((c) => (
            <React.Fragment key={c.id}>
              <PostComment c={c} onReply={startReply} onDelete={deleteComment} />
              {repliesOf(c.id).map((r) => (
                <PostComment key={r.id} c={r} isReply onReply={startReply} onDelete={deleteComment} />
              ))}
            </React.Fragment>
          ))}
        </div>
      )}

      {replyTo && (
        <div className="cm-replying">
          Replying to <b>{replyTo.author.name}</b>
          <button type="button" className="cm-meta-btn" onClick={() => setReplyTo(null)}>Cancel</button>
        </div>
      )}
      {(commentOpen || loaded.length > 0 || post.commentCount > 0) && (
        <form className="cm-comment-form" onSubmit={sendComment}>
          <div className={"cm-avatar sm " + communityAvatarClass(me.id)} aria-hidden="true">{communityInitials(me)}</div>
          <input ref={inputRef} className="cm-input cm-comment-input" type="text" maxLength={1000}
            aria-label="Write a comment" placeholder={replyTo ? "Write a reply…" : "Write a comment…"}
            value={draft} onChange={(e) => setDraft(e.target.value)} />
          <button type="submit" className="cm-send" aria-label="Post comment" disabled={sending || !draft.trim()}><I.send s={15} /></button>
        </form>
      )}

      {reporting && <ReportModal onCancel={() => setReporting(false)} onSend={sendReport} />}
    </article>
  );
}

/* ---------- notifications ---------- */
/* What other DJs did with your posts and comments, newest first. Opening the
   list is "having looked": the bell clears, while the rows that were new keep
   their dot for this visit. */
function NotificationsList({ onOpenPost, onOpenFeed }) {
  const [items, setItems] = React.useState(null);
  const [error, setError] = React.useState("");
  React.useEffect(() => {
    let alive = true;
    CommunityStore.notifications().then((res) => {
      if (!alive) return;
      if (res.ok) { setItems(res.items); CommunityStore.markNotificationsSeen(); }
      else { setItems([]); setError(res.error); }
    });
    return () => { alive = false; };
  }, []);

  const what = (n) => (n.postKind === "question" ? "post" : "tanda");
  const action = (n) => n.kind === "like" ? `liked your ${what(n)}`
    : n.kind === "reply" ? "replied to your comment on"
    : `commented on your ${what(n)}`;
  return (
    <>
      <h2 className="cm-list-title">Notifications</h2>
      {error && <div className="cm-error" role="alert">{error}</div>}
      {!items && <div className="cm-skels" role="status" aria-label="Loading notifications"><PostSkeleton /></div>}
      {items && items.length === 0 && !error && (
        <div className="cm-empty">
          <div className="cm-empty-ic"><I.bell s={20} /></div>
          <div className="cm-empty-title">No notifications yet</div>
          <div className="cm-empty-sub">When someone likes or comments on what you share, you’ll see it here.</div>
        </div>
      )}
      {items && items.length > 0 && (
        <div className="cm-notifs">
          {items.map((n) => n.kind === "welcome" ? (
            // The one entry from Compás itself: every DJ's first notification.
            <button type="button" key={n.key} className={"cm-notif" + (n.unread ? " is-unread" : "")} onClick={onOpenFeed}>
              <span className="cm-avatar sm" aria-hidden="true"><I.note s={13} /></span>
              <span className="tp-flex1">
                <span className="cm-notif-text"><b>Welcome to the Community.</b> This is where DJs share the tandas they are proud of.</span>
                <span className="cm-notif-body">See what others are playing, then share one of yours.</span>
                <span className="cm-notif-when">{communityAgo(n.createdAt)}</span>
              </span>
              {n.unread && <span className="cm-notif-dot" role="img" aria-label="New" />}
            </button>
          ) : (
            <button type="button" key={n.key} className={"cm-notif" + (n.unread ? " is-unread" : "")}
              onClick={() => onOpenPost(n.postId)}>
              <span className={"cm-avatar sm " + communityAvatarClass(n.actor.id)} aria-hidden="true">{cmInitials(n.actor.name)}</span>
              <span className="tp-flex1">
                <span className="cm-notif-text">
                  <b>{n.actor.name}</b> {action(n)}{n.postTitle ? <> <b>{n.postTitle}</b></> : null}
                </span>
                {n.body && <span className="cm-notif-body">{n.body}</span>}
                <span className="cm-notif-when">{communityAgo(n.createdAt)}</span>
              </span>
              {n.unread && <span className="cm-notif-dot" role="img" aria-label="New" />}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

/* ---------- the feed ---------- */
const CM_SCOPES = [
  { id: "all", label: "Feed", icon: "home" },
  { id: "mine", label: "My posts", icon: "upload" },
  { id: "saved", label: "Saved", icon: "bookmark" },
  { id: "notifications", label: "Notifications", icon: "bell" },
];
// The two feed controls, worded for someone who has never seen the app.
const CM_SHOW = [
  { id: "all", label: "Everything" },
  { id: "ready", label: "Tandas I can play" },
  { id: "missing", label: "Tandas I can’t play yet" },
  { id: "questions", label: "Discussions" },
];
const CM_SORT = [
  { id: "popular", label: "Popular" },
  { id: "new", label: "Newest" },
  { id: "liked", label: "Most liked" },
];
// What an empty result means, per "Show" choice.
const CM_EMPTY_SHOW = {
  ready: ["No tandas you can play yet", "A shared tanda shows up here when every one of its songs is in your library."],
  missing: ["Nothing you can’t play", "You have every song of every tanda here."],
  questions: ["No discussions yet", "Nobody has started one here yet."],
};
const CM_EMPTY = {
  all: ["Nothing has been shared yet", "Tandas shared by the community will appear here. Be the first."],
  mine: ["You haven’t posted yet", "Share one of your tandas, or write something to the community."],
  saved: ["No saved posts", "Use Save on a post to keep it here."],
};

/* A grey stand-in for a post while the feed loads. */
function PostSkeleton() {
  return (
    <div className="cm-post cm-skel" aria-hidden="true">
      <div className="cm-skel-head"><i className="av" /><div><i className="l1" /><i className="l2" /></div></div>
      <i className="b1" /><i className="b2" /><i className="b3" />
    </div>
  );
}

// How often an open feed asks whether anything new has been posted.
const CM_NEW_POSTS_POLL_MS = 60000;

function CommunityFeed({ user, onOpenSettings, homeSignal, active }) {
  const community = useCommunity();
  const store = useStore();
  const { toast, flash, dismiss } = useToast();
  const { ask, modal } = useConfirm();
  const [scope, setScope] = React.useState("all");
  const [show, setShow] = React.useState("all");
  const [sort, setSort] = React.useState("popular");
  // The orchestra the feed is narrowed to (its key), or "" for all of them;
  // and the orchestras there are to choose from.
  const [orq, setOrq] = React.useState("");
  const [orchestras, setOrchestras] = React.useState([]);
  // A single post opened from a notification, shown on its own.
  const [focusPost, setFocusPost] = React.useState(null);
  const [nextOffset, setNextOffset] = React.useState(0);
  const [posts, setPosts] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [hasMore, setHasMore] = React.useState(false);
  const [error, setError] = React.useState("");
  // The post being written: its words, the tanda added to it (if any), and
  // whether the list of tandas to add is showing.
  const [postText, setPostText] = React.useState("");
  const [attached, setAttached] = React.useState(null);
  const [picking, setPicking] = React.useState(false);
  const [posting, setPosting] = React.useState(false);
  const request = React.useRef(0);
  // The one-line explanation of the library check, shown until dismissed.
  const [hintSeen, setHintSeen] = React.useState(() => {
    try { return localStorage.getItem("compas.communityHintSeen") === "1"; } catch (e) { return true; }
  });
  const dismissHint = () => {
    try { localStorage.setItem("compas.communityHintSeen", "1"); } catch (e) { /* ignore */ }
    setHintSeen(true);
  };
  const scrollRef = React.useRef(null);
  const sentinelRef = React.useRef(null);
  // The composer is one field, with "Add a tanda" (or the tanda added) and
  // "Post" under it. The field is taller while there is something to post.
  const composeRef = React.useRef(null);
  const pickRef = React.useRef(null);
  const composing = postText.length > 0 || !!attached;
  const resetComposer = () => { setPostText(""); setAttached(null); setPicking(false); };
  // The list of tandas closes on a click anywhere else, or Escape.
  React.useEffect(() => {
    if (!picking) return undefined;
    const onDown = (e) => { if (pickRef.current && !pickRef.current.contains(e.target)) setPicking(false); };
    const onKey = (e) => { if (e.key === "Escape") setPicking(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [picking]);
  // From the end of the feed: back up to the composer, with the list open.
  const pickFromTop = () => {
    if (scrollRef.current) scrollRef.current.scrollTo({ top: 0 });
    if (!attached) setPicking(true);
  };
  // When the newest post was made as of the last load, and whether something
  // newer has turned up since (the "New posts" pill).
  const newestSeen = React.useRef(null);
  const [hasNew, setHasNew] = React.useState(false);

  const load = React.useCallback(async (query) => {
    const mine = ++request.current;
    setLoading(true); setError("");
    const res = await CommunityStore.feed(query);
    if (mine !== request.current) return; // a newer load superseded this one
    setLoading(false);
    if (res.ok) { setPosts(res.posts); setHasMore(res.hasMore); setNextOffset(res.nextOffset); }
    else setError(res.error);
    // Whatever was newest at this moment has now been seen.
    setHasNew(false);
    const latest = await CommunityStore.latest();
    if (mine === request.current && latest.ok) newestSeen.current = latest.latestAt;
  }, []);
  const reload = () => {
    if (focusPost) { load({ scope: "all", postId: focusPost }); return; }
    // The notifications list loads itself; there are no posts to fetch for it.
    if (scope === "notifications") { request.current++; setPosts([]); setHasMore(false); setLoading(false); setError(""); return; }
    load({ scope, show, sort, orq: orq || null });
    // The list of orchestras changes as tandas are shared; keep it fresh too.
    CommunityStore.orchestras().then((res) => { if (res.ok) setOrchestras(res.orchestras); });
  };

  // Reload when what is asked for changes, when something was shared or removed
  // elsewhere, and when the library changes (the matching depends on it).
  const librarySize = (store.songs || []).length;
  React.useEffect(() => { reload(); }, [scope, show, sort, orq, focusPost, community.feedVersion, librarySize, user.id]);

  // The bell in the top bar was clicked: show the notifications.
  React.useEffect(() => {
    if (!community.openNotifications) return;
    setFocusPost(null); setScope("notifications");
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [community.openNotifications]);

  // The top bar's Community tab was clicked: back to the general feed, showing
  // everything, at the top. `homeSignal` is a counter, 0 until the first click.
  // Already there, the click just refreshes.
  const viewNow = React.useRef(null);
  viewNow.current = { scope, show, orq, focusPost };
  React.useEffect(() => {
    if (!homeSignal) return;
    const v = viewNow.current;
    if (v.scope === "all" && v.show === "all" && !v.orq && !v.focusPost) load({ scope: "all", show: "all", sort, orq: null });
    else { setFocusPost(null); setScope("all"); setShow("all"); setOrq(""); }
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [homeSignal]);

  const loadMore = async () => {
    if (loadingMore) return;
    setLoadingMore(true);
    const res = await CommunityStore.feed({ scope, show, sort, orq: orq || null, offset: nextOffset });
    setLoadingMore(false);
    if (res.ok) {
      setPosts((cur) => cur.concat(res.posts.filter((p) => !cur.some((c) => c.id === p.id))));
      setHasMore(res.hasMore); setNextOffset(res.nextOffset);
    } else flash(res.error);
  };

  // Older posts load by themselves as the end of the list comes near.
  const loadMoreNow = React.useRef(loadMore);
  loadMoreNow.current = loadMore;
  React.useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore || loading) return undefined;
    const io = new IntersectionObserver(
      (entries) => { if (entries.some((e) => e.isIntersecting)) loadMoreNow.current(); },
      { root: scrollRef.current, rootMargin: "600px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, loading, posts.length]);

  // While the Community tab is the one on screen, check now and then (and
  // whenever the window comes back to the front) for posts newer than the ones
  // loaded, and offer them — never reshuffle the feed under the reader.
  React.useEffect(() => {
    if (!active) return undefined;
    const check = async () => {
      if (document.visibilityState !== "visible") return;
      const res = await CommunityStore.latest();
      if (!res.ok || !res.latestAt) return;
      if (!newestSeen.current || res.latestAt > newestSeen.current) setHasNew(true);
    };
    const timer = setInterval(check, CM_NEW_POSTS_POLL_MS);
    window.addEventListener("focus", check);
    return () => { clearInterval(timer); window.removeEventListener("focus", check); };
  }, [active]);
  const showNew = () => {
    reload();
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  };

  // Picking an orchestra (from the list or by clicking its name on a post)
  // narrows the feed to its tandas; questions have no orchestra, so "Show" steps
  // off "Questions" if it was there.
  const pickOrq = (key) => {
    setOrq(key);
    if (key && show === "questions") setShow("all");
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  };
  const orqName = (orchestras.find((o) => o.key === orq) || {}).name || "";

  const changePost = (id, fn) => setPosts((cur) => cur.map((p) => (p.id === id ? fn(p) : p)));
  const removePost = (id) => setPosts((cur) => cur.filter((p) => p.id !== id));

  // A post is the DJ's words, with one of their tandas added or not: with a
  // tanda it is shared (their words become its note); without, it is just the
  // words (kind "question" in the backend).
  const submitPost = async (e) => {
    e.preventDefault();
    const text = postText.trim();
    if ((!text && !attached) || posting) return;
    setPosting(true);
    const res = attached
      ? await CommunityStore.shareTanda(attached.id, text, true)
      : await CommunityStore.ask(text);
    setPosting(false);
    if (!res.ok) { flash(res.error); return; }
    const wasTanda = !!attached;
    resetComposer();
    flash(wasTanda ? "Shared to Community" : "Posted");
    // Sharing a tanda refreshes the feed by itself; plain words need a nudge.
    if (!wasTanda) reload();
  };
  const attach = async (t) => {
    setPicking(false);
    // Checked up front, so a tanda that can't be shared says so here.
    const res = await CommunityStore.sharePreview(t.id, true);
    if (!res.ok) { flash(res.error); return; }
    setAttached(t);
    // Back to the text field, ready for a few words about it.
    requestAnimationFrame(() => { if (composeRef.current) composeRef.current.focus(); });
  };

  // The DJ's tandas that can be added to a post: not shared yet, and not empty.
  const shareable = (store.tandas || []).filter((t) => !t.sharedPostId && t.songs.length > 0);

  // The quiet line beside it: what sharing a tanda sends, or (once there are
  // words and no tanda) a nudge that one can be added. Never a gate.
  const composeHint = attached ? "Only the song details are shared, never the audio."
    : postText.trim() && shareable.length > 0 ? "You can add one of your tandas to this." : "";

  // Song-id signatures of the DJ's own tandas, to tell "already in your tandas".
  const tandaSigs = React.useMemo(
    () => new Set((store.tandas || []).map((t) => t.songs.map((s) => s.id).slice().sort().join(","))),
    [store.tandas],
  );

  // What the column is showing: the usual list of posts, the notifications,
  // or one post opened from a notification.
  const viewing = focusPost ? "post" : scope === "notifications" ? "notifications" : "list";

  const sub = [user.handle ? "@" + user.handle : null, user.city].filter(Boolean).join(" · ");
  const empty = (focusPost && ["This post is no longer here", "It may have been deleted by the DJ who shared it."])
    || (scope !== "mine" && orq && [`No tandas by ${orqName || "this orchestra"} here`, "Try another orchestra, or see everything."])
    || (scope !== "mine" && CM_EMPTY_SHOW[show]) || CM_EMPTY[scope];
  return (
    <div className="tv">
      <div className="cm-scroll" ref={scrollRef}>
        <div className="cm-feed">
          {/* left rail */}
          <aside className="cm-rail">
            <div className="cm-me">
              <div className={"cm-avatar " + communityAvatarClass(user.id)} aria-hidden="true">{communityInitials(user)}</div>
              <div className="tp-flex1">
                <div className="cm-me-name">{user.displayName || user.email || "Signed in"}</div>
                {sub && <div className="cm-me-sub">{sub}</div>}
              </div>
            </div>
            {onOpenSettings && (
              <button type="button" className="tp-btn sm block" onClick={onOpenSettings}><I.pencil s={14} /> Edit profile</button>
            )}
            <nav className="cm-nav" aria-label="Community">
              {CM_SCOPES.map((s) => {
                const Icon = I[s.icon];
                return (
                  <button type="button" key={s.id} className={"cm-nav-item" + (scope === s.id ? " on" : "")}
                    aria-current={scope === s.id ? "page" : undefined}
                    onClick={() => { setFocusPost(null); setScope(s.id); setShow("all"); setOrq(""); }}>
                    <Icon s={17} /> {s.label}
                    {s.id === "notifications" && community.unread > 0 && <span className="cm-nav-n">{community.unread > 9 ? "9+" : community.unread}</span>}
                  </button>
                );
              })}
            </nav>
          </aside>

          {/* feed column */}
          <main className="cm-col">
            {!user.handle && (
              <div className="cm-error" role="alert">
                Your profile couldn’t be loaded. Check your connection — it will appear once Compás can reach the Community server.
              </div>
            )}

            {/* Posting belongs to the feed, not to the "My posts" / "Saved" lists. */}
            {viewing === "list" && scope === "all" && (
              <form className={"cm-composer" + (composing ? " is-open" : "")} onSubmit={submitPost}>
                <div className={"cm-avatar " + communityAvatarClass(user.id)} aria-hidden="true">{communityInitials(user)}</div>
                <div className="cm-composer-main">
                  <textarea ref={composeRef} className="cm-input cm-textarea cm-composer-input" rows={composing ? 3 : 1} maxLength={500}
                    aria-label="Write a post" placeholder="What are you playing this week?"
                    value={postText} onChange={(e) => setPostText(e.target.value)} />
                  {/* One slot, two states: the button to add a tanda, or the tanda
                      that was added. "Post" is always there, so it is plain that
                      words alone can be posted. */}
                  <div className="cm-ask-actions">
                    {attached ? (
                      <span className="cm-attached">
                        <span className="acc"><I.note s={15} /></span>
                        <b>{attached.name || tandaMeta(attached).orq}</b>
                        <span className="n">{attached.songs.length} {attached.songs.length === 1 ? "song" : "songs"}</span>
                        <button type="button" className="cm-attached-x" onClick={() => setAttached(null)}
                          aria-label="Remove the tanda" title="Remove the tanda"><I.x s={13} /></button>
                      </span>
                    ) : (
                      <div className="cm-menu-wrap" ref={pickRef}>
                        <button type="button" className="cm-composer-btn" aria-haspopup="menu" aria-expanded={picking}
                          onClick={() => setPicking((v) => !v)}>
                          <span className="acc"><I.note s={16} /></span> Add a tanda
                        </button>
                        {picking && (
                          <div className="cm-menu cm-tanda-menu" role="menu" aria-label="Your tandas">
                            {shareable.map((t) => {
                              const m = tandaMeta(t);
                              return (
                                <button type="button" role="menuitem" key={t.id} onClick={() => attach(t)}>
                                  <span className="tp-flex1">
                                    <span className="cm-pick-name">{t.name || m.orq}</span>
                                    <span className="cm-pick-sub">{[t.name ? m.orq : null, m.singer || null].filter(Boolean).join(" · ")}</span>
                                  </span>
                                  <span className="cm-pick-n">{t.songs.length} {t.songs.length === 1 ? "song" : "songs"}</span>
                                </button>
                              );
                            })}
                            {shareable.length === 0 && (
                              <div className="cm-tanda-menu-empty">
                                {(store.tandas || []).length
                                  ? "Every tanda you have is already shared."
                                  : "You have no tandas yet. Build one in the Tandas tab, then add it here."}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                    {composeHint && <span className="cm-compose-hint">{composeHint}</span>}
                    <button type="submit" className="tp-btn primary sm" disabled={posting || (!postText.trim() && !attached)}>
                      {posting ? "Posting…" : "Post"}
                    </button>
                  </div>
                </div>
              </form>
            )}

            {viewing === "list" && hasNew && (
              <button type="button" className="cm-newpill" onClick={showNew}>
                <I.arrowDn s={14} /> New posts
              </button>
            )}

            {/* Two plain controls: what to show, and in what order. "My posts"
                keeps only the order — your own tandas are always in your library. */}
            {viewing === "list" && <div className="cm-filters">
              {scope === "mine" ? (
                <h2 className="cm-list-title">My posts</h2>
              ) : (
                <label className="cm-filter">
                  <span>Show</span>
                  <select className="tp-set-select cm-select" value={show} onChange={(e) => setShow(e.target.value)}>
                    {CM_SHOW.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                  </select>
                </label>
              )}
              {scope !== "mine" && (orchestras.length > 0 || orq) && (
                <label className="cm-filter">
                  <span>Orchestra</span>
                  <select className="tp-set-select cm-select" value={orq} onChange={(e) => pickOrq(e.target.value)}>
                    <option value="">All orchestras</option>
                    {orq && !orchestras.some((o) => o.key === orq) && <option value={orq}>{orq}</option>}
                    {orchestras.map((o) => <option key={o.key} value={o.key}>{o.name}</option>)}
                  </select>
                </label>
              )}
              <label className="cm-filter">
                <span>Sort by</span>
                <select className="tp-set-select cm-select" value={sort} onChange={(e) => setSort(e.target.value)}>
                  {CM_SORT.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                </select>
              </label>
              <button type="button" className="tv-tcbtn del cm-refresh" aria-label="Refresh" title="Refresh"
                onClick={reload} disabled={loading}><I.refresh s={15} /></button>
            </div>}

            {viewing === "list" && scope !== "mine" && librarySize === 0 && (
              <div className="cm-hint">
                <I.folder s={15} />
                <span className="tp-flex1">Import your music to see which shared tandas you can play.</span>
                <button type="button" className="cm-link" onClick={() => navigateTo("Library")}>Go to Library</button>
              </div>
            )}
            {viewing === "list" && scope !== "mine" && librarySize > 0 && !hintSeen && (
              <div className="cm-hint">
                <span className="ok"><I.check s={15} /></span>
                <span className="tp-flex1">Compás checks every shared tanda against your library. The tick marks the songs you already have.</span>
                <button type="button" className="cm-link" onClick={dismissHint}>Got it</button>
              </div>
            )}

            {viewing === "notifications" && (
              <NotificationsList onOpenPost={setFocusPost}
                onOpenFeed={() => { setScope("all"); setShow("all"); setOrq(""); }} />
            )}
            {viewing === "post" && (
              <button type="button" className="tp-btn sm cm-back" onClick={() => setFocusPost(null)}>
                <I.chev s={14} /> Back to notifications
              </button>
            )}

            {error && (
              <div className="cm-error" role="alert">
                {error} <button type="button" className="cm-link" onClick={reload}>Try again</button>
              </div>
            )}

            {posts.map((p) => (
              <CommunityPost key={p.id} post={p} me={user} tandaSigs={tandaSigs}
                onChange={changePost} onRemove={removePost} onReload={reload} onPickOrq={scope === "mine" ? undefined : pickOrq} flash={flash} ask={ask} />
            ))}

            {viewing !== "notifications" && !error && !loading && posts.length === 0 && (
              <div className="cm-empty">
                <div className="cm-empty-ic"><I.note s={20} /></div>
                <div className="cm-empty-title">{empty[0]}</div>
                <div className="cm-empty-sub">{empty[1]}</div>
                {viewing === "list" && scope !== "mine" && (show !== "all" || orq) && (
                  <button type="button" className="tp-btn sm cm-empty-btn" onClick={() => { setShow("all"); setOrq(""); }}>Show everything</button>
                )}
              </div>
            )}
            {loading && posts.length === 0 && (
              <div role="status" aria-label="Loading the feed" className="cm-skels">
                <PostSkeleton /><PostSkeleton /><PostSkeleton />
              </div>
            )}

            {loadingMore && <div className="cm-skels" aria-hidden="true"><PostSkeleton /><PostSkeleton /></div>}
            {hasMore && !loading && <div ref={sentinelRef} className="cm-sentinel" />}
            {/* The end of the feed is an invitation, not a dead end. */}
            {viewing === "list" && scope === "all" && !hasMore && !loading && !error && posts.length > 0 && (
              <div className="cm-end">
                <div className="cm-end-title">That’s it for now.</div>
                <div>Want this feed busier? Be the one to share a tanda with the rest of the tango nerds.</div>
                <button type="button" className="tp-btn sm" onClick={pickFromTop}><I.note s={14} /> Share a tanda</button>
              </div>
            )}
          </main>
        </div>
      </div>

      <Toast toast={toast} onDismiss={dismiss} />
      {modal}
    </div>
  );
}

Object.assign(window, { CommunityFeed });
