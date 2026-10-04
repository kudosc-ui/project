# GitSync security notes

GitSync is fully client-side: your GitHub token is stored in your own browser and is only ever sent to `https://api.github.com`.

## For users
- Use a **fine-grained token** limited to the repositories you need, with a short expiry. A classic `repo` token can reach every repository you own.
- On a shared or public device, untick **Remember me on this device** when connecting, and press **Disconnect** when done.
- If a token may have leaked, delete it at github.com -> Settings -> Developer settings -> Personal access tokens.

## For the developer
- A Content-Security-Policy (meta tag in every page) allows only same-origin scripts and network calls to api.github.com. Do not add inline `<script>` blocks or third-party script hosts.
- JSZip and DOMPurify are self-hosted in `js/vendor/`. Update them by replacing the files, then bump `CACHE_VERSION` in `service-worker.js`.
- Escape everything from GitHub before putting it in `innerHTML` (`UI.escapeHtml`, `UI.safeUrl`).
- Host GitSync on its own origin. Anything else served from the same origin can read the stored token.
