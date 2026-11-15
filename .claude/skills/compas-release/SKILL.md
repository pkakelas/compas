---
name: compas-release
description: Cut a Compás release from origin/main — draft the in-app "What's new" changelog from the commits since the last tag, agree it with the user, then bump the version, push the bump to main and push the tag that triggers the Release and Store package workflows. Use when the user asks to release, ship, cut or publish a new Compás version, or to bump the version.
---

# Releasing Compás

A release is a single commit on `main` titled `Bump to X.Y.Z`, carrying the
`package.json` version and that version's changelog entry, plus a lightweight
tag `vX.Y.Z` on it. Pushing the tag starts two workflows:

- **Release** (`.github/workflows/release.yml`) builds macOS, Windows and Linux
  and publishes them to `pkakelas/compas-releases`, where the auto-updater
  picks them up.
- **Store package** (`.github/workflows/store-package.yml`) builds and submits
  the Microsoft Store package.

Once the tag is pushed, every installed copy starts updating. Nothing is
pushed until the user has agreed to the changelog and the version (step 4).

## 1. Prepare a clean copy of main

Never release from the session's own branch or a working tree with edits. Use
a throwaway worktree at `origin/main`:

```bash
git fetch origin --tags
REL=$(mktemp -d)/compas-release
git worktree add --detach "$REL" origin/main
```

Do everything below inside `$REL`. Then check:

- `packages/renderer/js/whats-new.jsx` exists. If it doesn't, the "What's
  new" feature hasn't been merged to main yet. Stop and tell the user.
- The last release is `LAST=$(git describe --tags --abbrev=0 origin/main)`,
  and `package.json`'s version equals `${LAST#v}`. If they differ, stop and
  ask; someone may have bumped by hand.
- `git log --oneline $LAST..origin/main` is not empty. If it is, there is
  nothing to release. Say so and stop.

## 2. Read what changed

```bash
git log $LAST..origin/main --no-merges --format='--- %h %s%n%b'
```

The commit bodies say what changed and why. For a commit whose subject alone
is unclear, read its diff (`git show --stat <sha>`, then the relevant hunks).
Don't guess.

## 3. Draft the changelog

Only DJs read this changelog, inside the app, the first time the new version
opens. Write for them, not for developers.

**Keep** changes a DJ would notice: new features, changed behaviour, fixed
bugs they could have hit, new formats or platforms.
**Leave out** CI and workflow changes, build and packaging internals, README
and license edits, refactors, tests, and Store or signing plumbing. Leave out
anything a DJ can't see.

**Merge** related commits into one item. For example, "Add a Linux build" +
"Build a .deb alongside the AppImage" become one "Compás on Linux".
**Order** the items by how much a DJ will care, biggest first.
**Aim for 2–6 items.** More is allowed (the list scrolls), but trim to what
matters. If nothing qualifies, propose a quiet release with no entry: the
version opens with no dialog.

Each item is one of:

- a **plain string**, for a small change: `"Plays Apple Lossless .m4a files"`
- **`{ icon, title, text }`**, for a change worth one sentence of explanation.
  - `title`: short, sentence case, no full stop. Bug fixes may start with
    "Fixed", for example "Fixed skipped songs bug".
  - `text`: one or two plain sentences ending in a full stop, saying what to
    do or what's different. `text` is optional.
  - `icon`: a name from the `I` set in `packages/renderer/js/shared.jsx`, for
    example `vol`, `tag`, `download`, `skip`, `drag`, `pencil`, `lock`,
    `folder`, `note`, `headphones`, `search` or `spark`. Leave it out for the
    default sparkle.

Style:
- English only.
- Use curly quotes and apostrophes (’ “ ”), as the rest of the app does.
- Use "Compás" with the accent.
- Tango words (tanda, cortina, milonga, vals) stay as they are.
- No exclamation marks or marketing tone.

Also propose the **version**: by default a patch bump of `LAST`
(0.1.21 → 0.1.22). Suggest a minor bump only if the user asks for one or the
release is unusually large.

## 4. Have the user review the changelog

The user must read the changelog before anything is released. This is a stop
in the conversation, not a formality: end your turn with the draft and wait.

Make the **full draft the main body of your message**, one item per entry,
each with its title, its text and its icon, in this shape:

> **Compás 0.1.22**: proposed "What's new"
>
> 1. **Edit a queued tanda during the set** *(icon: drag)*
>    In the Live queue, drag a tanda’s songs to reorder them, drop a library song in to add it, or remove one.
>
> 2. **Fixed skipped songs bug** *(icon: skip)*
>    Cortina fades, Prev and Play from a stop now pass over songs marked skip.
>
> 3. Plays Apple Lossless .m4a files
>
> **Left out:**
> - the Linux test-build workflow (CI only);
> - the README rewrite and MIT license.
>
> Commits covered: `abc1234`…`def5678` (9 commits since v0.1.21).

Then, in the same message, ask in plain text whether this draft is good to
release as that version, or what to change. Rules for asking:

- **No buttons.** Don't use a wrap-up question with actions, AskUserQuestion
  or any other one-click answer. A button can be clicked without the draft
  having been read, and that already happened once.
- **Don't summarise.** Don't shorten the draft to a recap or a count of
  items, and don't put it only in a file or a pane. The user should be able
  to review it in the message itself.
- **Approval must come after the draft.** It has to be a reply to a message
  that showed this exact draft. "Release" said before the draft was shown,
  or about an earlier draft, doesn't count.

When the user asks for changes, apply them and show the **whole** draft again,
not just the changed line, and ask again. Use the user's wording for titles
they name. Only adjust the tense so it doesn't read as an instruction (for
example, "Fix skipped songs bug" becomes "Fixed skipped songs bug"), and say
that you did.

Go on to step 5 only when the user approves the latest full draft and the
version. That approval is the go-ahead to push to main and to tag. Until
then, write nothing in `$REL`.

## 5. Write the bump

In `$REL`:

1. In `packages/renderer/js/whats-new.jsx`, add the new entry as the **first**
   element of `const CHANGELOG = [` (below the commented example, above any
   older entries). Use the agreed text exactly. Match the existing
   formatting: two-space indent and double quotes. If an entry for this
   version already exists, replace it.
2. Set `"version"` in `package.json` to the new version. Change nothing else
   in that file.
3. Run the check. Fix and re-run until it passes:
   ```bash
   node .claude/skills/compas-release/check-changelog.mjs "$REL"
   ```
   For an agreed quiet release with no entry, add `--allow-none`.
4. `git diff --stat` must list only `package.json` and `whats-new.jsx` (or
   only `package.json` for a quiet release).

## 6. Commit, push, tag

```bash
git add package.json packages/renderer/js/whats-new.jsx
git commit -m "Bump to X.Y.Z"
git push origin HEAD:main
git tag vX.Y.Z
git push origin vX.Y.Z
```

- The commit message is exactly `Bump to X.Y.Z`, with no body and no
  trailers. This repo's attribution setting is empty.
- If `git push origin HEAD:main` is rejected because main moved on, run
  `git fetch origin` and `git rebase origin/main`. Then check the new commits
  with `git log --oneline HEAD@{1}..origin/main`. If any of them would belong
  in the changelog, go back to step 4 with the user. Otherwise push again.
  Never force-push.
- Push the tag only after main has the bump commit. The tag is what starts
  the release.

## 7. Report and clean up

```bash
gh run list --limit 4
git worktree remove "$REL"
```

Tell the user:
- the version that was released;
- the bump commit and tag;
- links to the started **Release** and **Store package** runs
  (`https://github.com/pkakelas/compas/actions/runs/<id>`).

Don't poll the runs. They take roughly 8–12 minutes. The user can watch them,
or ask you to check later.

If a step fails after the tag is pushed (for example, a workflow fails), don't
delete or move the tag on your own. Explain what failed, and let the user
decide whether to re-run the workflow or cut a new patch release.
