/*!
 * GitSync — © 2026 CodeZing (https://youtube.com/@kudosc?si=au2Bagg75VuP_jEr)
 * All rights reserved. Source available for viewing only via the official
 * GitHub repository. No copying, re-hosting, modification-and-redistribution,
 * or resale without written permission. See LICENSE for full terms.
 */
/**
 * compare.js
 * Compares the locally uploaded file map against the GitHub repository tree,
 * respecting the chosen sync mode (entire repo vs. uploaded folder only).
 */

const Compare = (() => {

  /** Builds Map<path, {sha, size}> from a recursive GitHub tree response (blobs only). */
  function buildRemoteFileMap(treeResponse) {
    const map = new Map();
    for (const entry of treeResponse.tree) {
      if (entry.type === 'blob') {
        map.set(entry.path, { sha: entry.sha, size: entry.size });
      }
    }
    return map;
  }

  /**
   * Computes the diff between local and remote file sets.
   *
   * @param localMap   Map<path, File>
   * @param localHashes Map<path, sha1Hex>  (git blob-style sha of local content)
   * @param remoteMap  Map<path, {sha,size}>
   * @param syncMode   'repo' | 'folder'
   * @param uploadedRootName  the name of the folder the user picked, used only
   *                          for display; comparisons use stripped relative paths
   *
   * folder mode: only paths that exist locally are ever touched. Deletions are
   * only proposed for remote files that fall "within scope" — since we cannot
   * know the intended scope beyond the set of local paths' common top-level
   * directories, folder mode restricts deletions to remote paths sharing a
   * top-level directory with at least one uploaded file. Files outside that
   * scope (e.g. server/ when only public/ was uploaded) are left untouched.
   */
  function computeDiff(localMap, localHashes, remoteMap, syncMode, uploadedRootName) {
    const added = [], modified = [], deleted = [], unchanged = [];

    // Determine top-level directories present in the local upload, used to
    // scope deletions in "folder" mode.
    const localTopDirs = new Set();
    for (const path of localMap.keys()) {
      const top = path.includes('/') ? path.split('/')[0] : path;
      localTopDirs.add(top);
    }

    for (const [path, file] of localMap.entries()) {
      const remote = remoteMap.get(path);
      const localSha = localHashes.get(path);
      if (!remote) {
        added.push({ path, status: 'added', file });
      } else if (remote.sha !== localSha) {
        modified.push({ path, status: 'modified', file, remoteSha: remote.sha });
      } else {
        unchanged.push({ path, status: 'unchanged', file });
      }
    }

    for (const [path, remote] of remoteMap.entries()) {
      if (localMap.has(path)) continue; // handled above

      if (syncMode === 'repo') {
        deleted.push({ path, status: 'deleted', remoteSha: remote.sha });
      } else {
        // folder mode: only flag as deleted if it lives under one of the
        // top-level directories we actually uploaded.
        const top = path.includes('/') ? path.split('/')[0] : path;
        if (localTopDirs.has(top)) {
          deleted.push({ path, status: 'deleted', remoteSha: remote.sha });
        }
        // else: outside the uploaded folder's scope -> never touched
      }
    }

    added.sort((a, b) => a.path.localeCompare(b.path));
    modified.sort((a, b) => a.path.localeCompare(b.path));
    deleted.sort((a, b) => a.path.localeCompare(b.path));
    unchanged.sort((a, b) => a.path.localeCompare(b.path));

    return { added, modified, deleted, unchanged };
  }

  /**
   * Computes the git "blob" SHA-1 for a file's raw bytes, matching GitHub's
   * own blob hashing (sha1("blob " + length + "\0" + content)), so unchanged
   * files can be detected without downloading remote blob contents.
   */
  async function gitBlobSha1(arrayBuffer) {
    const header = `blob ${arrayBuffer.byteLength}\0`;
    const headerBytes = new TextEncoder().encode(header);
    const combined = new Uint8Array(headerBytes.length + arrayBuffer.byteLength);
    combined.set(headerBytes, 0);
    combined.set(new Uint8Array(arrayBuffer), headerBytes.length);
    const digest = await crypto.subtle.digest('SHA-1', combined);
    return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // ---- Simple line-based diff (Myers-ish via LCS on lines) ----

  function lcsLineDiff(oldLines, newLines) {
    const n = oldLines.length, m = newLines.length;
    const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i][j] = oldLines[i] === newLines[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    const ops = [];
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (oldLines[i] === newLines[j]) {
        ops.push({ type: 'context', line: oldLines[i] });
        i++; j++;
      } else if (dp[i + 1][j] >= dp[i][j + 1]) {
        ops.push({ type: 'remove', line: oldLines[i] });
        i++;
      } else {
        ops.push({ type: 'add', line: newLines[j] });
        j++;
      }
    }
    while (i < n) { ops.push({ type: 'remove', line: oldLines[i] }); i++; }
    while (j < m) { ops.push({ type: 'add', line: newLines[j] }); j++; }
    return ops;
  }

  /** Guards against pathological diff sizes freezing the tab. */
  function diffText(oldText, newText) {
    const oldLines = oldText.split('\n');
    const newLines = newText.split('\n');
    if (oldLines.length * newLines.length > 4_000_000) {
      return null; // caller falls back to a "too large to preview" message
    }
    return lcsLineDiff(oldLines, newLines);
  }

  return { buildRemoteFileMap, computeDiff, gitBlobSha1, diffText };
})();
