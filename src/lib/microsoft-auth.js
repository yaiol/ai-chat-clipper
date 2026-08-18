// Microsoft (Entra) OAuth + connection storage.
//
// Public client + PKCE - no server hop. The Entra app is registered with
// "public client flows" enabled and redirect URI
// https://<extension-id>.chromiumapp.org/microsoft, so launchWebAuthFlow
// captures the code and we swap it for tokens directly from the extension.
//
// Scopes: Files.ReadWrite.AppFolder (write to /Apps/the extension/), User.Read
// (so we can show the signed-in account in Settings), offline_access (to
// receive a refresh_token).
//
// Storage layout under adx_microsoft:
//   { access_token, refresh_token, expires_at, account: { name, email } }

(() => {
  const NS = (globalThis.AiDoc ||= {});
  // Local (not NS.*): these files also run in the service worker, where
  // lib/storage.js (NS.APP_NAME) is not loaded.
  const APP_NAME = chrome.runtime.getManifest().name;
  const TAG = "[" + APP_NAME + "]";

  const CLIENT_ID = "8f940baf-d61e-428e-9a38-1a9a76aad160";
  const AUTHORITY = "https://login.microsoftonline.com/common";
  // Notes.Create lets us POST new OneNote pages - no read access (we always
  // target the default notebook's Quick Notes section, no picker needed).
  const SCOPES    = "Files.ReadWrite.AppFolder Notes.Create User.Read offline_access";
  const STORAGE_KEY = "adx_microsoft";

  function getRedirectUri() {
    return `https://${chrome.runtime.id}.chromiumapp.org/microsoft`;
  }

  // PKCE helpers - base64url(SHA-256(verifier)).
  function b64url(bytes) {
    let s = "";
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function randomVerifier() {
    const buf = new Uint8Array(64);
    crypto.getRandomValues(buf);
    return b64url(buf);
  }
  async function challenge(verifier) {
    const data = new TextEncoder().encode(verifier);
    const hash = await crypto.subtle.digest("SHA-256", data);
    return b64url(new Uint8Array(hash));
  }

  async function fetchJson(url, init) {
    const r = await fetch(url, init);
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      throw new Error(data.error_description || data.error || `HTTP ${r.status}`);
    }
    return data;
  }

  // Decode the JWT id_token payload to surface the signed-in account.
  // Microsoft returns id_token whenever `openid` (implicit via offline_access)
  // is granted. We don't validate the signature - just read the claims for UI.
  function decodeIdToken(idToken) {
    if (!idToken) return null;
    try {
      const parts = idToken.split(".");
      if (parts.length < 2) return null;
      const b = parts[1].replace(/-/g, "+").replace(/_/g, "/");
      const pad = b + "===".slice((b.length + 3) % 4);
      const json = decodeURIComponent(atob(pad).split("").map(c =>
        "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2)).join(""));
      return JSON.parse(json);
    } catch { return null; }
  }

  NS.microsoft = {
    redirectUri: getRedirectUri,

    async getConnection() {
      const o = await new Promise((res) => chrome.storage.local.get(STORAGE_KEY, res));
      return o[STORAGE_KEY] || null;
    },

    async isConnected() {
      const c = await this.getConnection();
      return !!(c && c.access_token);
    },

    async setConnection(conn) {
      await new Promise((res) => chrome.storage.local.set({ [STORAGE_KEY]: conn }, res));
    },

    async clearConnection() {
      await new Promise((res) => chrome.storage.local.remove(STORAGE_KEY, res));
    },

    // Open Microsoft consent in a Chrome-managed popup, exchange the code
    // for tokens directly from the extension (PKCE - no server-held secret).
    async connectInteractive() {
      const redirect_uri = getRedirectUri();
      const verifier = randomVerifier();
      const code_challenge = await challenge(verifier);

      const authUrl = `${AUTHORITY}/oauth2/v2.0/authorize?` +
        `client_id=${encodeURIComponent(CLIENT_ID)}` +
        `&response_type=code` +
        `&redirect_uri=${encodeURIComponent(redirect_uri)}` +
        `&response_mode=query` +
        `&scope=${encodeURIComponent("openid profile " + SCOPES)}` +
        `&code_challenge=${encodeURIComponent(code_challenge)}` +
        `&code_challenge_method=S256` +
        `&prompt=select_account`;

      const responseUrl = await new Promise((resolve, reject) => {
        chrome.identity.launchWebAuthFlow(
          { url: authUrl, interactive: true },
          (url) => {
            const err = chrome.runtime.lastError;
            if (err || !url) reject(new Error(err?.message || "Authorization cancelled"));
            else resolve(url);
          }
        );
      });

      const u = new URL(responseUrl);
      const errParam = u.searchParams.get("error");
      const errDesc  = u.searchParams.get("error_description");
      if (errParam) throw new Error(errDesc || errParam);
      const code = u.searchParams.get("code");
      if (!code) throw new Error("No code in OAuth redirect");

      const body = new URLSearchParams({
        client_id: CLIENT_ID,
        grant_type: "authorization_code",
        code,
        redirect_uri,
        code_verifier: verifier,
        scope: "openid profile " + SCOPES,
      });
      // ⚠ CLAUDE: an expired refresh grant is a NORMAL end-of-life, not a crash - Microsoft's
      // refresh tokens simply run out. Azure answers with its own operator-facing wall of text
      // ("AADSTS70000: The user could not be authenticated as the grant is expired... Trace ID...
      // Correlation ID... Timestamp..."), which used to reach the user verbatim on an export.
      // Translate it, and CLEAR the dead connection: leaving it stored means every later attempt
      // retries the same doomed token and shows the same wall again, with no way back to sign-in.
      let data;
      try {
        data = await fetchJson(`${AUTHORITY}/oauth2/v2.0/token`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body,
        });
      } catch (e) {
        const msg = String(e && e.message || e);
        if (/AADSTS70000|AADSTS700082|invalid_grant|expired/i.test(msg)) {
          await this.clearConnection();
          throw new Error("Your Microsoft sign-in has expired. Connect Microsoft again in Settings, then retry the export.");
        }
        throw e;
      }

      const claims = decodeIdToken(data.id_token);
      const conn = {
        access_token:  data.access_token,
        refresh_token: data.refresh_token || null,
        expires_at:    Date.now() + ((data.expires_in || 3600) - 60) * 1000,
        // ⚠ Only what Settings actually PRINTS ("signed in as …", options.js). An `id` (oid/sub) was
        // stored here and never read by anything — and every field kept here is a field the store's
        // Data usage disclosure has to cover, so an unused one costs a tick for nothing.
        account: claims ? {
          name:  claims.name || "",
          email: claims.preferred_username || claims.email || "",
        } : null,
      };
      await this.setConnection(conn);
      return conn;
    },

    // Returns a valid access token, refreshing in place when close to expiry.
    // Throws if no connection exists or the refresh fails - caller should
    // surface as "reconnect required".
    async getAccessToken() {
      const conn = await this.getConnection();
      if (!conn?.access_token) throw new Error("Not connected to Microsoft");
      if (conn.expires_at && Date.now() < conn.expires_at) return conn.access_token;
      if (!conn.refresh_token) throw new Error("Microsoft session expired - reconnect");

      const body = new URLSearchParams({
        client_id: CLIENT_ID,
        grant_type: "refresh_token",
        refresh_token: conn.refresh_token,
        scope: "openid profile " + SCOPES,
      });
      const data = await fetchJson(`${AUTHORITY}/oauth2/v2.0/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });
      const updated = {
        ...conn,
        access_token:  data.access_token,
        refresh_token: data.refresh_token || conn.refresh_token,
        expires_at:    Date.now() + ((data.expires_in || 3600) - 60) * 1000,
      };
      await this.setConnection(updated);
      return updated.access_token;
    },
  };
})();
