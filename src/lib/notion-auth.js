// Notion OAuth + connection storage.
//
// Public OAuth flow. The `client_secret` lives only on the server
// (api.yaiol.com/notion/exchange) - the extension never sees it. This module
// does the launchWebAuthFlow round-trip, posts the captured `code` to the
// exchange endpoint, and persists the resulting access token + workspace
// metadata + chosen parent page in chrome.storage.local.
//
// Storage layout under adx_notion:
//   { access_token, workspace_id, workspace_name, workspace_icon, bot_id,
//     parent_page_id, parent_page_title }

(() => {
  const NS = (globalThis.AiDoc ||= {});

  const NOTION_CLIENT_ID = "35cd872b-594c-8164-b838-0037ea0a13fd";
  const NOTION_AUTHORIZE = "https://api.notion.com/v1/oauth/authorize";
  const EXCHANGE_URL = "https://api.yaiol.com/notion/exchange";
  const STORAGE_KEY = "adx_notion";

  // Chrome's launchWebAuthFlow accepts a redirect URI of the form
  // https://<extension-id>.chromiumapp.org/<anything> - Chrome closes the
  // tab when the redirect lands and hands the URL back to us.
  function getRedirectUri() {
    return `https://${chrome.runtime.id}.chromiumapp.org/notion`;
  }

  NS.notion = {
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

    async patchConnection(patch) {
      const cur = (await this.getConnection()) || {};
      await this.setConnection({ ...cur, ...patch });
    },

    async clearConnection() {
      await new Promise((res) => chrome.storage.local.remove(STORAGE_KEY, res));
    },

    // Launch the user's browser through Notion's consent screen, capture the
    // returned auth code, swap it for an access token via the server.
    // Resolves with the connection object stored.
    async connectInteractive() {
      const redirect_uri = getRedirectUri();
      const authUrl = `${NOTION_AUTHORIZE}?` +
        `client_id=${encodeURIComponent(NOTION_CLIENT_ID)}` +
        `&response_type=code` +
        `&owner=user` +
        `&redirect_uri=${encodeURIComponent(redirect_uri)}`;

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
      const code = u.searchParams.get("code");
      const errParam = u.searchParams.get("error");
      if (errParam) throw new Error(`Notion: ${errParam}`);
      if (!code) throw new Error("No code in OAuth redirect");

      const r = await fetch(EXCHANGE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, redirect_uri }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.access_token) {
        throw new Error(data.error_description || data.detail || data.error || `Exchange failed (${r.status})`);
      }

      const conn = {
        access_token:   data.access_token,
        workspace_id:   data.workspace_id,
        workspace_name: data.workspace_name,
        workspace_icon: data.workspace_icon,
        bot_id:         data.bot_id,
        // parent_page_id / parent_page_title set later via picker
      };
      await this.setConnection(conn);
      return conn;
    },

    // Fetch the list of pages the integration has access to. Notion's
    // /v1/search endpoint, scoped to type=page; results are sorted by
    // last_edited_time desc by default.
    async listAccessiblePages(token) {
      const r = await fetch("https://api.notion.com/v1/search", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json",
          "Notion-Version": "2022-06-28",
        },
        body: JSON.stringify({
          filter: { value: "page", property: "object" },
          page_size: 100,
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.message || `Search failed (${r.status})`);
      // Map to a friendly { id, title, url } shape.
      const out = [];
      for (const p of (data.results || [])) {
        if (p.object !== "page" || p.archived) continue;
        // Title can live on different properties depending on the page type.
        let title = "(Untitled)";
        const props = p.properties || {};
        for (const k of Object.keys(props)) {
          const prop = props[k];
          if (prop?.type === "title" && prop.title?.length) {
            title = prop.title.map(t => t.plain_text || "").join("");
            break;
          }
        }
        out.push({ id: p.id, title, url: p.url });
      }
      return out;
    },
  };
})();
