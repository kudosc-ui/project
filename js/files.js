/*!
 * GitSync — © 2026 CodeZing (https://youtube.com/@kudosc?si=au2Bagg75VuP_jEr)
 * All rights reserved. Source available for viewing only via the official
 * GitHub repository. No copying, re-hosting, modification-and-redistribution,
 * or resale without written permission. See LICENSE for full terms.
 */
/**
 * files.js
 * Reads a locally-selected folder (or file list) into an in-memory map of
 * relative-path -> File, with safety checks and content readers.
 */

const Files = (() => {
  const MAX_FILE_BYTES = 25 * 1024 * 1024;      // GitHub Contents/blob practical limit for this tool
  const MAX_TOTAL_FILES = 5000;                  // sanity cap for personal projects

  const BINARY_EXTENSIONS = new Set([
    'png','jpg','jpeg','gif','webp','bmp','ico','icns',
    'woff','woff2','ttf','otf','eot',
    'zip','gz','tar','rar','7z','bz2',
    'pdf','psd','ai','sketch',
    'mp3','mp4','mov','avi','wav','ogg','webm','flac',
    'exe','dll','so','dylib','bin','class','jar','wasm',
    'db','sqlite','sqlite3'
  ]);

  /** Rejects paths containing traversal or absolute segments. */
  function isSafePath(path) {
    if (!path || path.startsWith('/') || path.includes('\\')) return false;
    const parts = path.split('/');
    return !parts.some(p => p === '..' || p === '.');
  }

  function normalizePath(path) {
    return path.split('/').filter(Boolean).join('/');
  }

  function extensionOf(path) {
    const dot = path.lastIndexOf('.');
    return dot === -1 ? '' : path.slice(dot + 1).toLowerCase();
  }

  function looksBinaryByExtension(path) {
    return BINARY_EXTENSIONS.has(extensionOf(path));
  }

  /**
   * Reads a FileList coming from a webkitdirectory input or multi-file input
   * and builds { rootName, fileMap, skipped, tooLarge } where fileMap is
   * Map<relativePath, File>.
   */
  function buildFileMap(fileList) {
    const fileMap = new Map();
    const skipped = [];
    const tooLarge = [];
    let rootName = '';

    const files = Array.from(fileList);
    if (files.length > MAX_TOTAL_FILES) {
      throw new Error(`This folder has more than ${MAX_TOTAL_FILES} files. Please choose a smaller project folder.`);
    }

    for (const file of files) {
      // webkitRelativePath looks like "kudoscrate/public/index.html"
      const rel = file.webkitRelativePath || file.name;
      const normalized = normalizePath(rel);

      if (!rootName && normalized.includes('/')) {
        rootName = normalized.split('/')[0];
      }

      // Strip the top-level folder name so paths match the repo's own layout,
      // e.g. "kudoscrate/public/app.js" -> "public/app.js"
      const stripped = normalized.includes('/')
        ? normalized.split('/').slice(1).join('/')
        : normalized;

      if (!stripped) continue;
      if (!isSafePath(stripped)) { skipped.push(rel); continue; }

      // Skip common noise directories that should never be committed.
      if (/(^|\/)(\.git|node_modules|\.DS_Store)(\/|$)/.test(stripped)) continue;

      if (file.size > MAX_FILE_BYTES) { tooLarge.push(stripped); continue; }

      if (fileMap.has(stripped)) {
        skipped.push(`${stripped} (duplicate path)`);
      }
      fileMap.set(stripped, file);
    }

    return { rootName: rootName || 'project', fileMap, skipped, tooLarge };
  }

  function readAsArrayBuffer(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error(`Could not read file: ${file.name}`));
      reader.readAsArrayBuffer(file);
    });
  }

  function arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  function bufferLooksBinary(buffer) {
    const bytes = new Uint8Array(buffer.slice(0, 8000));
    for (let i = 0; i < bytes.length; i++) {
      if (bytes[i] === 0) return true; // NUL byte is a strong binary signal
    }
    return false;
  }

  /**
   * Reads a File's full content and returns:
   * { base64, isBinary, text (only if !isBinary) }
   */
  async function readFileContent(file, path) {
    const buffer = await readAsArrayBuffer(file);
    const binary = looksBinaryByExtension(path) || bufferLooksBinary(buffer);
    const base64 = arrayBufferToBase64(buffer);
    let text = null;
    if (!binary) {
      try {
        text = new TextDecoder('utf-8', { fatal: false }).decode(buffer);
      } catch (e) {
        text = null;
      }
    }
    return { base64, isBinary: binary, text };
  }

  return {
    buildFileMap, readFileContent, isSafePath, looksBinaryByExtension,
    MAX_FILE_BYTES, MAX_TOTAL_FILES
  };
})();
