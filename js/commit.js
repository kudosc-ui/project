/**
 * commit.js
 * Orchestrates turning a computed diff into ONE atomic Git commit using the
 * GitHub Git Data API (blobs -> tree -> commit -> ref update).
 */

const Commit = (() => {

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

    // 1. Re-check for conflicts right before we start mutating anything.
    onProgress(2, 'Checking repository state…');
    if (await hasConflict(owner, repo, branch, baseCommitSha)) {
      const err = new Error('conflict');
      err.kind = 'conflict';
      throw err;
    }

    const changed = [...diff.added, ...diff.modified];
    const total = changed.length + diff.deleted.length + 2; // +2 for tree/commit steps
    let done = 0;
    const bump = (label) => {
      done++;
      onProgress(Math.min(95, Math.round((done / total) * 90) + 2), label);
    };

    // 2. Create blobs for every added/modified file, independently.
    const treeEntries = [];
    const failures = [];
    for (const item of changed) {
      try {
        const content = await Files.readFileContent(item.file, item.path);
        const blob = await GitHub.createBlob(owner, repo, content.base64);
        treeEntries.push({ path: item.path, mode: '100644', type: 'blob', sha: blob.sha });
        onFileResult({ path: item.path, status: 'success' });
      } catch (e) {
        failures.push({ path: item.path, error: e });
        onFileResult({ path: item.path, status: 'failed', error: e.message || 'Upload failed' });
      }
      bump(`Uploading ${item.path}`);
    }

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
      const err = new Error(`${failures.length} file(s) failed to upload. No commit was created.`);
      err.kind = 'partial_failure';
      err.failures = failures;
      throw err;
    }

    // 5. Build the new tree on top of the baseline tree.
    onProgress(93, 'Creating tree…');
    const newTree = await GitHub.createTree(owner, repo, baseTreeSha, treeEntries);

    // 6. One final conflict check right before committing.
    if (await hasConflict(owner, repo, branch, baseCommitSha)) {
      const err = new Error('conflict');
      err.kind = 'conflict';
      throw err;
    }

    // 7. Create the commit object.
    onProgress(96, 'Creating commit…');
    const newCommit = await GitHub.createCommit(owner, repo, message, newTree.sha, baseCommitSha);

    // 8. Move the branch pointer. force:false so GitHub itself rejects a
    // non-fast-forward update if something slipped through the checks above.
    onProgress(98, 'Updating branch…');
    await GitHub.updateRef(owner, repo, branch, newCommit.sha, false);

    onProgress(100, 'Done');
    return newCommit;
  }

  return { captureBaseline, hasConflict, pushCommit };
})();
