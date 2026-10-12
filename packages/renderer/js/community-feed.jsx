// community-feed.jsx — the signed-in Community tab: a feed of shared tandas and
// questions, with the conversation shown under each post.
//
// Every shared tanda arrives already matched against this computer's library
// (the main process does that locally), so a post knows which of its songs the
// DJ owns: all of them → "Ready to play", otherwise how many are missing.
//
// Every string is a message in locales/<locale>/community.json (see
// locales/README.md); tables keep message keys, never words.

// What a report says is wrong. `value` is what the moderator reads (stored as
// sent, in English); the DJ sees it in their own language.
const CM_REPORT_REASONS = [
  { value: "Spam", labelKey: "community.reportSpam" },
  { value: "Abusive or hateful", labelKey: "community.reportAbusive" },
  { value: "Not about tango DJing", labelKey: "community.reportOffTopic" },
  { value: "Something else", labelKey: "community.reportOther" },
];

/* ---------- report a post ---------- */
function ReportModal({ onCancel, onSend }) {
  const [reason, setReason] = React.useState(CM_REPORT_REASONS[0].value);
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
      <form className="tp-modal cm-report" role="dialog" aria-modal="true" aria-label={tr("community.reportTitle")}
        onMouseDown={(e) => e.stopPropagation()} onSubmit={send}>
        <div className="tp-modal-title">{tr("community.reportTitle")}</div>
        <div className="tp-modal-msg">{tr("community.reportWhy")}</div>
        <div className="cm-report-list" role="radiogroup" aria-label={tr("community.reportReason")}>
          {CM_REPORT_REASONS.map((r) => (
            <label key={r.value} className="cm-check">
              <input type="radio" name="cm-report-reason" checked={reason === r.value} onChange={() => setReason(r.value)} /> {tr(r.labelKey)}
            </label>
          ))}
        </div>
        {error && <div className="cm-error" role="alert">{error}</div>}
        <div className="tp-modal-actions">
          <button type="button" className="tp-modal-cancel" onClick={onCancel} disabled={busy}>{tr("common.cancel")}</button>
          <button type="submit" className="tp-modal-confirm accent" disabled={busy}>{busy ? tr("community.sending") : tr("community.sendReport")}</button>
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
  const singers = [...new Set(t.songs.map((s) => s.singer).filter(Boolean))].slice(0, 2).join(tr("common.listSeparator"));
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
                  title={tr("community.showOnlyOrq", { name: o.name })}>{o.name}</button>
              : <span key={o.name}>{o.name}</span>
          ))}
          {orqList.length === 0 && <span>{tr("community.orchestraUnknown")}</span>}
          {singers && <span>{singers}</span>}
          {tags.length > 0 && <TagPills tags={tags} />}
        </div>
        {t.ready ? (
          <div className="cm-post-tanda-actions">
            {/* Two small icon buttons: keep the tanda, and play it. */}
            {/* Someone else's tanda can be kept (a tick once it has been); the
                DJ's own post needs neither. */}
            {!post.mine && (inMyTandas
              ? <span className="cm-icon-btn is-done" role="img" aria-label={tr("community.inYourTandas")} title={tr("community.alreadyInYourTandas")}><I.check s={15} /></span>
              : <button type="button" className="cm-icon-btn" onClick={onAdd}
                  aria-label={tr("community.addToMyTandas")} title={tr("community.addToMyTandas")}><I.download s={16} /></button>)}
            <button type="button" className="cm-icon-btn" onClick={onPlay}
              aria-label={tr("community.playTanda")} title={tr("community.playTanda")}><I.play s={15} /></button>
          </div>
        ) : (
          <div className="cm-match cm-match-partial">
            {t.owned === 0 ? tr("community.noneInLibrary") : tr("community.someInLibrary", { owned: t.owned, total })}
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
                ? <span className="own" role="img" aria-label={tr("community.inYourLibrary")}><I.check s={14} /></span>
                : <span className="miss">{s.orq || orqList.length === 0 ? tr("community.missing") : tr("community.orchestraUnknown")}</span>}
              <span className="d">{s.year || ""}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- one comment (bubble + actions) ---------- */
function PostComment({ c, isReply, onLike, onReply, onDelete, onOpenProfile }) {
  // A like just given plays the same small pop as a post's.
  const [likePop, setLikePop] = React.useState(false);
  return (
    <div className={"cm-comment" + (isReply ? " is-reply" : "")}>
      <CommunityAvatar id={c.author.id} avatar={c.author.avatar} size="sm" />
      <div className="cm-comment-main">
        <div className="cm-bubble">
          <div className="cm-bubble-name">
            <button type="button" className="cm-name-btn" onClick={() => onOpenProfile(c.author.id)}>{c.author.name}</button>
          </div>
          <div className="cm-bubble-text">{c.body}</div>
        </div>
        <div className="cm-comment-meta">
          <span>{communityAgo(c.createdAt)}</span>
          <button type="button" className={"cm-meta-btn cm-meta-like" + (c.liked ? " on" : "") + (likePop ? " pop" : "")} aria-pressed={c.liked}
            onClick={() => { setLikePop(!c.liked); onLike(c); }}>
            {c.liked ? tr("community.liked") : tr("community.like")}
            {c.likeCount > 0 && <span className="cm-meta-n"><I.heartFill s={11} /> {c.likeCount}</span>}
          </button>
          <button type="button" className="cm-meta-btn" onClick={() => onReply(c)}>{tr("community.reply")}</button>
          {c.mine && <button type="button" className="cm-meta-btn" onClick={() => onDelete(c)}>{tr("common.delete")}</button>}
        </div>
      </div>
    </div>
  );
}

// The longest a post's words can be (the backend's limit).
const CM_NOTE_MAX = 500;

/* ---------- a post ---------- */
function CommunityPost({ post, me, tandaSigs, onChange, onRemove, onReload, onPickOrq, onOpenProfile, flash, ask }) {
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
  // Editing the words of one's own post: in place, where they are shown.
  const [editing, setEditing] = React.useState(false);
  const [editText, setEditText] = React.useState("");
  const [savingEdit, setSavingEdit] = React.useState(false);

  const ownedIds = post.tanda ? post.tanda.songs.map((s) => s.songId).filter(Boolean) : [];
  const inMyTandas = ownedIds.length > 0 && tandaSigs.has(ownedIds.slice().sort().join(","));

  const play = () => {
    const songs = ownedIds.map((id) => Store.songById(id)).filter(Boolean);
    if (songs.length) player.playTanda({ songs });
  };
  const addToMine = async () => {
    const t = post.tanda;
    await Store.saveTanda({ name: t.name || null, songIds: ownedIds, tags: t.tags });
    flash(tr("community.addedToTandas"));
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
  // A comment's like works the same way.
  const likeComment = async (c) => {
    const on = !c.liked;
    const apply = (v) => onChange(post.id, (p) => ({
      ...p,
      comments: p.comments.map((x) => (x.id === c.id && x.liked !== v
        ? { ...x, liked: v, likeCount: Math.max(0, x.likeCount + (v ? 1 : -1)) } : x)),
    }));
    apply(on);
    const res = await CommunityStore.likeComment(c.id, on);
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
    // The cursor is the oldest comment shown, by time and id (two comments can
    // share a timestamp).
    const res = await CommunityStore.comments(post.id, loaded.length ? { createdAt: loaded[0].createdAt, id: loaded[0].id } : null);
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
      title: tr("community.deleteCommentTitle"),
      message: replies
        ? tr("community.deleteCommentWithReplies", { count: replies })
        : tr("community.deleteCommentMsg"),
      confirmLabel: tr("community.deleteComment"),
      onConfirm: async () => {
        const res = await CommunityStore.deleteComment(c.id, post.id);
        if (!res.ok) { flash(res.error); return; }
        onChange(post.id, (p) => {
          // The backend's count after the delete: it also knows about the
          // replies that went with the comment but were never loaded here.
          const gone = p.comments.filter((x) => x.id === c.id || x.parentId === c.id).length;
          return {
            ...p,
            comments: p.comments.filter((x) => x.id !== c.id && x.parentId !== c.id),
            commentCount: typeof res.commentCount === "number" ? res.commentCount : Math.max(0, p.commentCount - gone),
          };
        });
      },
    });
  };

  // A post without a tanda is only its words, so they can't be emptied; a
  // shared tanda's note can.
  const startEdit = () => { setMenuOpen(false); setEditText(post.note || ""); setEditing(true); };
  const cancelEdit = () => { if (!savingEdit) setEditing(false); };
  const editUnchanged = editText.trim() === (post.note || "").trim();
  const editEmptyQuestion = post.kind === "question" && !editText.trim();
  const saveEdit = async (e) => {
    e.preventDefault();
    if (savingEdit || editUnchanged || editEmptyQuestion) return;
    setSavingEdit(true);
    const res = await CommunityStore.editPost(post.id, editText.trim());
    setSavingEdit(false);
    if (!res.ok) { flash(res.error); return; }
    onChange(post.id, (p) => ({ ...p, note: res.note, editedAt: res.editedAt }));
    setEditing(false);
    flash(tr("community.postUpdated"));
  };

  const deletePost = () => {
    setMenuOpen(false);
    ask({
      title: tr("community.deletePostTitle"),
      message: post.tanda ? tr("community.deletePostMsgTanda") : tr("community.deletePostMsg"),
      confirmLabel: tr("community.deletePost"),
      onConfirm: async () => {
        const res = await CommunityStore.deletePost(post.id);
        if (res.ok) { onRemove(post.id); flash(tr("community.postDeleted")); } else flash(res.error);
      },
    });
  };
  const blockAuthor = () => {
    setMenuOpen(false);
    ask({
      title: tr("community.blockTitle", { name: post.author.name }),
      message: tr("community.blockMsg"),
      confirmLabel: tr("community.block"),
      onConfirm: async () => {
        const res = await CommunityStore.block(post.author.id);
        if (res.ok) { flash(tr("community.blocked", { name: post.author.name })); onReload(); } else flash(res.error);
      },
    });
  };
  const sendReport = async (reason) => {
    const res = await CommunityStore.report({ postId: post.id }, reason);
    if (res.ok) { setReporting(false); flash(tr("community.reportSent")); }
    return res;
  };

  const where = [post.author.city, communityAgo(post.createdAt)].filter(Boolean).join(" · ");
  const name = <button type="button" className="cm-name-btn" onClick={() => onOpenProfile(post.author.id)}>{post.author.name}</button>;
  return (
    <article className={"cm-post" + (post.kind === "question" ? " is-question" : "")} data-post-id={post.id}>
      <div className="cm-post-head">
        <CommunityAvatar id={post.author.id} avatar={post.author.avatar} />
        <div className="tp-flex1">
          <div className="cm-post-author">
            {post.kind === "question" ? trx("community.headlinePosted", { name })
              : post.tanda && post.tanda.name ? trx("community.headlineSharedNamed", { name, tanda: <b className="cm-post-tname">{post.tanda.name}</b> })
              : trx("community.headlineShared", { name })}
          </div>
          <div className="cm-post-where">
            {where}
            {post.editedAt && <span className="cm-post-edited" title={communityAgo(post.editedAt)}> · {tr("community.editedMark")}</span>}
          </div>
        </div>
        <div className="cm-menu-wrap">
          <button type="button" className="tv-tcbtn del" aria-label={tr("community.postOptions")} aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}><I.dots s={16} /></button>
          {menuOpen && (
            <div className="cm-menu" role="menu">
              {post.mine ? (
                <>
                  <button type="button" role="menuitem" onClick={startEdit}><I.pencil s={14} /> {tr("community.editPost")}</button>
                  <button type="button" role="menuitem" onClick={deletePost}><I.trash s={14} /> {tr("community.deletePost")}</button>
                </>
              ) : (
                <>
                  <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); setReporting(true); }}>{tr("community.reportPost")}</button>
                  <button type="button" role="menuitem" onClick={blockAuthor}>{tr("community.blockName", { name: post.author.name })}</button>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {editing ? (
        <form className="cm-post-edit" onSubmit={saveEdit}
          onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); cancelEdit(); } }}>
          <textarea className="cm-input cm-textarea" rows={3} maxLength={CM_NOTE_MAX} autoFocus
            aria-label={tr("community.editLabel")}
            placeholder={post.kind === "question" ? tr("community.writePostPh") : tr("community.editNotePh")}
            value={editText} onChange={(e) => setEditText(e.target.value)} />
          <div className="cm-post-edit-actions">
            <button type="button" className="tp-btn sm" onClick={cancelEdit} disabled={savingEdit}>{tr("common.cancel")}</button>
            <button type="submit" className="tp-btn primary sm" disabled={savingEdit || editUnchanged || editEmptyQuestion}>
              {savingEdit ? tr("community.saving") : tr("community.saveChanges")}
            </button>
          </div>
        </form>
      ) : post.note && <p className="cm-post-note">{post.note}</p>}

      {post.tanda && <PostTanda post={post} inMyTandas={inMyTandas} preview={player.preview} onPlay={play} onAdd={addToMine} onPickOrq={onPickOrq} />}

      {/* A light row of actions, each with its count once there is one. */}
      <div className="cm-post-actions">
        <button type="button" className={"cm-act" + (post.liked ? " on" : "") + (likePop ? " pop" : "")} aria-pressed={post.liked}
          onClick={() => { setLikePop(!post.liked); toggle("liked", "likeCount", CommunityStore.like); }}>
          {post.liked ? <I.heartFill s={17} /> : <I.heart s={17} />} {post.liked ? tr("community.liked") : tr("community.like")}
          {post.likeCount > 0 && <>{" "}<span className="cm-act-n">{post.likeCount}</span></>}
        </button>
        <button type="button" className="cm-act" onClick={openComment}>
          <I.chat s={17} /> {tr("community.comment")}
          {post.commentCount > 0 && <>{" "}<span className="cm-act-n">{post.commentCount}</span></>}
        </button>
        <button type="button" className={"cm-act" + (post.saved ? " on" : "")} aria-pressed={post.saved}
          onClick={() => toggle("saved", null, CommunityStore.save)}>
          {post.saved ? <I.bookmarkFill s={17} /> : <I.bookmark s={17} />} {post.saved ? tr("community.saved") : tr("community.save")}
        </button>
      </div>

      {earlier > 0 && (
        <button type="button" className="cm-more" onClick={loadEarlier} disabled={loadingOlder}>
          {loadingOlder ? tr("community.loading") : tr("community.viewEarlier", { count: earlier })}
        </button>
      )}
      {tops.length > 0 && (
        <div className={"cm-comments" + (loaded.length > 5 ? " is-long" : "")} ref={listRef}>
          {tops.map((c) => (
            <React.Fragment key={c.id}>
              <PostComment onOpenProfile={onOpenProfile} c={c} onLike={likeComment} onReply={startReply} onDelete={deleteComment} />
              {repliesOf(c.id).map((r) => (
                <PostComment onOpenProfile={onOpenProfile} key={r.id} c={r} isReply onLike={likeComment} onReply={startReply} onDelete={deleteComment} />
              ))}
            </React.Fragment>
          ))}
        </div>
      )}

      {replyTo && (
        <div className="cm-replying">
          {trx("community.replyingTo", { name: <b>{replyTo.author.name}</b> })}
          <button type="button" className="cm-meta-btn" onClick={() => setReplyTo(null)}>{tr("common.cancel")}</button>
        </div>
      )}
      {(commentOpen || loaded.length > 0 || post.commentCount > 0) && (
        <form className="cm-comment-form" onSubmit={sendComment}>
          <CommunityAvatar id={me.id} avatar={me.avatar} size="sm" />
          <input ref={inputRef} className="cm-input cm-comment-input" type="text" maxLength={1000}
            aria-label={tr("community.writeComment")} placeholder={replyTo ? tr("community.writeReplyPh") : tr("community.writeCommentPh")}
            value={draft} onChange={(e) => setDraft(e.target.value)} />
          <button type="submit" className="cm-send" aria-label={tr("community.postComment")} disabled={sending || !draft.trim()}><I.send s={15} /></button>
        </form>
      )}

      {reporting && <ReportModal onCancel={() => setReporting(false)} onSend={sendReport} />}
    </article>
  );
}

/* ---------- notifications ---------- */
// What each notification says, with and without the post's title.
const CM_NOTIF_TEXT = {
  "like.tanda": { titledKey: "community.notifLikedTanda", untitledKey: "community.notifLikedTandaUntitled" },
  "like.post": { titledKey: "community.notifLikedPost", untitledKey: "community.notifLikedPostUntitled" },
  "comment.tanda": { titledKey: "community.notifCommentedTanda", untitledKey: "community.notifCommentedTandaUntitled" },
  "comment.post": { titledKey: "community.notifCommentedPost", untitledKey: "community.notifCommentedPostUntitled" },
  "reply": { titledKey: "community.notifReplied", untitledKey: "community.notifRepliedUntitled" },
  "comment_like": { titledKey: "community.notifLikedComment", untitledKey: "community.notifLikedCommentUntitled" },
  "follow": { titledKey: "community.notifFollowed", untitledKey: "community.notifFollowed" },
};
function cmNotifText(n) {
  const what = n.postKind === "question" ? "post" : "tanda";
  const text = n.kind === "reply" || n.kind === "comment_like" || n.kind === "follow" ? CM_NOTIF_TEXT[n.kind]
    : CM_NOTIF_TEXT[(n.kind === "like" ? "like." : "comment.") + what];
  const name = <b>{n.actor.name}</b>;
  return n.postTitle && n.kind !== "follow"
    ? trx(text.titledKey, { name, title: <b>{n.postTitle}</b> })
    : trx(text.untitledKey, { name });
}

/* What other DJs did with your posts and comments, newest first. Opening the
   list is "having looked": the bell clears, while the rows that were new keep
   their dot for this visit. */
function NotificationsList({ onOpenPost, onOpenFeed, onOpenProfile }) {
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

  return (
    <>
      <h2 className="cm-list-title">{tr("community.navNotifications")}</h2>
      {error && <div className="cm-error" role="alert">{error}</div>}
      {!items && <div className="cm-skels" role="status" aria-label={tr("community.loadingNotifications")}><PostSkeleton /></div>}
      {items && items.length === 0 && !error && (
        <div className="cm-empty">
          <div className="cm-empty-ic"><I.bell s={20} /></div>
          <div className="cm-empty-title">{tr("community.noNotifications")}</div>
          <div className="cm-empty-sub">{tr("community.noNotificationsSub")}</div>
        </div>
      )}
      {items && items.length > 0 && (
        <div className="cm-notifs">
          {items.map((n) => n.kind === "welcome" ? (
            // The one entry from Compás itself: every DJ's first notification.
            <button type="button" key={n.key} className={"cm-notif" + (n.unread ? " is-unread" : "")} onClick={onOpenFeed}>
              <span className="cm-avatar sm" aria-hidden="true"><I.note s={13} /></span>
              <span className="tp-flex1">
                <span className="cm-notif-text">{trx("community.welcomeText", { b: (s) => <b>{s}</b> })}</span>
                <span className="cm-notif-body">{tr("community.welcomeBody")}</span>
                <span className="cm-notif-when">{communityAgo(n.createdAt)}</span>
              </span>
              {n.unread && <span className="cm-notif-dot" role="img" aria-label={tr("community.new")} />}
            </button>
          ) : (
            <button type="button" key={n.key} className={"cm-notif" + (n.unread ? " is-unread" : "")}
              onClick={() => (n.kind === "follow" ? onOpenProfile(n.actor.id) : onOpenPost(n.postId))}>
              <CommunityAvatar id={n.actor.id} avatar={n.actor.avatar} size="sm" />
              <span className="tp-flex1">
                <span className="cm-notif-text">{cmNotifText(n)}</span>
                {n.body && <span className="cm-notif-body">{n.body}</span>}
                <span className="cm-notif-when">{communityAgo(n.createdAt)}</span>
              </span>
              {n.unread && <span className="cm-notif-dot" role="img" aria-label={tr("community.new")} />}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

/* ---------- a DJ's page ---------- */
/* Follow / Following, for the page itself and for rows in people lists.
   `person` carries `followed` and `mine`; the DJ's own entry gets no button. */
function FollowButton({ person, onChange, flash }) {
  const [busy, setBusy] = React.useState(false);
  if (person.mine) return null;
  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    const res = await CommunityStore.follow(person.id, !person.followed);
    setBusy(false);
    if (res.ok) onChange(!person.followed); else flash(res.error);
  };
  return (
    <button type="button" className={"tp-btn sm cm-follow" + (person.followed ? "" : " primary")}
      aria-pressed={person.followed} onClick={toggle} disabled={busy}>
      {person.followed ? <><I.check s={14} /> {tr("community.following")}</> : tr("community.follow")}
    </button>
  );
}

// The three counts on a DJ's page, which double as tabs.
const CM_PROFILE_TABS = [
  { id: "posts", count: (p) => p.posts, labelKey: "community.tabPosts" },
  { id: "followers", count: (p) => p.followers, labelKey: "community.tabFollowers" },
  { id: "following", count: (p) => p.following, labelKey: "community.tabFollowing" },
];

/* Who the DJ is, and three counts that double as tabs for what is listed
   under the card: their posts, who follows them, whom they follow. */
function ProfileCard({ profile, tab, onTab, onEdit, onFollowChange, flash }) {
  const joined = new Date(profile.joinedAt);
  const lang = document.documentElement.lang || undefined;
  const sub = [
    profile.handle ? "@" + profile.handle : null,
    profile.city,
    Number.isNaN(joined.getTime()) ? null
      : tr("community.joined", { date: joined.toLocaleDateString(lang, { month: "long", year: "numeric" }) }),
  ].filter(Boolean).join(" · ");
  return (
    <section className="cm-profile" aria-label={profile.name}>
      <div className="cm-profile-head">
        <CommunityAvatar id={profile.id} avatar={profile.avatar} size="lg" />
        <div className="tp-flex1 cm-profile-id">
          <h2 className="cm-profile-name">{profile.name}</h2>
          <div className="cm-profile-sub">{sub}</div>
          {profile.followsYou && !profile.mine && <span className="cm-profile-badge">{tr("community.followsYou")}</span>}
        </div>
        {profile.mine
          ? (onEdit && <button type="button" className="tp-btn sm" onClick={onEdit}><I.pencil s={14} /> {tr("community.editProfile")}</button>)
          : <FollowButton person={profile} onChange={onFollowChange} flash={flash} />}
      </div>
      {profile.bio && <p className="cm-profile-bio">{profile.bio}</p>}
      <div className="cm-profile-tabs" role="tablist">
        {CM_PROFILE_TABS.map((t) => {
          const n = t.count(profile);
          return (
            <button type="button" role="tab" key={t.id} aria-selected={tab === t.id}
              className={"cm-ptab" + (tab === t.id ? " on" : "")} onClick={() => onTab(t.id)}>
              {trx(t.labelKey, { count: n, b: (s) => <b>{s}</b> })}
            </button>
          );
        })}
      </div>
    </section>
  );
}

/* A DJ's followers, or the DJs they follow: a row each, with Follow. */
function PeopleList({ userId, which, onOpen, flash }) {
  const [people, setPeople] = React.useState(null); // null = loading
  const [hasMore, setHasMore] = React.useState(false);
  const [next, setNext] = React.useState(0);
  const [error, setError] = React.useState("");
  const [loadingMore, setLoadingMore] = React.useState(false);
  React.useEffect(() => {
    let alive = true;
    setPeople(null); setError("");
    CommunityStore.follows(userId, which, 0).then((res) => {
      if (!alive) return;
      if (res.ok) { setPeople(res.people); setHasMore(res.hasMore); setNext(res.nextOffset); }
      else { setPeople([]); setError(res.error); }
    });
    return () => { alive = false; };
  }, [userId, which]);
  const more = async () => {
    if (loadingMore) return;
    setLoadingMore(true);
    const res = await CommunityStore.follows(userId, which, next);
    setLoadingMore(false);
    if (res.ok) { setPeople((cur) => cur.concat(res.people.filter((p) => !cur.some((c) => c.id === p.id)))); setHasMore(res.hasMore); setNext(res.nextOffset); }
    else flash(res.error);
  };
  const setFollowed = (id, on) => setPeople((cur) => cur.map((p) => (p.id === id ? { ...p, followed: on } : p)));
  if (!people) return <div className="cm-skels" role="status" aria-label={tr("community.loadingShort")}><PostSkeleton /></div>;
  if (error) return <div className="cm-error" role="alert">{error}</div>;
  if (people.length === 0) {
    return (
      <div className="cm-empty">
        <div className="cm-empty-ic"><I.users s={20} /></div>
        <div className="cm-empty-title">{which === "followers" ? tr("community.noFollowers") : tr("community.notFollowing")}</div>
      </div>
    );
  }
  return (
    <div className="cm-people">
      {people.map((p) => (
        <div className="cm-person" key={p.id}>
          <button type="button" className="cm-person-main" onClick={() => onOpen(p.id)}>
            <CommunityAvatar id={p.id} avatar={p.avatar} />
            <span className="tp-flex1">
              <span className="cm-person-name">{p.name}</span>
              <span className="cm-person-sub">{[p.handle ? "@" + p.handle : null, p.city].filter(Boolean).join(" · ")}</span>
            </span>
          </button>
          <FollowButton person={p} onChange={(on) => setFollowed(p.id, on)} flash={flash} />
        </div>
      ))}
      {hasMore && <button type="button" className="tp-btn sm cm-people-more" onClick={more} disabled={loadingMore}>{tr("community.showMore")}</button>}
    </div>
  );
}

/* ---------- the feed ---------- */
const CM_SCOPES = [
  { id: "all", labelKey: "community.navFeed", icon: "home" },
  { id: "following", labelKey: "community.navFollowing", icon: "users" },
  { id: "mine", labelKey: "community.navMine", icon: "upload" },
  { id: "saved", labelKey: "community.navSaved", icon: "bookmark" },
  { id: "notifications", labelKey: "community.navNotifications", icon: "bell" },
];
// The two feed controls, worded for someone who has never seen the app.
const CM_SHOW = [
  { id: "all", labelKey: "community.showAll" },
  { id: "ready", labelKey: "community.showReady" },
  { id: "missing", labelKey: "community.showMissing" },
  { id: "questions", labelKey: "community.showDiscussions" },
];
const CM_SORT = [
  { id: "popular", labelKey: "community.sortPopular" },
  { id: "new", labelKey: "community.sortNew" },
  { id: "liked", labelKey: "community.sortLiked" },
];
// What an empty result means, per "Show" choice and per list.
const CM_EMPTY_SHOW = {
  ready: { titleKey: "community.emptyReadyTitle", subKey: "community.emptyReadySub" },
  missing: { titleKey: "community.emptyMissingTitle", subKey: "community.emptyMissingSub" },
  questions: { titleKey: "community.emptyDiscussionsTitle", subKey: "community.emptyDiscussionsSub" },
};
const CM_EMPTY = {
  all: { titleKey: "community.emptyAllTitle", subKey: "community.emptyAllSub" },
  following: { titleKey: "community.emptyFollowingTitle", subKey: "community.emptyFollowingSub" },
  mine: { titleKey: "community.emptyMineTitle", subKey: "community.emptyMineSub" },
  saved: { titleKey: "community.emptySavedTitle", subKey: "community.emptySavedSub" },
};
const CM_EMPTY_POST_GONE = { titleKey: "community.emptyPostGoneTitle", subKey: "community.emptyPostGoneSub" };
const CM_EMPTY_PROFILE = { titleKey: "community.emptyProfileTitle", subKey: "community.emptyProfileSub" };

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
  // The DJ whose page is open (null for the lists), which of its tabs, and
  // the page's card once loaded (null while loading; false if there is no such DJ).
  const [profileId, setProfileId] = React.useState(null);
  const [profileTab, setProfileTab] = React.useState("posts");
  const [profile, setProfile] = React.useState(null);
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
  const noPosts = () => { request.current++; setPosts([]); setHasMore(false); setLoading(false); setError(""); };
  // What the posts column is listing right now, as a feed query.
  const query = () => (profileId ? { scope: "all", sort: "new", author: profileId } : { scope, show, sort, orq: orq || null });
  const reload = () => {
    if (focusPost) { load({ scope: "all", postId: focusPost }); return; }
    // A DJ's page lists their posts; its other tabs list people, not posts.
    if (profileId) { if (profileTab === "posts") load(query()); else noPosts(); return; }
    // The notifications list loads itself; there are no posts to fetch for it.
    if (scope === "notifications") { noPosts(); return; }
    load(query());
    // The list of orchestras changes as tandas are shared; keep it fresh too.
    CommunityStore.orchestras().then((res) => { if (res.ok) setOrchestras(res.orchestras); });
  };

  // Reload when what is asked for changes, when something was shared or removed
  // elsewhere, and when the library changes (the matching depends on it).
  const librarySize = (store.songs || []).length;
  React.useEffect(() => { reload(); }, [scope, show, sort, orq, focusPost, profileId, profileTab, community.feedVersion, librarySize, user.id]);

  // The card of the DJ whose page is open.
  React.useEffect(() => {
    if (!profileId) { setProfile(null); return undefined; }
    let alive = true;
    setProfile(null);
    CommunityStore.profile(profileId).then((res) => {
      if (!alive) return;
      if (res.ok) setProfile(res.profile || false); else { setProfile(false); flash(res.error); }
    });
    return () => { alive = false; };
  }, [profileId, user.id]);
  const openProfile = (id) => {
    setFocusPost(null); setProfileTab("posts"); setProfileId(id);
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  };
  const closeProfile = () => { setProfileId(null); setProfile(null); };

  // The bell in the top bar was clicked: show the notifications.
  React.useEffect(() => {
    if (!community.openNotifications) return;
    setFocusPost(null); setProfileId(null); setScope("notifications");
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [community.openNotifications]);

  // The top bar's Community tab was clicked: back to the general feed, showing
  // everything, at the top. `homeSignal` is a counter, 0 until the first click.
  // Already there, the click just refreshes.
  const viewNow = React.useRef(null);
  viewNow.current = { scope, show, orq, focusPost, profileId };
  React.useEffect(() => {
    if (!homeSignal) return;
    const v = viewNow.current;
    if (v.scope === "all" && v.show === "all" && !v.orq && !v.focusPost && !v.profileId) load({ scope: "all", show: "all", sort, orq: null });
    else { setFocusPost(null); setProfileId(null); setScope("all"); setShow("all"); setOrq(""); }
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [homeSignal]);

  const loadMore = async () => {
    if (loadingMore) return;
    // Every new list (other scope, filter, order…) bumps `request`; a page
    // that arrives after that belongs to the old list and is dropped.
    const mine = request.current;
    setLoadingMore(true);
    const res = await CommunityStore.feed({ ...query(), offset: nextOffset });
    setLoadingMore(false);
    if (mine !== request.current) return;
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
    flash(wasTanda ? tr("community.sharedToCommunity") : tr("community.posted"));
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
  const composeHint = attached ? tr("community.composeHintTanda")
    : postText.trim() && shareable.length > 0 ? tr("community.composeHintAdd") : "";

  // Song-id signatures of the DJ's own tandas, to tell "already in your tandas".
  const tandaSigs = React.useMemo(
    () => new Set((store.tandas || []).map((t) => t.songs.map((s) => s.id).slice().sort().join(","))),
    [store.tandas],
  );

  // What the column is showing: the usual list of posts, the notifications,
  // or one post opened from a notification.
  const viewing = focusPost ? "post" : profileId ? "profile" : scope === "notifications" ? "notifications" : "list";

  const sub = [user.handle ? "@" + user.handle : null, user.city].filter(Boolean).join(" · ");
  const emptyOrq = { title: orqName ? tr("community.emptyOrqTitle", { name: orqName }) : tr("community.emptyOrqTitleAny"), sub: tr("community.emptyOrqSub") };
  const emptyOf = (e) => ({ title: tr(e.titleKey), sub: tr(e.subKey) });
  const empty = (focusPost && emptyOf(CM_EMPTY_POST_GONE))
    || (profileId && emptyOf(profile && profile.mine ? CM_EMPTY.mine : CM_EMPTY_PROFILE))
    || (scope !== "mine" && orq && emptyOrq)
    || (scope !== "mine" && CM_EMPTY_SHOW[show] && emptyOf(CM_EMPTY_SHOW[show]))
    || emptyOf(CM_EMPTY[scope] || CM_EMPTY.all);
  return (
    <div className="tv">
      <div className="cm-scroll" ref={scrollRef}>
        <div className="cm-feed">
          {/* left rail */}
          <aside className="cm-rail">
            <button type="button" className="cm-me cm-me-btn" onClick={() => openProfile(user.id)} title={tr("community.yourPage")}>
              <CommunityAvatar id={user.id} avatar={user.avatar} />
              <div className="tp-flex1">
                <div className="cm-me-name">{user.displayName || user.email || tr("community.signedIn")}</div>
                {sub && <div className="cm-me-sub">{sub}</div>}
              </div>
            </button>
            {onOpenSettings && (
              <button type="button" className="tp-btn sm block" onClick={onOpenSettings}><I.pencil s={14} /> {tr("community.editProfile")}</button>
            )}
            <nav className="cm-nav" aria-label={tr("common.nav.Community")}>
              {CM_SCOPES.map((s) => {
                const Icon = I[s.icon];
                return (
                  <button type="button" key={s.id} className={"cm-nav-item" + (scope === s.id && !profileId ? " on" : "")}
                    aria-current={scope === s.id && !profileId ? "page" : undefined}
                    onClick={() => { setFocusPost(null); setProfileId(null); setScope(s.id); setShow("all"); setOrq(""); }}>
                    <Icon s={17} /> {tr(s.labelKey)}
                    {s.id === "notifications" && community.unread > 0 && <span className="cm-nav-n">{community.unread > 9 ? "9+" : community.unread}</span>}
                  </button>
                );
              })}
            </nav>
          </aside>

          {/* feed column */}
          <main className="cm-col">
            {!user.handle && (
              <div className="cm-error" role="alert">{tr("community.profileNotLoaded")}</div>
            )}

            {/* Posting belongs to the feed, not to the "My posts" / "Saved" lists. */}
            {viewing === "list" && scope === "all" && (
              <form className={"cm-composer" + (composing ? " is-open" : "")} onSubmit={submitPost}>
                <CommunityAvatar id={user.id} avatar={user.avatar} />
                <div className="cm-composer-main">
                  <textarea ref={composeRef} className="cm-input cm-textarea cm-composer-input" rows={composing ? 3 : 1} maxLength={CM_NOTE_MAX}
                    aria-label={tr("community.writePost")} placeholder={tr("community.writePostPh")}
                    value={postText} onChange={(e) => setPostText(e.target.value)} />
                  {/* One slot, two states: the button to add a tanda, or the tanda
                      that was added. "Post" is always there, so it is plain that
                      words alone can be posted. */}
                  <div className="cm-ask-actions">
                    {attached ? (
                      <span className="cm-attached">
                        <span className="acc"><I.note s={15} /></span>
                        <b>{attached.name || tandaMeta(attached).orq}</b>
                        <span className="n">{tr("community.songs", { count: attached.songs.length })}</span>
                        <button type="button" className="cm-attached-x" onClick={() => setAttached(null)}
                          aria-label={tr("community.removeTanda")} title={tr("community.removeTanda")}><I.x s={13} /></button>
                      </span>
                    ) : (
                      <div className="cm-menu-wrap" ref={pickRef}>
                        <button type="button" className="cm-composer-btn" aria-haspopup="menu" aria-expanded={picking}
                          onClick={() => setPicking((v) => !v)}>
                          <span className="acc"><I.note s={16} /></span> {tr("community.addTanda")}
                        </button>
                        {picking && (
                          <div className="cm-menu cm-tanda-menu" role="menu" aria-label={tr("community.yourTandas")}>
                            {shareable.map((t) => {
                              const m = tandaMeta(t);
                              return (
                                <button type="button" role="menuitem" key={t.id} onClick={() => attach(t)}>
                                  <span className="tp-flex1">
                                    <span className="cm-pick-name">{t.name || m.orq}</span>
                                    <span className="cm-pick-sub">{[t.name ? m.orq : null, m.singer || null].filter(Boolean).join(" · ")}</span>
                                  </span>
                                  <span className="cm-pick-n">{tr("community.songs", { count: t.songs.length })}</span>
                                </button>
                              );
                            })}
                            {shareable.length === 0 && (
                              <div className="cm-tanda-menu-empty">
                                {(store.tandas || []).length ? tr("community.allShared") : tr("community.noTandas")}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                    {composeHint && <span className="cm-compose-hint">{composeHint}</span>}
                    <button type="submit" className="tp-btn primary sm" disabled={posting || (!postText.trim() && !attached)}>
                      {posting ? tr("community.posting") : tr("community.post")}
                    </button>
                  </div>
                </div>
              </form>
            )}

            {viewing === "list" && hasNew && (
              <button type="button" className="cm-newpill" onClick={showNew}>
                <I.arrowDn s={14} /> {tr("community.newPosts")}
              </button>
            )}

            {/* Two plain controls: what to show, and in what order. "My posts"
                keeps only the order — your own tandas are always in your library. */}
            {viewing === "list" && <div className="cm-filters">
              {scope === "mine" ? (
                <h2 className="cm-list-title">{tr("community.navMine")}</h2>
              ) : (
                <label className="cm-filter">
                  <span>{tr("community.show")}</span>
                  <select className="tp-set-select cm-select" value={show} onChange={(e) => setShow(e.target.value)}>
                    {CM_SHOW.map((o) => <option key={o.id} value={o.id}>{tr(o.labelKey)}</option>)}
                  </select>
                </label>
              )}
              {scope !== "mine" && (orchestras.length > 0 || orq) && (
                <label className="cm-filter">
                  <span>{tr("community.orchestra")}</span>
                  <select className="tp-set-select cm-select" value={orq} onChange={(e) => pickOrq(e.target.value)}>
                    <option value="">{tr("community.allOrchestras")}</option>
                    {orq && !orchestras.some((o) => o.key === orq) && <option value={orq}>{orq}</option>}
                    {orchestras.map((o) => <option key={o.key} value={o.key}>{o.name}</option>)}
                  </select>
                </label>
              )}
              <label className="cm-filter">
                <span>{tr("community.sortBy")}</span>
                <select className="tp-set-select cm-select" value={sort} onChange={(e) => setSort(e.target.value)}>
                  {CM_SORT.map((o) => <option key={o.id} value={o.id}>{tr(o.labelKey)}</option>)}
                </select>
              </label>
              <button type="button" className="tv-tcbtn del cm-refresh" aria-label={tr("community.refresh")} title={tr("community.refresh")}
                onClick={reload} disabled={loading}><I.refresh s={15} /></button>
            </div>}

            {viewing === "list" && scope !== "mine" && librarySize === 0 && (
              <div className="cm-hint">
                <I.folder s={15} />
                <span className="tp-flex1">{tr("community.importHint")}</span>
                <button type="button" className="cm-link" onClick={() => navigateTo("Library")}>{tr("community.goToLibrary")}</button>
              </div>
            )}
            {viewing === "list" && scope !== "mine" && librarySize > 0 && !hintSeen && (
              <div className="cm-hint">
                <span className="ok"><I.check s={15} /></span>
                <span className="tp-flex1">{tr("community.matchHint")}</span>
                <button type="button" className="cm-link" onClick={dismissHint}>{tr("community.gotIt")}</button>
              </div>
            )}

            {viewing === "notifications" && (
              <NotificationsList onOpenPost={setFocusPost} onOpenProfile={openProfile}
                onOpenFeed={() => { setScope("all"); setShow("all"); setOrq(""); }} />
            )}
            {viewing === "profile" && (
              <>
                <button type="button" className="tp-btn sm cm-back" onClick={closeProfile}>
                  <I.chev s={14} /> {tr("community.back")}
                </button>
                {profile === null && <div className="cm-skels" role="status" aria-label={tr("community.loadingProfile")}><PostSkeleton /></div>}
                {profile === false && (
                  <div className="cm-empty">
                    <div className="cm-empty-title">{tr("community.djGoneTitle")}</div>
                    <div className="cm-empty-sub">{tr("community.djGoneSub")}</div>
                  </div>
                )}
                {profile && (
                  <ProfileCard profile={profile} tab={profileTab} onTab={setProfileTab} onEdit={onOpenSettings} flash={flash}
                    onFollowChange={(on) => setProfile((p) => ({ ...p, followed: on, followers: Math.max(0, p.followers + (on ? 1 : -1)) }))} />
                )}
                {profile && profileTab !== "posts" && (
                  <PeopleList userId={profile.id} which={profileTab} onOpen={openProfile} flash={flash} />
                )}
              </>
            )}
            {viewing === "post" && (
              <button type="button" className="tp-btn sm cm-back" onClick={() => setFocusPost(null)}>
                <I.chev s={14} /> {tr("community.backToNotifications")}
              </button>
            )}

            {error && (
              <div className="cm-error" role="alert">
                {error} <button type="button" className="cm-link" onClick={reload}>{tr("community.tryAgain")}</button>
              </div>
            )}

            {posts.map((p) => (
              <CommunityPost key={p.id} post={p} me={user} tandaSigs={tandaSigs}
                onChange={changePost} onRemove={removePost} onReload={reload} onPickOrq={scope === "mine" || profileId ? undefined : pickOrq}
                onOpenProfile={openProfile} flash={flash} ask={ask} />
            ))}

            {viewing !== "notifications" && !(viewing === "profile" && (profileTab !== "posts" || !profile)) && !error && !loading && posts.length === 0 && (
              <div className="cm-empty">
                <div className="cm-empty-ic"><I.note s={20} /></div>
                <div className="cm-empty-title">{empty.title}</div>
                <div className="cm-empty-sub">{empty.sub}</div>
                {viewing === "list" && scope !== "mine" && (show !== "all" || orq) && (
                  <button type="button" className="tp-btn sm cm-empty-btn" onClick={() => { setShow("all"); setOrq(""); }}>{tr("community.showEverything")}</button>
                )}
              </div>
            )}
            {loading && posts.length === 0 && (
              <div role="status" aria-label={tr("community.loadingFeed")} className="cm-skels">
                <PostSkeleton /><PostSkeleton /><PostSkeleton />
              </div>
            )}

            {loadingMore && <div className="cm-skels" aria-hidden="true"><PostSkeleton /><PostSkeleton /></div>}
            {hasMore && !loading && <div ref={sentinelRef} className="cm-sentinel" />}
            {/* The end of the feed is an invitation, not a dead end. */}
            {viewing === "list" && scope === "all" && !hasMore && !loading && !error && posts.length > 0 && (
              <div className="cm-end">
                <div className="cm-end-title">{tr("community.endTitle")}</div>
                <div>{tr("community.endText")}</div>
                <button type="button" className="tp-btn sm" onClick={pickFromTop}><I.note s={14} /> {tr("community.shareATanda")}</button>
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
