/*!
 * GitSync — © 2026 CodeZing (https://youtube.com/@kudosc?si=au2Bagg75VuP_jEr)
 * All rights reserved. Source available for viewing only via the official
 * GitHub repository. No copying, re-hosting, modification-and-redistribution,
 * or resale without written permission. See LICENSE for full terms.
 */
/**
 * commit.js
 * Orchestrates turning a computed diff into ONE atomic Git commit using the
 * GitHub Git Data API (blobs -> tree -> commit -> ref update).
 */

const Commit = (() => {

  const UPLOAD_CONCURRENCY = 4; // parallel blob uploads — fast, but gentle enough to avoid secondary rate limits
  const MAX_RETRIES = 4;

  function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

  /**
   * Retries a transient failure (rate limit / network hiccup) with backoff.
   * Anything else (auth, permission, invalid, not_found) fails immediately —
   * retrying those would only waste time.
   */
  async function withRetry(fn, extraRetryKinds) {
    let attempt = 0;
    while (true) {
      try {
        return await fn();
      } catch (e) {
        attempt++;
        const retryable = e && (e.kind === 'rate_limit' || e.kind === 'network' || (extraRetryKinds && extraRetryKinds.includes(e.kind)));
        if (!retryable || attempt > MAX_RETRIES) throw e;
        const wait = e.retryAfter ? e.retryAfter * 1000 : Math.min(1000 * Math.pow(2, attempt - 1), 12000);
        await sleep(wait);
      }
    }
  }

  /**
   * Runs `worker` over `items` with at most `limit` in flight at once,
   * calling onItemDone(item, result|null, error|null) as each settles.
   * Larger projects (many files across multiple folders) finish faster than
   * fully sequential uploads, without hammering the API hard enough to
   * trigger a secondary rate limit.
   */
  async function runPool(items, limit, worker, onItemDone) {
    let i = 0;
    async function next() {
      while (i < items.length) {
        const idx = i++;
        const item = items[idx];
        try {
          const result = await worker(item);
          onItemDone(item, result, null);
        } catch (e) {
          onItemDone(item, null, e);
        }
      }
    }
    const runners = Array.from({ length: Math.min(limit, items.length) }, next);
    await Promise.all(runners);
  }

  /**
   * Captures the branch's current state before the user starts reviewing,
   * so we can detect if anyone else pushes in the meantime.
   */
  async function captureBaseline(owner, repo, branch) {
    const ref = await GitHub.getRef(owner, repo, branch);
    const baseCommitSha = ref.object.sha;
    const baseCommit = await GitHub.getCommit(owner, repo, baseCommitSha);
    const baseTreeSha = baseCommit.tree.sha;
    const fullTree = await GitHub.getTree(owner, repo, baseTreeSha, true);
    return { baseCommitSha, baseTreeSha, fullTree };
  }

  /** Returns true if the branch has moved since captureBaseline(). */
  async function hasConflict(owner, repo, branch, baseCommitSha) {
    const ref = await GitHub.getRef(owner, repo, branch);
    return ref.object.sha !== baseCommitSha;
  }

  /**
   * Pushes the full diff as a single commit.
   *
   * onProgress(percent, label) is called throughout for the progress bar.
   * onFileResult({ path, status: 'success'|'failed', error? }) is called once
   * per changed/deleted file so the UI can render a live per-file results
   * list (see UI's sync-results view).
   *
   * Blob creation for each file is attempted independently and failures are
   * collected rather than thrown immediately — this lets the results page
   * show a complete picture (which files worked, which didn't). Nothing is
   * pushed to the branch (no tree/commit/ref update) unless every single
   * file succeeded, so a partial failure never produces a partial commit;
   * the orphan blobs GitHub stored for the successful files are simply
   * never referenced by anything and are harmless.
   */
  async function pushCommit({ owner, repo, branch, baseCommitSha, baseTreeSha, diff, message, onProgress, onFileResult }) {
    const noop = () => {};
    onFileResult = onFileResult || noop;
    const isInitialCommit = !baseCommitSha; // true when the repo has no commits/ref yet

    // 1. Re-check for conflicts right before we start mutating anything.
    // Skipped entirely for a brand-new repo — there's nothing to conflict with.
    if (!isInitialCommit) {
      onProgress(2, 'Checking repository state…');
      if (await hasConflict(owner, repo, branch, baseCommitSha)) {
        const err = new Error('conflict');
        err.kind = 'conflict';
        throw err;
      }
    } else {
      // GitHub's Git Data API (blobs/trees/commits) can lag behind the repo
      // record itself by anywhere from under a second to several seconds —
      // a fixed pause here used to guess how long that gap was, and on a
      // slower-provisioning repo (or a project with many files, all hitting
      // the API the moment the pause ends) it guessed wrong: every blob
      // request landed too early, got 404, and all of them failed together
      // with none left to retry into. Actually probing readiness — by
      // creating one throwaway blob and retrying *that* until it succeeds —
      // waits exactly as long as this repo needs instead of a guess, and
      // nothing proceeds until the API is genuinely ready to accept writes.
      // During that same lag window GitHub sometimes answers 409 ("Git
      // Repository is empty…") instead of 404, so 'conflict' is retried
      // here too — it can't be a *real* conflict this early since a first
      // commit has no existing ref for anything to conflict with.
      onProgress(2, 'Preparing first commit…');
      await withRetry(
        () => GitHub.createBlob(owner, repo, ''),
        ['not_found', 'permission', 'conflict']
      );
    }

    const changed = [...diff.added, ...diff.modified];
    const total = changed.length + diff.deleted.length + 2; // +2 for tree/commit steps
    let done = 0;
    const bump = (label) => {
      done++;
      onProgress(Math.min(95, Math.round((done / total) * 90) + 2), label);
    };

    // 2. Create blobs for every added/modified file, independently, with
    // limited concurrency and automatic retry on transient failures (rate
    // limits, network hiccups) — this is what keeps larger projects (many
    // files spread across several folders) reliable instead of failing
    // partway through a long sequential upload.
    const blobResults = new Map(); // path -> sha
    const failures = [];
    await runPool(
      changed,
      UPLOAD_CONCURRENCY,
      (item) => withRetry(async () => {
        const content = await Files.readFileContent(item.file, item.path);
        return GitHub.createBlob(owner, repo, content.base64);
      }, isInitialCommit ? ['not_found', 'permission', 'conflict'] : undefined),
      (item, blob, err) => {
        if (err) {
          failures.push({ path: item.path, error: err });
          onFileResult({ path: item.path, status: 'failed', error: err.message || 'Upload failed' });
        } else {
          blobResults.set(item.path, blob.sha);
          onFileResult({ path: item.path, status: 'success' });
        }
        bump(`Uploading ${item.path}`);
      }
    );
    // Preserve a stable, deterministic tree order regardless of which
    // parallel upload happened to finish first.
    const treeEntries = changed
      .filter((item) => blobResults.has(item.path))
      .map((item) => ({ path: item.path, mode: '100644', type: 'blob', sha: blobResults.get(item.path) }));

    // 3. Mark deletions by omitting them with sha:null in the tree. No
    // network call is needed per-file here — the deletion is realized when
    // the tree is created — so we report success optimistically and only
    // roll it back below if the overall push aborts.
    for (const item of diff.deleted) {
      treeEntries.push({ path: item.path, mode: '100644', type: 'blob', sha: null });
      onFileResult({ path: item.path, status: 'success' });
      bump(`Removing ${item.path}`);
    }

    // 4. If anything failed, stop here. Nothing has been committed — the
    // successfully-created blobs are unreferenced and harmless.
    if (failures.length) {
      // Every file usually fails for the *same* underlying reason (an
      // expired token, a permission gap, a rate limit) — surface that
      // reason directly instead of just a bare count, so the person isn't
      // left staring at "33 files failed" with no idea why.
      const byKind = new Map();
      for (const f of failures) {
        const kind = (f.error && f.error.kind) || 'unknown';
        byKind.set(kind, (byKind.get(kind) || 0) + 1);
      }
      const [topKind] = [...byKind.entries()].sort((a, b) => b[1] - a[1])[0];
      const sample = failures.find(f => (f.error && f.error.kind) === topKind).error;
      const reasonCounts = byKind.size > 1
        ? ` (${[...byKind.entries()].map(([k, n]) => `${n} ${k}`).join(', ')})`
        : '';
      const err = new Error(
        `${sample.message || 'Upload failed'} (${failures.length} file(s) affected${reasonCounts}). No commit was created.`
      );
      err.kind = 'partial_failure';
      err.failures = failures;
      throw err;
    }

    // 5. Build the new tree. A brand-new repo has no base tree to build on.
    onProgress(93, 'Creating tree…');
    const newTree = await withRetry(
      () => GitHub.createTree(owner, repo, isInitialCommit ? null : baseTreeSha, treeEntries),
      isInitialCommit ? ['not_found', 'permission', 'conflict'] : undefined
    );

    // 6. One final conflict check right before committing (not applicable to a first commit).
    if (!isInitialCommit && await hasConflict(owner, repo, branch, baseCommitSha)) {
      const err = new Error('conflict');
      err.kind = 'conflict';
      throw err;
    }

    // 7. Create the commit object. A first commit has no parent.
    onProgress(96, 'Creating commit…');
    const newCommit = await withRetry(
      () => GitHub.createCommit(owner, repo, message, newTree.sha, isInitialCommit ? null : baseCommitSha),
      isInitialCommit ? ['not_found', 'permission', 'conflict'] : undefined
    );

    // 8. Point the branch at the new commit. A brand-new repo has no ref yet,
    // so it must be created rather than updated; force:false on the update
    // path so GitHub itself rejects a non-fast-forward change as a last
    // line of defense.
    onProgress(98, 'Updating branch…');
    if (isInitialCommit) {
      await withRetry(() => GitHub.createRef(owner, repo, branch, newCommit.sha), ['not_found', 'permission', 'conflict']);
    } else {
      await withRetry(() => GitHub.updateRef(owner, repo, branch, newCommit.sha, false));
    }

    onProgress(100, 'Done');
    return newCommit;
  }

  return { captureBaseline, hasConflict, pushCommit };
})();
