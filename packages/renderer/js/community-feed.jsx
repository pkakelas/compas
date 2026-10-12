// community-feed.jsx — the signed-in Community tab: a feed of shared tandas and
// posts, a DJ's page, the notifications, and the conversation under each post.
//
// Every shared tanda arrives already matched against this computer's library
// (the main process does that locally), so a post knows which of its songs the
// DJ owns: all of them → Play, otherwise how many of them are here.
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

/* ---------- small shared pieces ---------- */

// A popover closes on a click anywhere outside it, or on Escape.
function useDismiss(open, ref, close) {
  const latest = React.useRef(close);
  latest.current = close;
  React.useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) latest.current(); };
    const onKey = (e) => { if (e.key === "Escape") latest.current(); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);
}

// Text as a search compares it: no accents, no case ("Pugliése" finds "pugliese").
const cmFold = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/* ---------- a shared tanda, described the way a DJ would ---------- */

// Its orchestras, each once, with the key the feed filters on. (A song can be
// posted without its orchestra, when the sharer didn't know it.)
function cmOrqs(t) {
  const out = [];
  for (const s of t.songs) if (s.orq && !out.some((o) => o.key === s.orqKey)) out.push({ key: s.orqKey, name: s.orq });
  return out;
}
// Its singers, each once. One credit can name two ("Fiorentino y Mandarino"),
// and a singer in it must not come back a second time on their own.
function cmSingers(songs) {
  const seen = new Map();
  for (const s of songs) {
    for (const part of String(s.singer || "").split(/\s*(?:,|&|\s+y\s+|\s+and\s+)\s*/i)) {
      const name = part.trim();
      if (name && !seen.has(cmFold(name))) seen.set(cmFold(name), name);
    }
  }
  return [...seen.values()];
}
// Its genre: the one all of its songs have, else the sharer's own type tag
// (Tango / Vals / Milonga). Null when neither says.
function cmGenre(t) {
  const genres = new Set(t.songs.map((s) => cmFold(s.genre)).filter((g) => g && g !== "mixed" && g !== "unknown"));
  if (genres.size === 1) return [...genres][0];
  const type = t.tags.find((g) => g.cat === "type" && isCoreStyle(cmFold(g.label)));
  return type ? cmFold(type.label) : null;
}
// "1941", or "1940–1948" for a tanda that spans years.
function cmYears(songs) {
  const years = songs.map((s) => s.year).filter(Boolean);
  if (!years.length) return "";
  const lo = Math.min(...years), hi = Math.max(...years);
  return lo === hi ? String(lo) : lo + "–" + hi;
}
// Its name — or, for one shared without a name, one made from its music:
// "Carlos Di Sarli · Milonga · 1940–1948".
function cmTandaTitle(t) {
  if (t.name) return t.name;
  const genre = cmGenre(t);
  return [
    cmOrqs(t).slice(0, 2).map((o) => o.name).join(tr("common.listSeparator")),
    genre ? genreLabel(genre) : "",
    cmYears(t.songs),
  ].filter(Boolean).join(" · ");
}
// The song list as plain text, a line a song, to paste into a note or a shop's
// search: "1. Nido gaucho — Carlos Di Sarli, Alberto Podestá (1942)".
function cmSongListText(t) {
  const lines = t.songs.map((s, i) => {
    const who = [s.orq, s.singer].filter(Boolean).join(", ");
    return (i + 1) + ". " + s.title + (who ? " — " + who : "") + (s.year ? " (" + s.year + ")" : "");
  });
  return [cmTandaTitle(t)].concat(lines).filter(Boolean).join("\n");
}
async function cmCopy(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch (e) { /* try the old way */ }
  try {
    const box = document.createElement("textarea");
    box.value = text;
    box.setAttribute("readonly", "");
    box.style.cssText = "position:fixed;opacity:0;pointer-events:none";
    document.body.appendChild(box);
    box.select();
    const ok = document.execCommand("copy");
    box.remove();
    return ok;
  } catch (e) {
    return false;
  }
}

/* ---------- the tanda inside a post ---------- */
function PostTanda({ post, inMyTandas, preview, onPlay, onAdd, onPickOrq }) {
  const t = post.tanda;
  const total = t.songs.length;
  const orqs = cmOrqs(t);
  const singers = cmSingers(t.songs).slice(0, 3).join(tr("common.listSeparator"));
  const genre = cmGenre(t);
  const years = cmYears(t.songs);
  // Mood tags are the sharer's private shorthand; the feed leaves them out.
  // Orchestra tags, and a type tag that says the genre, would only repeat what
  // is printed beside them.
  const tags = t.tags.filter((g) => g.cat !== "mood" && g.cat !== "orquesta"
    && !(g.cat === "type" && genre && cmFold(g.label) === genre));
  return (
    <div className="cm-post-tanda">
      {/* The tanda is named in the post's headline, so this row says what it
          is — genre, who plays it, when — and the one thing to do with it:
          play it when every song is here, otherwise how much of it is. */}
      <div className="cm-post-tanda-row">
        <div className="cm-post-tanda-by">
          {genre && <GenreTag genre={genre} small />}
          {/* Clicking an orchestra shows only its tandas. */}
          {orqs.slice(0, 2).map((o) => (
            o.key && onPickOrq
              ? <button type="button" key={o.key} className="cm-orq-link" onClick={() => onPickOrq(o.key)}
                  title={tr("community.showOnlyOrq", { name: o.name })}>{o.name}</button>
              : <span key={o.name}>{o.name}</span>
          ))}
          {orqs.length === 0 && <span>{tr("community.orchestraUnknown")}</span>}
          {singers && <span>{singers}</span>}
          {years && <span className="cm-years">{years}</span>}
          {tags.length > 0 && <TagPills tags={tags} />}
        </div>
        <div className="cm-post-tanda-actions">
          {t.ready ? (
            <>
              {/* Someone else's tanda can be kept (a tick once it has been);
                  the DJ's own post needs neither. */}
              {!post.mine && (inMyTandas
                ? <span className="cm-icon-btn is-done" role="img" aria-label={tr("community.inYourTandas")} title={tr("community.alreadyInYourTandas")}><I.check s={15} /></span>
                : <button type="button" className="cm-icon-btn" onClick={onAdd}
                    aria-label={tr("community.addToMyTandas")} title={tr("community.addToMyTandas")}><I.download s={16} /></button>)}
              <button type="button" className="cm-icon-btn" onClick={onPlay}
                aria-label={tr("community.playTanda")} title={tr("community.playTanda")}><I.play s={15} /></button>
            </>
          ) : (
            // How much of it is here, said once: a dot a song, filled for the
            // ones in the library.
            <span className="cm-match">
              <span className="cm-dots" aria-hidden="true">
                {t.songs.map((s, i) => <i key={i} className={s.songId ? "on" : ""} />)}
              </span>
              {t.owned === 0 ? tr("community.noneInLibrary") : tr("community.someInLibrary", { owned: t.owned, total })}
            </span>
          )}
        </div>
      </div>
      <div className="cm-post-songs">
        {t.songs.map((s, i) => {
          // A song the DJ owns has a tick and can be listened to in place, like
          // on a tanda card; one they don't is simply quieter.
          const own = s.songId ? Store.songById(s.songId) : null;
          const isPlaying = !!(own && preview && preview.previewId === own.id && preview.playing);
          return (
            <div key={i}
              className={"cm-post-song" + (s.songId ? "" : " is-missing") + (own && preview ? " is-clickable" : "") + (isPlaying ? " playing" : "")}
              onClick={own && preview ? () => preview.toggle(own) : undefined}
              title={own ? previewTitle(preview, isPlaying) : s.songId ? undefined : tr("community.notInLibrary")}>
              <span className="n">
                <span className="num">{i + 1}</span>
                {own && <PreviewGlyph preview={preview} playing={isPlaying} n={null} s={11} />}
              </span>
              <span className="t">{s.title}</span>
              {s.songId && <span className="own" role="img" aria-label={tr("community.inYourLibrary")}><I.check s={14} /></span>}
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

/* ---------- a post ----------
   Its conversation stays folded to one line until the DJ opens it (`expanded`,
   kept by the feed so it survives going to a DJ's page and back). */
function CommunityPost({ post, me, tandaSigs, expanded, onExpand, onChange, onRemove, onReload, onPickOrq, onOpenProfile, flash, ask }) {
  const player = usePlayer();
  const [menuOpen, setMenuOpen] = React.useState(false);
  const menuRef = React.useRef(null);
  useDismiss(menuOpen, menuRef, () => setMenuOpen(false));
  const [loadingOlder, setLoadingOlder] = React.useState(false);
  const listRef = React.useRef(null);
  const [draft, setDraft] = React.useState("");
  const [replyTo, setReplyTo] = React.useState(null);
  const [sending, setSending] = React.useState(false);
  const [reporting, setReporting] = React.useState(false);
  const inputRef = React.useRef(null);
  // `focusTick` puts the cursor in the comment box once it has rendered.
  const [focusTick, setFocusTick] = React.useState(0);
  React.useEffect(() => { if (focusTick && inputRef.current) inputRef.current.focus(); }, [focusTick]);
  const openComment = () => { onExpand(post.id); setFocusTick((n) => n + 1); };
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
  const copyList = async () => {
    setMenuOpen(false);
    const ok = await cmCopy(cmSongListText(post.tanda));
    flash(ok ? tr("community.songListCopied") : tr("community.copyFailed"));
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
  const latest = loaded.length ? loaded[loaded.length - 1] : null;
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
  const tandaTitle = post.tanda ? cmTandaTitle(post.tanda) : "";
  return (
    <article className={"cm-post" + (post.kind === "question" ? " is-question" : "")} data-post-id={post.id}>
      <div className="cm-post-head">
        <CommunityAvatar id={post.author.id} avatar={post.author.avatar} />
        <div className="tp-flex1">
          <div className="cm-post-author">
            {post.kind === "question" ? trx("community.headlinePosted", { name })
              : tandaTitle ? trx("community.headlineSharedNamed", { name, tanda: <b className="cm-post-tname">{tandaTitle}</b> })
              : trx("community.headlineShared", { name })}
          </div>
          <div className="cm-post-where">
            {where}
            {post.editedAt && <span className="cm-post-edited" title={communityAgo(post.editedAt)}> · {tr("community.editedMark")}</span>}
          </div>
        </div>
        <div className="cm-menu-wrap" ref={menuRef}>
          <button type="button" className="tv-tcbtn del" aria-label={tr("community.postOptions")} aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}><I.dots s={16} /></button>
          {menuOpen && (
            <div className="cm-menu" role="menu">
              {post.tanda && (
                <button type="button" role="menuitem" onClick={copyList}><I.copy s={14} /> {tr("community.copySongList")}</button>
              )}
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

      {/* Folded: one line saying how many comments there are, and the newest. */}
      {!expanded && post.commentCount > 0 && (
        <button type="button" className="cm-peek" onClick={() => onExpand(post.id)}>
          <span className="cm-peek-n">{tr("community.viewComments", { count: post.commentCount })}</span>
          {latest && <span className="cm-peek-last"><b>{latest.author.name}</b> {latest.body}</span>}
        </button>
      )}

      {expanded && (
        <>
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
          <form className="cm-comment-form" onSubmit={sendComment}>
            <CommunityAvatar id={me.id} avatar={me.avatar} size="sm" />
            <input ref={inputRef} className="cm-input cm-comment-input" type="text" maxLength={1000}
              aria-label={tr("community.writeComment")} placeholder={replyTo ? tr("community.writeReplyPh") : tr("community.writeCommentPh")}
              value={draft} onChange={(e) => setDraft(e.target.value)} />
            <button type="submit" className="cm-send" aria-label={tr("community.postComment")} disabled={sending || !draft.trim()}><I.send s={15} /></button>
          </form>
        </>
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
   their dot for this visit — until opened. The feed keeps the list (`data`),
   so coming back from a post shows it as it was; null means fetch it. */
function NotificationsList({ data, onData, onOpen }) {
  React.useEffect(() => {
    if (data) return undefined;
    let alive = true;
    CommunityStore.notifications().then((res) => {
      if (!alive) return;
      if (res.ok) { onData({ items: res.items, error: "" }); CommunityStore.markNotificationsSeen(); }
      else onData({ items: [], error: res.error });
    });
    return () => { alive = false; };
  }, [data === null]);

  const items = data ? data.items : null;
  return (
    <>
      <h2 className="cm-list-title">{tr("community.navNotifications")}</h2>
      {data && data.error && <div className="cm-error" role="alert">{data.error}</div>}
      {!items && <RowsSkeleton label={tr("community.loadingNotifications")} />}
      {items && items.length === 0 && !data.error && (
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
            <button type="button" key={n.key} className={"cm-notif" + (n.unread ? " is-unread" : "")} onClick={() => onOpen(n)}>
              <span className="cm-avatar sm" aria-hidden="true"><I.note s={13} /></span>
              <span className="tp-flex1">
                <span className="cm-notif-text">{trx("community.welcomeText", { b: (s) => <b>{s}</b> })}</span>
                <span className="cm-notif-body">{tr("community.welcomeBody")}</span>
                <span className="cm-notif-when">{communityAgo(n.createdAt)}</span>
              </span>
              {n.unread && <span className="cm-notif-dot" role="img" aria-label={tr("community.new")} />}
            </button>
          ) : (
            <button type="button" key={n.key} className={"cm-notif" + (n.unread ? " is-unread" : "")} onClick={() => onOpen(n)}>
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
   under the card: their posts, who follows them, whom they follow. On the DJ's
   own page, "Edit profile" turns the card into the profile form, right here. */
function ProfileCard({ profile, me, tab, onTab, editing, onEdit, onEditDone, onFollowChange, flash }) {
  if (editing && profile.mine) {
    return (
      <section className="cm-profile is-editing" aria-label={tr("community.editProfile")}>
        <h2 className="cm-profile-name">{tr("community.editProfile")}</h2>
        <CommunityProfileForm user={me} autoFocus onSaved={() => onEditDone(true)} onCancel={() => onEditDone(false)} />
      </section>
    );
  }
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
          ? <button type="button" className="tp-btn sm" onClick={onEdit}><I.pencil s={14} /> {tr("community.editProfile")}</button>
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
function PeopleList({ userId, which, onOpen, onFollowChange, flash }) {
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
  const setFollowed = (id, on) => {
    setPeople((cur) => cur.map((p) => (p.id === id ? { ...p, followed: on } : p)));
    onFollowChange(id, on);
  };
  if (!people) return <RowsSkeleton label={tr("community.loadingShort")} />;
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

/* ---------- loading placeholders ---------- */
/* A grey stand-in for a post while the feed loads. */
function PostSkeleton() {
  return (
    <div className="cm-post cm-skel" aria-hidden="true">
      <div className="cm-skel-head"><i className="av" /><div><i className="l1" /><i className="l2" /></div></div>
      <i className="b1" /><i className="b2" /><i className="b3" />
    </div>
  );
}
/* …and for a list of rows (notifications, people). */
function RowsSkeleton({ label, rows = 4 }) {
  return (
    <div className="cm-notifs cm-skel" role="status" aria-label={label}>
      {Array.from({ length: rows }, (_, i) => (
        <div className="cm-skel-row" key={i}><i className="av" /><div className="tp-flex1"><i className="l1" /><i className="l2" /></div></div>
      ))}
    </div>
  );
}

/* ---------- the feed's controls: what to show, which orchestra, what order ---------- */
const CM_SHOW = [
  { id: "all", labelKey: "community.showAll" },
  { id: "ready", labelKey: "community.showCanPlay" },
  { id: "questions", labelKey: "community.showDiscussions" },
];
const CM_SORT = [
  { id: "popular", labelKey: "community.sortPopular" },
  { id: "new", labelKey: "community.sortNew" },
  { id: "liked", labelKey: "community.sortLiked" },
];

function ShowSwitch({ value, onChange }) {
  return (
    <div className="tp-set-seg cm-seg" role="radiogroup" aria-label={tr("community.show")}>
      {CM_SHOW.map((o) => (
        <button type="button" role="radio" key={o.id} aria-checked={value === o.id} className={value === o.id ? "on" : ""}
          onClick={() => onChange(o.id)}>{tr(o.labelKey)}</button>
      ))}
    </div>
  );
}

/* The orchestra: a button that opens a searchable list of the orchestras shared
   so far, most shared first. Arrow keys move through it, Enter picks. */
function OrqPicker({ value, orchestras, onPick }) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [active, setActive] = React.useState(0);
  const wrapRef = React.useRef(null);
  useDismiss(open, wrapRef, () => setOpen(false));
  React.useEffect(() => { if (!open) { setQuery(""); setActive(0); } }, [open]);

  const current = orchestras.find((o) => o.key === value);
  const label = value ? (current ? current.name : value) : tr("community.allOrchestras");
  const q = cmFold(query.trim());
  const options = [{ key: "", name: tr("community.allOrchestras") }].concat(orchestras)
    .filter((o) => !q || (o.key && cmFold(o.name).includes(q)));
  const pick = (key) => { setOpen(false); onPick(key); };
  const onKey = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(options.length - 1, a + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); if (options[active]) pick(options[active].key); }
  };
  return (
    <div className="cm-menu-wrap" ref={wrapRef}>
      <button type="button" className={"cm-filter-btn" + (value ? " on" : "")} aria-haspopup="listbox" aria-expanded={open}
        aria-label={tr("community.orchestraIs", { name: label })} onClick={() => setOpen((v) => !v)}>
        <span className="cm-filter-val">{label}</span>
        <span className="cm-caret" aria-hidden="true"><I.chev s={12} /></span>
      </button>
      {open && (
        <div className="cm-menu cm-pop">
          <label className="cm-menu-search">
            <I.search s={14} />
            <input autoFocus value={query} placeholder={tr("community.searchOrchestras")} aria-label={tr("community.searchOrchestras")}
              onChange={(e) => { setQuery(e.target.value); setActive(0); }} onKeyDown={onKey} />
          </label>
          <div className="cm-menu-list" role="listbox" aria-label={tr("community.orchestra")}>
            {options.map((o, i) => (
              <button type="button" role="option" key={o.key || "all"} aria-selected={o.key === value}
                className={(i === active ? "is-active" : "") + (o.key === value ? " on" : "")}
                onMouseEnter={() => setActive(i)} onClick={() => pick(o.key)}>
                <span className="tp-flex1">{o.name}</span>
                {o.tandas > 0 && <span className="cm-pick-n">{o.tandas}</span>}
              </button>
            ))}
            {options.length === 0 && <div className="cm-tanda-menu-empty">{tr("community.noOrchestraMatches")}</div>}
          </div>
        </div>
      )}
    </div>
  );
}

/* The order: a small menu on the right of the controls. */
function SortMenu({ value, onChange }) {
  const [open, setOpen] = React.useState(false);
  const wrapRef = React.useRef(null);
  useDismiss(open, wrapRef, () => setOpen(false));
  const current = CM_SORT.find((o) => o.id === value) || CM_SORT[0];
  return (
    <div className="cm-menu-wrap" ref={wrapRef}>
      <button type="button" className="cm-filter-btn quiet" aria-haspopup="menu" aria-expanded={open}
        aria-label={tr("community.sortByValue", { name: tr(current.labelKey) })} onClick={() => setOpen((v) => !v)}>
        <span className="cm-filter-val">{tr(current.labelKey)}</span>
        <span className="cm-caret" aria-hidden="true"><I.chev s={12} /></span>
      </button>
      {open && (
        <div className="cm-menu cm-sort-menu" role="menu" aria-label={tr("community.sortBy")}>
          {CM_SORT.map((o) => (
            <button type="button" role="menuitemradio" key={o.id} aria-checked={o.id === value}
              onClick={() => { setOpen(false); onChange(o.id); }}>
              <span className="tp-flex1">{tr(o.labelKey)}</span>
              {o.id === value && <I.check s={13} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------- the composer ----------
   One field, with "Add a tanda" (or the tanda added) and "Post" under it. A
   tanda added shows exactly what will be posted, and the DJ's tags go with it
   only if they say so — the same as the share dialog on a tanda card.
   `pickSignal` opens the list of tandas from elsewhere (the end of the feed,
   the side column). */
function CommunityComposer({ user, pickSignal, flash, onPosted }) {
  const store = useStore();
  const [text, setText] = React.useState("");
  const [attached, setAttached] = React.useState(null);
  const [shared, setShared] = React.useState(null); // what will be posted for `attached`
  const [includeTags, setIncludeTags] = React.useState(true);
  const [picking, setPicking] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [posting, setPosting] = React.useState(false);
  const fieldRef = React.useRef(null);
  const pickRef = React.useRef(null);
  useDismiss(picking, pickRef, () => setPicking(false));
  React.useEffect(() => { if (pickSignal && !attached) setPicking(true); }, [pickSignal]);
  React.useEffect(() => { if (!picking) setQuery(""); }, [picking]);

  // The field is taller while there is something to post.
  const composing = text.length > 0 || !!attached;
  // The DJ's tandas that can be added: not shared yet, and not empty.
  const shareable = (store.tandas || []).filter((t) => !t.sharedPostId && t.songs.length > 0);
  const q = cmFold(query.trim());
  const matches = !q ? shareable : shareable.filter((t) => {
    const m = tandaMeta(t);
    return cmFold([t.name, m.orq, m.singer, genreLabel(m.genre), m.year].join(" ")).includes(q);
  });

  const attach = async (t, tags = includeTags) => {
    setPicking(false);
    // Checked up front, so a tanda that can't be shared says so here.
    const res = await CommunityStore.sharePreview(t.id, tags);
    if (!res.ok) { flash(res.error); return; }
    setAttached(t); setShared(res.tanda);
    // Back to the text field, ready for a few words about it.
    requestAnimationFrame(() => { if (fieldRef.current) fieldRef.current.focus(); });
  };
  const detach = () => { setAttached(null); setShared(null); };
  const setTags = async (on) => {
    setIncludeTags(on);
    if (!attached) return;
    const res = await CommunityStore.sharePreview(attached.id, on);
    if (res.ok) setShared(res.tanda); else flash(res.error);
  };

  // A post is the DJ's words, with one of their tandas added or not: with a
  // tanda it is shared (their words become its note); without, it is just the
  // words (kind "question" in the backend).
  const submit = async (e) => {
    e.preventDefault();
    const words = text.trim();
    if ((!words && !attached) || posting) return;
    setPosting(true);
    const res = attached
      ? await CommunityStore.shareTanda(attached.id, words, includeTags)
      : await CommunityStore.ask(words);
    setPosting(false);
    if (!res.ok) { flash(res.error); return; }
    const wasTanda = !!attached;
    setText(""); detach(); setIncludeTags(true);
    flash(wasTanda ? tr("community.sharedToCommunity") : tr("community.posted"));
    onPosted(wasTanda);
  };

  // The quiet line beside the buttons: what sharing a tanda sends, or (once
  // there are words and no tanda) a nudge that one can be added. Never a gate.
  const hint = attached ? tr("community.composeHintTanda")
    : text.trim() && shareable.length > 0 ? tr("community.composeHintAdd") : "";
  const hasTags = !!(attached && attached.tags && attached.tags.length);

  return (
    <form className={"cm-composer" + (composing ? " is-open" : "")} onSubmit={submit}>
      <CommunityAvatar id={user.id} avatar={user.avatar} />
      <div className="cm-composer-main">
        <textarea ref={fieldRef} className="cm-input cm-textarea cm-composer-input" rows={composing ? 3 : 1} maxLength={CM_NOTE_MAX}
          aria-label={tr("community.writePost")} placeholder={tr("community.writePostPh")}
          value={text} onChange={(e) => setText(e.target.value)} />
        {attached && shared && (
          <div className="cm-compose-preview">
            <div className="cm-compose-preview-head">
              <span>{tr("community.composePreviewTitle")}</span>
              {hasTags && (
                <label className="cm-check sm">
                  <input type="checkbox" checked={includeTags} onChange={(e) => setTags(e.target.checked)} />
                  {tr("community.includeTags")}
                </label>
              )}
            </div>
            <ol className="cm-compose-songs">
              {shared.songs.map((s, i) => (
                <li key={i}>
                  <span className="t">{s.title}</span>
                  <span className="m">{[s.orq, s.singer, s.year].filter(Boolean).join(" · ")}</span>
                </li>
              ))}
            </ol>
            {shared.tags.length > 0 && <TagPills tags={shared.tags} />}
          </div>
        )}
        {/* One slot, two states: the button to add a tanda, or the tanda that
            was added. "Post" is always there, so it is plain that words alone
            can be posted. */}
        <div className="cm-ask-actions">
          {attached ? (
            <span className="cm-attached">
              <span className="acc"><I.note s={15} /></span>
              <b>{attached.name || tandaMeta(attached).orq}</b>
              <span className="n">{tr("community.songs", { count: attached.songs.length })}</span>
              <button type="button" className="cm-attached-x" onClick={detach}
                aria-label={tr("community.removeTanda")} title={tr("community.removeTanda")}><I.x s={13} /></button>
            </span>
          ) : (
            <div className="cm-menu-wrap" ref={pickRef}>
              <button type="button" className="cm-composer-btn" aria-haspopup="menu" aria-expanded={picking}
                onClick={() => setPicking((v) => !v)}>
                <span className="acc"><I.note s={16} /></span> {tr("community.addTanda")}
              </button>
              {picking && (
                <div className="cm-menu cm-tanda-menu cm-pop">
                  {shareable.length > 0 && (
                    <label className="cm-menu-search">
                      <I.search s={14} />
                      <input autoFocus value={query} placeholder={tr("community.searchTandas")} aria-label={tr("community.searchTandas")}
                        onChange={(e) => setQuery(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (matches[0]) attach(matches[0]); } }} />
                    </label>
                  )}
                  <div className="cm-menu-list" role="menu" aria-label={tr("community.yourTandas")}>
                    {matches.map((t) => {
                      const m = tandaMeta(t);
                      return (
                        <button type="button" role="menuitem" key={t.id} onClick={() => attach(t)}>
                          <span className="tp-flex1">
                            <span className="cm-pick-name">{t.name || m.orq}</span>
                            <span className="cm-pick-sub">{[t.name ? m.orq : null, m.singer || null, genreLabel(m.genre), m.year || null].filter(Boolean).join(" · ")}</span>
                          </span>
                          <span className="cm-pick-n">{tr("community.songs", { count: t.songs.length })}</span>
                        </button>
                      );
                    })}
                  </div>
                  {shareable.length === 0 && (
                    <div className="cm-tanda-menu-empty">
                      {(store.tandas || []).length ? tr("community.allShared") : tr("community.noTandas")}
                    </div>
                  )}
                  {shareable.length > 0 && matches.length === 0 && (
                    <div className="cm-tanda-menu-empty">{tr("community.noTandaMatches")}</div>
                  )}
                </div>
              )}
            </div>
          )}
          {hint && <span className="cm-compose-hint">{hint}</span>}
          <button type="submit" className="tp-btn primary sm" disabled={posting || (!text.trim() && !attached)}>
            {posting ? tr("community.posting") : tr("community.post")}
          </button>
        </div>
      </div>
    </form>
  );
}

/* ---------- the side column ----------
   What there is to do next: share a tanda not shared yet, follow DJs whose
   posts turn up, and the orchestras in the feed. Hidden on narrow windows. */
function CommunitySide({ unshared, onShare, suggestions, onOpenProfile, onFollowChange, orchestras, activeOrq, onPickOrq, flash }) {
  if (!unshared && !suggestions.length && !orchestras.length) return null;
  return (
    <aside className="cm-side" aria-label={tr("community.sideLabel")}>
      {unshared > 0 && (
        <section className="cm-side-card cm-side-share">
          <div className="cm-side-share-ic"><I.upload s={16} /></div>
          <div className="tp-flex1">
            <div className="cm-side-share-text">{tr("community.sideUnshared", { count: unshared })}</div>
            <button type="button" className="tp-btn sm" onClick={onShare}>{tr("community.shareOne")}</button>
          </div>
        </section>
      )}
      {suggestions.length > 0 && (
        <section className="cm-side-card">
          <h3 className="cm-side-title">{tr("community.djsToFollow")}</h3>
          <div className="cm-side-people">
            {suggestions.map((p) => (
              <div className="cm-side-person" key={p.id}>
                <button type="button" className="cm-person-main" onClick={() => onOpenProfile(p.id)}>
                  <CommunityAvatar id={p.id} avatar={p.avatar} size="sm" />
                  <span className="tp-flex1">
                    <span className="cm-person-name">{p.name}</span>
                    {p.city && <span className="cm-person-sub">{p.city}</span>}
                  </span>
                </button>
                <FollowButton person={p} onChange={(on) => onFollowChange(p.id, on)} flash={flash} />
              </div>
            ))}
          </div>
        </section>
      )}
      {orchestras.length > 0 && (
        <section className="cm-side-card">
          <h3 className="cm-side-title">{tr("community.orchestrasInFeed")}</h3>
          <div className="cm-side-orqs">
            {orchestras.slice(0, 14).map((o) => (
              <button type="button" key={o.key} className={"cm-orq-chip" + (activeOrq === o.key ? " on" : "")}
                aria-pressed={activeOrq === o.key} title={tr("community.showOnlyOrq", { name: o.name })}
                onClick={() => onPickOrq(activeOrq === o.key ? "" : o.key)}>
                {o.name}{o.tandas > 0 && <span className="n">{o.tandas}</span>}
              </button>
            ))}
          </div>
        </section>
      )}
    </aside>
  );
}

/* ---------- the feed ---------- */
const CM_SCOPES = [
  { id: "all", labelKey: "community.navFeed", icon: "home" },
  { id: "following", labelKey: "community.navFollowing", icon: "users" },
  { id: "saved", labelKey: "community.navSaved", icon: "bookmark" },
  { id: "notifications", labelKey: "community.navNotifications", icon: "bell" },
];
// What an empty result means, per "Show" choice and per list.
const CM_EMPTY_SHOW = {
  ready: { titleKey: "community.emptyReadyTitle", subKey: "community.emptyReadySub" },
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

// How often an open feed asks whether anything new has been posted.
const CM_NEW_POSTS_POLL_MS = 60000;
// How many DJs the side column suggests following.
const CM_SUGGESTIONS = 4;

/* Where the Community tab is, as a trail of places. The rail starts a fresh
   trail; opening a DJ's page or a post steps into it, and Back steps out again
   to exactly where the DJ was. A place is one of
     {kind: "list", scope, show, orq}   the feed, Following, Saved
     {kind: "profile", id, tab}         a DJ's page
     {kind: "post", id}                 one post (from a notification)
     {kind: "notifications"} */
const CM_HOME = { kind: "list", scope: "all", show: "all", orq: "" };
// The posts a place lists, as a cache key (null: it lists no posts) and as a
// feed query.
function cmPlaceKey(v, sort) {
  if (v.kind === "list") return ["list", v.scope, v.show, v.orq, sort].join(":");
  if (v.kind === "profile") return v.tab === "posts" ? "author:" + v.id : null;
  if (v.kind === "post") return "post:" + v.id;
  return null;
}
function cmPlaceQuery(v, sort) {
  if (v.kind === "list") return { scope: v.scope, show: v.show, sort, orq: v.orq || null };
  if (v.kind === "profile") return { scope: "all", sort: "new", author: v.id };
  return { scope: "all", postId: v.id };
}
const CM_NO_LIST = { key: null, posts: [], hasMore: false, nextOffset: 0 };

function CommunityFeed({ user, homeSignal, active }) {
  const community = useCommunity();
  const store = useStore();
  const { toast, flash, dismiss } = useToast();
  const { ask, modal } = useConfirm();

  const [trail, setTrail] = React.useState([CM_HOME]);
  const place = trail[trail.length - 1];
  const below = trail.length > 1 ? trail[trail.length - 2] : null;
  const [sort, setSort] = React.useState("popular");
  const key = cmPlaceKey(place, sort);

  // The posts on screen belong to one place (`list.key`); while another place
  // loads, none are shown rather than the last place's.
  const [list, setList] = React.useState(CM_NO_LIST);
  const posts = list.key === key ? list.posts : [];
  const hasMore = list.key === key && list.hasMore;
  const [loading, setLoading] = React.useState(false);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [error, setError] = React.useState("");
  const pending = !!key && (loading || (list.key !== key && !error));
  const request = React.useRef(0);
  const scrollRef = React.useRef(null);
  const sentinelRef = React.useRef(null);
  // Places already seen on this trail, with how far down the DJ was, so Back is
  // instant and lands on the same post. `skipLoad` is the place Back has just
  // put back on screen from here.
  const cache = React.useRef(new Map());
  const skipLoad = React.useRef(null);
  // Where to scroll once the next render is on screen (null: stay).
  const scrollTarget = React.useRef(null);
  React.useLayoutEffect(() => {
    if (scrollTarget.current == null || !scrollRef.current) return;
    scrollRef.current.scrollTop = scrollTarget.current;
    scrollTarget.current = null;
  });
  // Posts whose conversation is open.
  const [openThreads, setOpenThreads] = React.useState(() => new Set());
  const expand = (id) => setOpenThreads((s) => (s.has(id) ? s : new Set(s).add(id)));

  const [orchestras, setOrchestras] = React.useState([]);
  // The notifications, once fetched for this visit (null: fetch them).
  const [notifs, setNotifs] = React.useState(null);
  // The DJ whose page is open: their card once loaded (null while loading;
  // false if there is no such DJ), and whether the DJ is editing their own.
  const profileId = place.kind === "profile" ? place.id : null;
  const profiles = React.useRef(new Map());
  const [profile, setProfile] = React.useState(null);
  const [profileTick, setProfileTick] = React.useState(0);
  const [editingProfile, setEditingProfile] = React.useState(false);
  // Opens the composer's list of tandas (a counter, 0 until first used).
  const [pickSignal, setPickSignal] = React.useState(0);
  // The one-line explanation of the library check, shown until dismissed.
  const [hintSeen, setHintSeen] = React.useState(() => {
    try { return localStorage.getItem("compas.communityHintSeen") === "1"; } catch (e) { return true; }
  });
  const dismissHint = () => {
    try { localStorage.setItem("compas.communityHintSeen", "1"); } catch (e) { /* ignore */ }
    setHintSeen(true);
  };
  // When the newest post was made as of the last load, and whether something
  // newer has turned up since (the "New posts" pill).
  const newestSeen = React.useRef(null);
  const [hasNew, setHasNew] = React.useState(false);

  /* -- moving around -- */
  const remember = () => {
    if (list.key && list.key === key) {
      cache.current.set(key, { list, scrollTop: scrollRef.current ? scrollRef.current.scrollTop : 0 });
    }
  };
  const toTop = () => { scrollTarget.current = 0; };
  // Start a fresh trail (the rail, the top bar)…
  const start = (next) => { cache.current.clear(); toTop(); setEditingProfile(false); setTrail([next]); };
  // …step into a place (Back returns here)…
  const push = (next) => { remember(); toTop(); setEditingProfile(false); setTrail((t) => t.concat(next)); };
  // …or change this one in place (a filter, a tab).
  const update = (patch) => { toTop(); setTrail((t) => t.slice(0, -1).concat({ ...t[t.length - 1], ...patch })); };
  const back = () => {
    if (!below) return;
    remember();
    // The place below comes back as it was left, in the same render, so there
    // is no flash of placeholders on the way.
    const k = cmPlaceKey(below, sort);
    const kept = k ? cache.current.get(k) : null;
    if (kept) {
      request.current++;
      skipLoad.current = k;
      setList(kept.list); setLoading(false); setError("");
      scrollTarget.current = kept.scrollTop;
    } else toTop();
    setEditingProfile(false);
    setTrail((t) => t.slice(0, -1));
  };

  /* -- loading -- */
  const load = async (p, s) => {
    const k = cmPlaceKey(p, s);
    const mine = ++request.current;
    setLoading(true); setError("");
    const res = await CommunityStore.feed(cmPlaceQuery(p, s));
    if (mine !== request.current) return; // a newer load superseded this one
    setLoading(false);
    if (res.ok) setList({ key: k, posts: res.posts, hasMore: res.hasMore, nextOffset: res.nextOffset });
    else setError(res.error);
    if (p.kind !== "list") return;
    // Whatever was newest at this moment has now been seen.
    setHasNew(false);
    const latest = await CommunityStore.latest();
    if (mine === request.current && latest.ok) newestSeen.current = latest.latestAt;
  };
  const loadOrchestras = () => CommunityStore.orchestras().then((res) => { if (res.ok) setOrchestras(res.orchestras); });
  const reload = () => {
    if (key) load(place, sort);
    if (place.kind === "notifications") setNotifs(null);
    if (place.kind === "profile") setProfileTick((n) => n + 1);
    if (place.kind === "list") loadOrchestras();
  };

  // Load whenever the place changes — unless Back just put it back — and again
  // when something was shared or removed elsewhere, or the library changed
  // (the matching depends on it); then nothing kept is current any more.
  const librarySize = (store.songs || []).length;
  const env = community.feedVersion + "|" + librarySize + "|" + user.id;
  const lastEnv = React.useRef(env);
  React.useEffect(() => {
    if (lastEnv.current !== env) { lastEnv.current = env; cache.current.clear(); skipLoad.current = null; }
    if (skipLoad.current && skipLoad.current === key) { skipLoad.current = null; return; }
    skipLoad.current = null;
    if (key) load(place, sort);
    else { request.current++; setLoading(false); setError(""); }
  }, [key, env]);
  React.useEffect(() => { loadOrchestras(); }, [env]);

  // Another account signed in on this computer: start over.
  const lastUser = React.useRef(user.id);
  React.useEffect(() => {
    if (lastUser.current === user.id) return;
    lastUser.current = user.id;
    profiles.current.clear();
    setNotifs(null); setOpenThreads(new Set());
    start(CM_HOME);
  }, [user.id]);

  // The card of the DJ whose page is open: the one already seen at once, and
  // a fresh copy as soon as it arrives.
  React.useEffect(() => {
    if (!profileId) { setProfile(null); return undefined; }
    let alive = true;
    setProfile(profiles.current.has(profileId) ? profiles.current.get(profileId) : null);
    CommunityStore.profile(profileId).then((res) => {
      if (!alive) return;
      if (res.ok) { profiles.current.set(profileId, res.profile || false); setProfile(res.profile || false); }
      else { setProfile((p) => p || false); flash(res.error); }
    });
    return () => { alive = false; };
  }, [profileId, user.id, profileTick]);

  const openProfile = (id) => {
    if (place.kind === "profile" && place.id === id) { update({ tab: "posts" }); return; }
    push({ kind: "profile", id, tab: "posts" });
  };
  const openOwnPage = () => start({ kind: "profile", id: user.id, tab: "posts" });

  // A rail item: a fresh trail there. Already there, the click refreshes and
  // goes back to the top.
  const goScope = (id) => {
    if (id === "notifications") { setNotifs(null); start({ kind: "notifications" }); return; }
    const atRoot = trail.length === 1 && place.kind === "list" && place.scope === id && place.show === "all" && !place.orq;
    if (atRoot) { toTop(); reload(); return; }
    start({ kind: "list", scope: id, show: "all", orq: "" });
  };

  // The bell in the top bar was clicked: show the notifications. (Both signals
  // are counters; a click from before this feed was on screen doesn't count.)
  const bellSeen = React.useRef(community.openNotifications);
  React.useEffect(() => {
    if (community.openNotifications === bellSeen.current) return;
    bellSeen.current = community.openNotifications;
    setNotifs(null);
    start({ kind: "notifications" });
  }, [community.openNotifications]);
  // The top bar's Community tab was clicked: back to the general feed, showing
  // everything, at the top.
  const homeSeen = React.useRef(homeSignal);
  React.useEffect(() => {
    if (homeSignal === homeSeen.current) return;
    homeSeen.current = homeSignal;
    goScope("all");
  }, [homeSignal]);

  const loadMore = async () => {
    if (loadingMore || list.key !== key) return;
    // Every new list (another place, filter, order…) bumps `request`; a page
    // that arrives after that belongs to the old list and is dropped.
    const mine = request.current, k = key;
    setLoadingMore(true);
    const res = await CommunityStore.feed({ ...cmPlaceQuery(place, sort), offset: list.nextOffset });
    setLoadingMore(false);
    if (mine !== request.current) return;
    if (res.ok) {
      setList((l) => (l.key !== k ? l : {
        ...l,
        posts: l.posts.concat(res.posts.filter((p) => !l.posts.some((c) => c.id === p.id))),
        hasMore: res.hasMore, nextOffset: res.nextOffset,
      }));
    } else flash(res.error);
  };

  // Older posts load by themselves as the end of the list comes near.
  const loadMoreNow = React.useRef(loadMore);
  loadMoreNow.current = loadMore;
  React.useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore || pending) return undefined;
    const io = new IntersectionObserver(
      (entries) => { if (entries.some((e) => e.isIntersecting)) loadMoreNow.current(); },
      { root: scrollRef.current, rootMargin: "600px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, pending, posts.length, key]);

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
  const showNew = () => { toTop(); reload(); };

  // An orchestra (from the picker, a post, or the side column) narrows a list
  // to its tandas; discussions have no orchestra, so "Show" steps off them.
  // Anywhere else, it opens the feed narrowed to it, one step further on.
  const pickOrq = (orq) => {
    if (place.kind === "list") update({ orq, show: orq && place.show === "questions" ? "all" : place.show });
    else push({ ...CM_HOME, orq });
  };

  // A post changed (a like, a comment…) or went away: here, and in every list
  // kept for Back, so it is the same wherever the DJ meets it again.
  const editKept = (fn) => {
    for (const [k, kept] of cache.current) cache.current.set(k, { ...kept, list: { ...kept.list, posts: fn(kept.list.posts) } });
  };
  const changePost = (id, fn) => {
    const apply = (ps) => ps.map((p) => (p.id === id ? fn(p) : p));
    setList((l) => ({ ...l, posts: apply(l.posts) }));
    editKept(apply);
  };
  const removePost = (id) => {
    const drop = (ps) => ps.filter((p) => p.id !== id);
    setList((l) => ({ ...l, posts: drop(l.posts) }));
    editKept(drop);
  };
  // Blocking someone takes them out of everything, kept lists included.
  const reloadAll = () => { cache.current.clear(); reload(); };

  // Sharing from anywhere: the composer on the feed, with its tandas listed.
  const startShare = () => {
    if (!(trail.length === 1 && place.kind === "list" && place.scope === "all")) start(CM_HOME);
    else toTop();
    setPickSignal((n) => n + 1);
  };
  // Sharing a tanda refreshes the feed by itself; plain words need a nudge.
  const onPosted = (wasTanda) => { if (!wasTanda) reload(); };

  // Notifications: a row leads to its post (or the DJ who followed), and is no
  // longer new once opened.
  const openNotif = (n) => {
    if (n.unread) setNotifs((d) => (d ? { ...d, items: d.items.map((x) => (x.key === n.key ? { ...x, unread: false } : x)) } : d));
    if (n.kind === "welcome") start(CM_HOME);
    else if (n.kind === "follow") push({ kind: "profile", id: n.actor.id, tab: "posts" });
    else push({ kind: "post", id: n.postId });
  };

  // Saving one's own profile in place: the card, the rail and one's posts
  // all show the new details.
  const editDone = (saved) => {
    setEditingProfile(false);
    if (!saved) return;
    flash(tr("community.profileUpdated"));
    profiles.current.delete(user.id);
    setProfileTick((n) => n + 1);
    cache.current.clear();
    if (key) load(place, sort);
  };

  /* -- who to follow: DJs whose posts this DJ has seen, and doesn't follow -- */
  const [following, setFollowing] = React.useState(null); // {before: Set, now: Set} | null
  React.useEffect(() => {
    let alive = true;
    setFollowing(null);
    (async () => {
      const ids = new Set();
      let offset = 0;
      for (let page = 0; page < 5; page++) {
        const res = await CommunityStore.follows(user.id, "following", offset);
        if (!alive || !res.ok) return;
        res.people.forEach((p) => ids.add(p.id));
        if (!res.hasMore) break;
        offset = res.nextOffset;
      }
      if (alive) setFollowing({ before: ids, now: new Set(ids) });
    })();
    return () => { alive = false; };
  }, [user.id]);
  const followChanged = (id, on) => setFollowing((f) => {
    if (!f) return f;
    const now = new Set(f.now);
    if (on) now.add(id); else now.delete(id);
    return { ...f, now };
  });
  // Authors of the posts loaded so far, with how many of their posts were seen.
  const authors = React.useRef(new Map());
  const [authorsTick, setAuthorsTick] = React.useState(0);
  React.useEffect(() => {
    let changed = false;
    for (const p of list.posts) {
      if (p.author.id === user.id) continue;
      const seen = authors.current.get(p.author.id) || { person: p.author, posts: new Set() };
      if (!seen.posts.has(p.id)) { seen.posts.add(p.id); changed = true; }
      seen.person = p.author;
      authors.current.set(p.author.id, seen);
    }
    if (changed) setAuthorsTick((n) => n + 1);
  }, [list.posts]);
  const suggestions = React.useMemo(() => {
    if (!following) return [];
    return [...authors.current.values()]
      .filter((a) => !following.before.has(a.person.id) && a.person.id !== profileId)
      .sort((a, b) => b.posts.size - a.posts.size)
      .slice(0, CM_SUGGESTIONS)
      .map((a) => ({ ...a.person, followed: following.now.has(a.person.id), mine: false }));
  }, [following, authorsTick, profileId]);

  // Song-id signatures of the DJ's own tandas, to tell "already in your tandas".
  const tandaSigs = React.useMemo(
    () => new Set((store.tandas || []).map((t) => t.songs.map((s) => s.id).slice().sort().join(","))),
    [store.tandas],
  );
  const unshared = (store.tandas || []).filter((t) => !t.sharedPostId && t.songs.length > 0).length;

  const onHome = place.kind === "list" && place.scope === "all";
  const onOwnPage = place.kind === "profile" && place.id === user.id;
  const sub = [user.handle ? "@" + user.handle : null, user.city].filter(Boolean).join(" · ");
  const backLabel = below && below.kind === "notifications" ? tr("community.backToNotifications") : tr("community.back");
  const emptyOf = (e) => ({ title: tr(e.titleKey), sub: tr(e.subKey) });
  const orqName = place.orq ? ((orchestras.find((o) => o.key === place.orq) || {}).name || "") : "";
  const empty = place.kind === "post" ? emptyOf(CM_EMPTY_POST_GONE)
    : place.kind === "profile" ? emptyOf(profile && profile.mine ? CM_EMPTY.mine : CM_EMPTY_PROFILE)
    : place.orq ? { title: orqName ? tr("community.emptyOrqTitle", { name: orqName }) : tr("community.emptyOrqTitleAny"), sub: tr("community.emptyOrqSub") }
    : CM_EMPTY_SHOW[place.show] ? emptyOf(CM_EMPTY_SHOW[place.show])
    : emptyOf(CM_EMPTY[place.scope] || CM_EMPTY.all);
  const showPosts = !!key && !(place.kind === "profile" && !profile);
  return (
    <div className="tv">
      <div className="cm-scroll" ref={scrollRef}>
        <div className="cm-feed">
          {/* left rail: who you are (your page), and the lists */}
          <aside className="cm-rail">
            <button type="button" className={"cm-me cm-me-btn" + (onOwnPage ? " on" : "")} onClick={openOwnPage}
              aria-current={onOwnPage && trail.length === 1 ? "page" : undefined} title={tr("community.yourPage")}>
              <CommunityAvatar id={user.id} avatar={user.avatar} />
              <div className="tp-flex1">
                <div className="cm-me-name">{user.displayName || user.email || tr("community.signedIn")}</div>
                {sub && <div className="cm-me-sub">{sub}</div>}
              </div>
            </button>
            <nav className="cm-nav" aria-label={tr("common.nav.Community")}>
              {CM_SCOPES.map((s) => {
                const Icon = I[s.icon];
                const on = trail.length === 1 && (s.id === "notifications" ? place.kind === "notifications" : place.kind === "list" && place.scope === s.id);
                return (
                  <button type="button" key={s.id} className={"cm-nav-item" + (on ? " on" : "")}
                    aria-current={on ? "page" : undefined} onClick={() => goScope(s.id)}>
                    <Icon s={17} /> {tr(s.labelKey)}
                    {s.id === "notifications" && community.unread > 0 && <span className="cm-nav-n">{community.unread > 9 ? "9+" : community.unread}</span>}
                  </button>
                );
              })}
            </nav>
          </aside>

          {/* the column */}
          <main className="cm-col">
            {!user.handle && (
              <div className="cm-error" role="alert">{tr("community.profileNotLoaded")}</div>
            )}

            {/* Posting belongs to the feed. The composer stays mounted while
                elsewhere, so a half-written post is still there on return. */}
            <div className="cm-composer-slot" hidden={!onHome}>
              <CommunityComposer user={user} pickSignal={pickSignal} flash={flash} onPosted={onPosted} />
            </div>

            {place.kind === "list" && hasNew && (
              <button type="button" className="cm-newpill" onClick={showNew}>
                <I.arrowDn s={14} /> {tr("community.newPosts")}
              </button>
            )}

            {place.kind === "list" && (
              <div className="cm-filters">
                <ShowSwitch value={place.show}
                  onChange={(show) => update({ show, orq: show === "questions" ? "" : place.orq })} />
                {place.show !== "questions" && (orchestras.length > 0 || place.orq) && (
                  <OrqPicker value={place.orq} orchestras={orchestras} onPick={pickOrq} />
                )}
                <span className="tp-spacer" />
                <SortMenu value={sort} onChange={(s) => { toTop(); setSort(s); }} />
                <button type="button" className="tv-tcbtn del cm-refresh" aria-label={tr("community.refresh")} title={tr("community.refresh")}
                  onClick={reload} disabled={loading}><I.refresh s={15} /></button>
              </div>
            )}

            {place.kind === "list" && librarySize === 0 && (
              <div className="cm-hint">
                <I.folder s={15} />
                <span className="tp-flex1">{tr("community.importHint")}</span>
                <button type="button" className="cm-link" onClick={() => navigateTo("Library")}>{tr("community.goToLibrary")}</button>
              </div>
            )}
            {place.kind === "list" && librarySize > 0 && !hintSeen && (
              <div className="cm-hint">
                <span className="ok"><I.check s={15} /></span>
                <span className="tp-flex1">{tr("community.matchHint")}</span>
                <button type="button" className="cm-link" onClick={dismissHint}>{tr("community.gotIt")}</button>
              </div>
            )}

            {(place.kind === "profile" || place.kind === "post") && below && (
              <button type="button" className="tp-btn sm cm-back" onClick={back}>
                <I.chev s={14} /> {backLabel}
              </button>
            )}

            {place.kind === "notifications" && (
              <NotificationsList data={notifs} onData={setNotifs} onOpen={openNotif} />
            )}
            {place.kind === "profile" && (
              <>
                {profile === null && <div className="cm-skels" role="status" aria-label={tr("community.loadingProfile")}><PostSkeleton /></div>}
                {profile === false && (
                  <div className="cm-empty">
                    <div className="cm-empty-title">{tr("community.djGoneTitle")}</div>
                    <div className="cm-empty-sub">{tr("community.djGoneSub")}</div>
                  </div>
                )}
                {profile && (
                  <ProfileCard profile={profile} me={user} tab={place.tab} onTab={(tab) => update({ tab })}
                    editing={editingProfile} onEdit={() => setEditingProfile(true)} onEditDone={editDone} flash={flash}
                    onFollowChange={(on) => {
                      followChanged(profile.id, on);
                      const next = { ...profile, followed: on, followers: Math.max(0, profile.followers + (on ? 1 : -1)) };
                      profiles.current.set(profile.id, next);
                      setProfile(next);
                    }} />
                )}
                {profile && place.tab !== "posts" && (
                  <PeopleList userId={profile.id} which={place.tab} onOpen={openProfile} onFollowChange={followChanged} flash={flash} />
                )}
              </>
            )}

            {error && (
              <div className="cm-error" role="alert">
                {error} <button type="button" className="cm-link" onClick={reload}>{tr("community.tryAgain")}</button>
              </div>
            )}

            {showPosts && posts.map((p) => (
              <CommunityPost key={p.id} post={p} me={user} tandaSigs={tandaSigs}
                expanded={place.kind === "post" || openThreads.has(p.id)} onExpand={expand}
                onChange={changePost} onRemove={removePost} onReload={reloadAll} onPickOrq={pickOrq}
                onOpenProfile={openProfile} flash={flash} ask={ask} />
            ))}

            {showPosts && !pending && !error && posts.length === 0 && (
              <div className="cm-empty">
                <div className="cm-empty-ic"><I.note s={20} /></div>
                <div className="cm-empty-title">{empty.title}</div>
                <div className="cm-empty-sub">{empty.sub}</div>
                {place.kind === "list" && (place.show !== "all" || place.orq) && (
                  <button type="button" className="tp-btn sm cm-empty-btn" onClick={() => update({ show: "all", orq: "" })}>{tr("community.showEverything")}</button>
                )}
                {onOwnPage && (
                  <button type="button" className="tp-btn sm cm-empty-btn" onClick={startShare}><I.note s={14} /> {tr("community.shareATanda")}</button>
                )}
              </div>
            )}
            {showPosts && pending && posts.length === 0 && (
              <div role="status" aria-label={tr("community.loadingFeed")} className="cm-skels">
                <PostSkeleton />{place.kind !== "post" && <><PostSkeleton /><PostSkeleton /></>}
              </div>
            )}

            {loadingMore && <div className="cm-skels" aria-hidden="true"><PostSkeleton /><PostSkeleton /></div>}
            {hasMore && !pending && <div ref={sentinelRef} className="cm-sentinel" />}
            {/* The end of the feed is an invitation, not a dead end. */}
            {onHome && !hasMore && !pending && !error && posts.length > 0 && (
              <div className="cm-end">
                <div className="cm-end-title">{tr("community.endTitle")}</div>
                <div>{tr("community.endText")}</div>
                <button type="button" className="tp-btn sm" onClick={startShare}><I.note s={14} /> {tr("community.shareATanda")}</button>
              </div>
            )}
          </main>

          <CommunitySide unshared={unshared} onShare={startShare}
            suggestions={suggestions} onOpenProfile={openProfile} onFollowChange={followChanged}
            orchestras={orchestras} activeOrq={place.kind === "list" ? place.orq : ""} onPickOrq={pickOrq} flash={flash} />
        </div>
      </div>

      <Toast toast={toast} onDismiss={dismiss} />
      {modal}
    </div>
  );
}

Object.assign(window, { CommunityFeed });
