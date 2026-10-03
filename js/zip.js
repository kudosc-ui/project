/*!
 * GitSync — © 2026 CodeZing (https://youtube.com/@kudosc?si=au2Bagg75VuP_jEr)
 * All rights reserved. Source available for viewing only via the official
 * GitHub repository. No copying, re-hosting, modification-and-redistribution,
 * or resale without written permission. See LICENSE for full terms.
 */
/**
 * zip.js
 * Extracts an uploaded .zip archive into the same in-memory shape that
 * folder upload produces: { rootName, fileMap, skipped, tooLarge } where
 * fileMap is Map<relativePath, BlobLike>. Downstream code (hashing, diffing,
 * committing) treats this identically to a folder selection — a Blob
 * supports the same .arrayBuffer()/.size members that File does.
 */

const ZipHandler = (() => {

  /**
   * @param file        the uploaded .zip File
   * @param onProgress  (percent, detail) => void, called while reading/extracting
   */
  async function extractZip(file, onProgress) {
    if (typeof JSZip === 'undefined') {
      throw new Error('ZIP support failed to load. Check your internet connection and reload the page.');
    }

    onProgress(5, 'Reading archive…');
    let zip;
    try {
      zip = await JSZip.loadAsync(file);
    } catch (e) {
      throw new Error('This does not look like a valid ZIP file.');
    }

    // Collect all non-directory entries first, so we can compute progress
    // and detect a shared top-level folder (mirrors how folder upload
    // strips the picked directory's own name).
    const entries = Object.values(zip.files).filter(e => !e.dir);
    if (!entries.length) {
      throw new Error('This ZIP file is empty.');
    }
    if (entries.length > Files.MAX_TOTAL_FILES) {
      throw new Error(`This ZIP has more than ${Files.MAX_TOTAL_FILES} files. Please use a smaller archive.`);
    }

    // Some zip tools (mainly older Windows utilities) store entry names with
    // backslashes instead of forward slashes. Without this, every file in
    // such an archive would be treated as an unsafe path and silently
    // skipped — the archive would "extract" with zero usable files and the
    // resulting repository would be created empty with no clear error.
    const normalizedPaths = entries.map(e => e.name.replace(/\\/g, '/').split('/').filter(Boolean).join('/'));
    let rootName = detectSharedRoot(normalizedPaths);

    const fileMap = new Map();
    const skipped = [];
    const tooLarge = [];

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const normalized = normalizedPaths[i];
      const stripped = rootName
        ? normalized.split('/').slice(1).join('/')
        : normalized;

      onProgress(5 + Math.round(((i + 1) / entries.length) * 55), `Extracting ${stripped || normalized}`);

      if (!stripped) continue;
      if (!Files.isSafePath(stripped)) { skipped.push(normalized); continue; }
      if (/(^|\/)(\.git|node_modules|\.DS_Store|__MACOSX)(\/|$)/.test(stripped)) continue;

      let blob;
      try {
        blob = await entry.async('blob');
      } catch (e) {
        skipped.push(`${stripped} (could not extract)`);
        continue;
      }

      if (blob.size > Files.MAX_FILE_BYTES) { tooLarge.push(stripped); continue; }

      if (fileMap.has(stripped)) {
        skipped.push(`${stripped} (duplicate path)`);
      }
      // Tag the blob with a name so it behaves consistently with File objects
      // wherever code logs or displays it.
      try { Object.defineProperty(blob, 'name', { value: stripped, configurable: true }); } catch (e) { /* ignore */ }
      fileMap.set(stripped, blob);
    }

    onProgress(65, 'Extraction complete');
    return { rootName: rootName || 'project', fileMap, skipped, tooLarge };
  }

  /**
   * If every entry starts with the same single top-level directory name,
   * treat that as the archive's "project root" and strip it — matching how
   * webkitdirectory folder uploads behave (kudoscrate/public/app.js becomes
   * public/app.js). If paths are mixed (some at root, some nested under
   * different top folders), don't strip anything.
   */
  function detectSharedRoot(paths) {
    const tops = new Set(paths.map(p => (p.includes('/') ? p.split('/')[0] : null)));
    if (tops.size === 1 && !tops.has(null)) {
      return [...tops][0];
    }
    return null;
  }

  return { extractZip };
})();
