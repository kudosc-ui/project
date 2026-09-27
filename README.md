# GitSync

A personal, single-page tool for syncing a local project folder to a GitHub
repository as **one clean commit** — no per-file commits, no manual staging.
Built with plain HTML, CSS, and vanilla JavaScript. No frameworks, no backend,
no build step.

---

## 1. Running it

GitSync is just static files. The GitHub API requires the page to be served
over `http://` or `https://` (not opened directly as a `file://` URL, which
some browsers block for security reasons), so run a tiny local server from
this folder:

```bash
# Python 3
python3 -m http.server 8080

# or Node (if you have it)
npx serve .
```

Then open `http://localhost:8080` in your browser. You can also upload this
folder to any static host (GitHub Pages, Netlify, Vercel, a personal VPS) —
it needs nothing beyond serving the files as-is.

## 2. Authentication & multiple accounts

GitSync has no backend, and a real "Login with GitHub" OAuth flow requires a
**client secret**, which can never be safely stored in frontend JavaScript —
anyone could open dev tools and steal it. So instead of fake-OAuth, GitSync
uses GitHub's own recommended approach for personal tools: a **Personal
Access Token (PAT)**.

**To create one:**

1. Go to **github.com → Settings → Developer settings → Personal access
   tokens → Tokens (classic)** (or use the "How do I get a token?" link on
   the login screen, which opens a pre-filled token page).
2. Click **Generate new token (classic)**, give it a name like `GitSync`
   and an expiration you're comfortable with.
3. Check the **repo** scope only — nothing else is needed.
4. Generate it, copy it, and paste it into GitSync's login screen.

**Switching between multiple GitHub accounts:** GitSync supports saving more
than one account and switching between them instantly, from the gear icon
in the navbar (Settings on Home, "Accounts" modal on Custom):

- **Add Account** — paste another token to save a second (or third...)
  account alongside the current one.
- **Switch** — makes a saved account active; the page reloads using that
  account's token for every GitHub request from then on.
- **Remove** — deletes a saved account's token from this browser, with a
  confirmation prompt first.

**Where tokens live:** saved accounts are kept in this browser's
`localStorage` so switching between them survives closing and reopening the
browser. This is the tradeoff that makes a multi-account switcher useful —
tokens are never sent anywhere except `https://api.github.com`, and you can
remove any saved account at any time from the Accounts UI.

## 3. Two ways to upload: a folder, or a ZIP file

**Option A — Upload Project Folder** (described below).

**Option B — Upload ZIP File.** Click **Upload ZIP File** and pick a `.zip`
archive of your project. GitSync extracts it entirely in the browser (using
[JSZip](https://stuk.github.io/jszip/), the one small utility library this
app uses — everything else is hand-written vanilla JS) — nothing is
uploaded anywhere just to unzip it. If every file in the archive shares one
top-level folder (e.g. `kudoscrate/public/app.js`), that folder name is
stripped the same way a folder upload strips it, so the resulting paths line
up with your repository (`public/app.js`). From this point on, a ZIP upload
and a folder upload are processed identically — same hashing, same diffing,
same commit flow.

## 3a. How folder upload works

Click **Upload Project Folder**, which uses the browser's
`<input type="file" webkitdirectory>` to let you pick an entire folder (e.g.
`kudoscrate/`). GitSync reads every file's relative path (stripping the
top-level folder name, so `kudoscrate/public/app.js` becomes `public/app.js`
to match how it's stored in your repo) and keeps the full folder structure —
nothing is flattened.

Noise directories (`.git`, `node_modules`, `.DS_Store`) are automatically
skipped, and unsafe paths (anything containing `..` or an absolute path) are
rejected outright.

If your browser doesn't support folder selection (a handful of older or
locked-down mobile browsers), GitSync automatically falls back to a
multi-file picker.

## 4. How synchronization works

After upload, GitSync:

1. Fetches the selected branch's current commit and its full file tree from
   GitHub.
2. Computes a Git-compatible SHA-1 hash of each local file's content — the
   same hashing scheme Git itself uses for blobs — so it can tell "modified"
   apart from "identical content, don't touch it" without needing to
   download every remote file.
3. Classifies every path as **Added**, **Modified**, **Deleted**, or
   **Unchanged**.

**Sync Mode** controls how deletions are scoped:

- **Entire repository** — any file that exists on GitHub but wasn't in your
  upload is proposed for deletion.
- **Selected folder only** (default) — deletions are limited to paths that
  share a top-level directory with something you uploaded. So if you only
  upload `public/`, files under `server/` are left completely alone, even if
  they differ from what's on GitHub.

Proposed deletions are always shown separately and require an explicit
checkbox confirmation before you can continue — nothing is ever deleted
silently.

## 5. How commits are created

GitSync uses GitHub's low-level **Git Data API** to build one atomic commit:

1. Read the branch's current commit → its tree.
2. Create a **blob** for every added/modified file's content.
3. Build one new **tree** on top of the current tree, adding/updating those
   blobs and marking deleted paths with `sha: null`.
4. Create one **commit** object pointing at that tree, with the branch's
   previous commit as its parent.
5. Move the branch ref to the new commit.

That's a single commit containing every change, not one commit per file.

**Sync Results page.** When you click **Commit Everything**, GitSync takes
you to a dedicated results page listing every changed file with a live
status badge (pending → done/failed) as it's processed. Each file's upload
to GitHub is attempted independently, so if one file has a problem you can
see exactly which one and why. If **any** file fails, GitSync stops before
touching your branch at all — no tree, commit, or ref update is created, so
nothing partial ever lands in your repository — and the page shows how many
succeeded vs. failed with a **Try Again** button. If every file succeeds,
you'll see **"All files have been changed successfully"**, and GitSync
proceeds automatically to finalize the single commit and show the success
screen with the commit link.

**Conflict protection:** GitSync records the branch's commit SHA the moment
you start reviewing changes, and re-checks it immediately before building the
tree and again immediately before committing. If the branch moved in the
meantime (someone else pushed), the operation stops and you're shown a
"Repository changed" screen instead of risking an overwrite. The final ref
update also uses `force: false`, so GitHub itself will refuse a non-fast-
forward update as a last line of defense.

## 6. Browser compatibility

- **Folder upload** (`webkitdirectory`) works in Chrome, Edge, Safari, and
  Firefox (recent versions) — desktop and mobile. Where it's unsupported,
  GitSync falls back to selecting individual files.
- **crypto.subtle** (used for local file hashing) requires a secure context
  (`https://` or `localhost`), which is why local development must be served
  through a local web server rather than opened as a `file://` path.
- No File System Access API dependency is required for core functionality;
  the standard File/Input APIs are used throughout for maximum compatibility.

## 7. Security considerations

- No client secret, ever — this app has no OAuth app registration.
- Your token is never hard-coded, logged, or transmitted anywhere except
  `api.github.com`.
- Token storage is per-account in `localStorage`, so multiple accounts can
  be switched between; remove any saved account any time from the Accounts
  UI (gear icon in the navbar).
- Uploaded file paths are validated to block path traversal (`../`) and
  absolute paths before they're ever considered for comparison or commit.
- Large uploads are capped (25 MB per file, 5000 files per folder) to avoid
  freezing the tab or hitting GitHub API limits unexpectedly.
- Deletions always require explicit confirmation.
- All GitHub error responses (401/403/404/409/422/rate limits) are translated
  into plain-language messages — raw HTTP errors are never shown to you.
- The only third-party code in this app is [JSZip](https://stuk.github.io/jszip/),
  loaded at a pinned version from cdnjs solely to read `.zip` archives
  client-side. It never touches your GitHub token or makes any network
  requests of its own.

## 9. Two real pages, one navbar

GitSync is now two separate HTML documents that share the same navbar,
styling, and JavaScript modules:

- **`index.html`** — Home: the folder/ZIP sync dashboard described above.
- **`custom.html`** — Custom: repository creation, GitHub Pages hosting, and
  the file browser/editor.

The navbar (top of both pages) links between them and hosts the Accounts
gear icon. Because they're real pages rather than a single-page app,
navigating between Home and Custom is a normal page load — your GitHub
login carries over automatically (it's read from `localStorage`), but
in-progress state like an unfinished upload or diff does not; finish a sync
on Home before switching to Custom, and vice versa.

If you haven't connected any account yet, Custom shows a prompt pointing
you back to Home to connect first.

## 10. The Custom page

Alongside the Home dashboard (folder/ZIP sync into an existing repo), a
**Home / Custom** tab bar at the top switches to a second page for
repository-level management:

- **Create New Repository** — give it a name, choose **Public** or
  **Private**, and optionally attach a ZIP file. If you attach one, GitSync
  extracts it in the browser and pushes it as the repository's first commit
  (same one-commit approach as the Home page's sync). Leave the ZIP off to
  create an empty repository you can sync into later from Home.
- **Host with GitHub Pages** — after creating a *public* repository, a
  button appears to enable GitHub Pages for it. GitSync calls GitHub's Pages
  API and shows you the resulting live URL
  (`https://<username>.github.io/<repo>/`). Pages typically takes a minute
  or two to finish deploying after being enabled.
- **Your Repositories** — a searchable list of every repository you have
  access to, each with a **Browse Files** action and a direct GitHub link.
- **Browse Files** on any repository shows every file in its default
  branch, with three actions per file:
  - **View** — renders images inline, shows a sandboxed live preview for
    `.html`/`.htm` files, and displays plain text/code read-only. Binary
    files that aren't images show a "preview not available" notice instead
    of garbled output.
  - **Edit** — opens the same content in an editable text area; **Save
    Changes** commits the update directly to that file via GitHub's
    Contents API (one commit per saved file, separate from the Home page's
    batch-sync commits).
  - **Delete** — removes the file with a confirmation prompt.
  - A **Delete Repository** button is also available at the bottom of the
    file browser. Deleting a repository requires typing its exact name into
    a confirmation dialog before the button becomes clickable — the same
    safeguard GitHub itself uses — so it can't happen by an accidental tap
    or a stray click.

## 11. Project structure

```
index.html         # Home page
custom.html        # Custom page
style.css
manifest.json       # PWA manifest (name, icons, theme colors)
service-worker.js   # Offline app-shell caching
icons/               # App icons generated for every required PWA size
js/
  app.js       # Home page: state + event wiring
  auth.js      # multi-account token storage & validation
  accounts.js  # account-switcher UI (shared by both pages)
  github.js    # GitHub REST/Git Data API wrapper
  files.js     # local folder reading, hashing, path safety
  compare.js   # local-vs-remote diffing, line diff
  commit.js    # blob -> tree -> commit -> ref orchestration
  zip.js       # client-side ZIP extraction (uses JSZip)
  ui.js        # DOM rendering helpers, shared confirm() modal
  custom.js    # Custom page: repo creation, Pages hosting, file browser/editor
  theme.js     # Light/dark theme toggle + persistence
README.md
```

## 12. Theme

GitSync ships with both a dark and a light theme. It follows your system
preference the first time you open it, and you can switch anytime with the
sun/moon button in the navbar (or the toggle on the Settings page) — your
choice is remembered for next time via `localStorage`.

## 13. Installing as an app (PWA)

GitSync is a installable Progressive Web App:

- `manifest.json` defines the app's name, colors, and a full icon set
  (48–512px, plus maskable icons) generated from the GitSync logo.
- `service-worker.js` caches the static app shell (HTML/CSS/JS/icons) so the
  app opens instantly and the shell still loads offline. GitHub API calls
  are never cached or intercepted — syncing itself always needs a live
  connection.
- To package it with [PWABuilder](https://www.pwabuilder.com/): host this
  folder anywhere over `https://` (GitHub Pages, Netlify, Vercel, etc.),
  then enter that URL into PWABuilder. It will detect the manifest and
  service worker automatically and let you build Android/iOS/Windows
  packages from there.

Enjoy shipping without thirty little commits.
