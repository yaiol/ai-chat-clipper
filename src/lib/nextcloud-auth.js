// Nextcloud connection storage + WebDAV helpers.
//
// Auth model: per-account "app password" (Settings → Security → Devices &
// sessions → Create new app password). The user pastes username + app
// password into the extension's Nextcloud settings tab. We store both in
// chrome.storage.local and use HTTP Basic auth on every WebDAV request.
//
// No OAuth - Nextcloud's OAuth path requires the admin to register a client
// application server-side, which is overkill for this use case. The app
// password approach is what every Nextcloud-aware tool (Joplin, KeePassXC,
// the official desktop sync client) uses.
//
// Storage layout under adx_nextcloud:
//   { serverUrl, username, appPassword, folder }
// `serverUrl` is normalised to no trailing slash; `folder` always starts
// with "/" and never ends with "/" (root = "").

(() => {
  const NS = (globalThis.AiDoc ||= {});
  // Local (not NS.*): these files also run in the service worker, where
  // lib/storage.js (NS.APP_NAME) is not loaded.
  const APP_NAME = chrome.runtime.getManifest().name;
  const TAG = "[" + APP_NAME + "]";

  const STORAGE_KEY = "adx_nextcloud";
  const DEFAULT_FOLDER = "/" + APP_NAME;

  function normaliseServerUrl(s) {
    return String(s || "").trim().replace(/\/+$/, "");
  }
  function normaliseFolder(s) {
    let f = String(s || "").trim();
    if (!f) return "";
    if (!f.startsWith("/")) f = "/" + f;
    return f.replace(/\/+$/, "");
  }
  // Encode a path while keeping the slashes so it stays a valid URL path.
  function encodePath(p) {
    return String(p || "").split("/").map(encodeURIComponent).join("/");
  }

  function basicAuth(user, pass) {
    return "Basic " + btoa(`${user}:${pass}`);
  }

  function davUrl(conn, relPath) {
    // Nextcloud per-user WebDAV root. relPath should start with "/".
    return `${conn.serverUrl}/remote.php/dav/files/${encodeURIComponent(conn.username)}${encodePath(relPath)}`;
  }

  NS.nextcloud = {
    DEFAULT_FOLDER,

    async getConnection() {
      const o = await new Promise((res) => chrome.storage.local.get(STORAGE_KEY, res));
      return o[STORAGE_KEY] || null;
    },

    async isConnected() {
      const c = await this.getConnection();
      return !!(c && c.serverUrl && c.username && c.appPassword);
    },

    async setConnection(partial) {
      const conn = {
        serverUrl:   normaliseServerUrl(partial.serverUrl),
        username:    String(partial.username || "").trim(),
        appPassword: String(partial.appPassword || "").trim(),
        folder:      normaliseFolder(partial.folder || DEFAULT_FOLDER),
        format:      String(partial.format || "markdown"),
      };
      await new Promise((res) => chrome.storage.local.set({ [STORAGE_KEY]: conn }, res));
      return conn;
    },

    async clearConnection() {
      await new Promise((res) => chrome.storage.local.remove(STORAGE_KEY, res));
    },

    // Probe credentials with a PROPFIND on the user's WebDAV root. Returns
    // { ok: true } on 207 (Multi-Status), { ok: false, error } otherwise.
    // Surfaces the most common failure modes (401, 404, network) with
    // human-readable messages so the Settings panel can show something
    // useful instead of "PROPFIND failed".
    async testConnection(conn) {
      try {
        const r = await fetch(davUrl(conn, "/"), {
          method: "PROPFIND",
          // credentials:"omit" - without it, Nextcloud sees the browser's
          // session cookie (when the user is logged in to the same domain),
          // switches to session auth, then rejects the request with
          // "CSRF check not passed". Stripping cookies forces Basic auth.
          credentials: "omit",
          headers: {
            Authorization: basicAuth(conn.username, conn.appPassword),
            Depth: "0",
          },
        });
        if (r.status === 207) return { ok: true };
        // Non-success - read the body so failures surface real Nextcloud
        // error text instead of opaque "Invalid credentials".
        const body = (await r.text().catch(() => "")).slice(0, 300);
        if (r.status === 401) {
          return { ok: false, error: `401 - username or app password rejected. ${body}` };
        }
        if (r.status === 404) {
          return { ok: false, error: `404 - user "${conn.username}" not found at ${conn.serverUrl}. ${body}` };
        }
        return { ok: false, error: `HTTP ${r.status}: ${body}` };
      } catch (err) {
        return { ok: false, error: String(err?.message || err) };
      }
    },

    // Browser permission helper - Nextcloud servers vary per user, so the
    // host is granted at runtime via chrome.permissions.request. The Settings
    // page calls this before saving credentials.
    async requestHostPermission(serverUrl) {
      const url = normaliseServerUrl(serverUrl);
      if (!url) throw new Error("Server URL is required");
      const origin = url + "/*";
      const granted = await new Promise((res) =>
        chrome.permissions.request({ origins: [origin] }, res));
      if (!granted) throw new Error("Permission denied for " + url);
      return true;
    },

    // Helpers exposed for background.js to do the actual upload.
    basicAuth,
    davUrl,
    encodePath,
    normaliseServerUrl,
    normaliseFolder,
  };
})();
