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
   * onProgress(percent, label) is called throughout for UI feedback.
   */
  async function pushCommit({ owner, repo, branch, baseCommitSha, baseTreeSha, diff, message, onProgress }) {

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

    // 2. Create blobs for every added/modified file.
    const treeEntries = [];
    for (const item of changed) {
      const content = await Files.readFileContent(item.file, item.path);
      const blob = await GitHub.createBlob(owner, repo, content.base64);
      treeEntries.push({
        path: item.path,
        mode: '100644',
        type: 'blob',
        sha: blob.sha
      });
      bump(`Uploading ${item.path}`);
    }

    // 3. Mark deletions by omitting them with sha:null in the tree.
    for (const item of diff.deleted) {
      treeEntries.push({
        path: item.path,
        mode: '100644',
        type: 'blob',
        sha: null
      });
      bump(`Removing ${item.path}`);
    }

    // 4. Build the new tree on top of the baseline tree.
    onProgress(93, 'Creating tree…');
    const newTree = await GitHub.createTree(owner, repo, baseTreeSha, treeEntries);

    // 5. One final conflict check right before committing.
    if (await hasConflict(owner, repo, branch, baseCommitSha)) {
      const err = new Error('conflict');
      err.kind = 'conflict';
      throw err;
    }

    // 6. Create the commit object.
    onProgress(96, 'Creating commit…');
    const newCommit = await GitHub.createCommit(owner, repo, message, newTree.sha, baseCommitSha);

    // 7. Move the branch pointer. force:false so GitHub itself rejects a
    // non-fast-forward update if something slipped through the checks above.
    onProgress(98, 'Updating branch…');
    await GitHub.updateRef(owner, repo, branch, newCommit.sha, false);

    onProgress(100, 'Done');
    return newCommit;
  }

  return { captureBaseline, hasConflict, pushCommit };
})();
