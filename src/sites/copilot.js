(() => {
  const NS = (globalThis.AiDoc ||= {});
  const sites = (NS.sites ||= {});

  const API_BASE = "https://copilot.microsoft.com/c/api";

  function findInStorage(storage, predicate) {
    try {
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (!key || !predicate(key)) continue;
        const raw = storage.getItem(key);
        if (raw) {
          try { return JSON.parse(raw); } catch { /* ignore */ }
        }
      }
    } catch { /* ignore */ }
    return null;
  }

  // Copilot switched auth from Auth0 to MSAL (found 2026-07-21: the Auth0 scan
  // came up empty, the API answered 200 with empty results, and every export
  // silently degraded to the DOM). MSAL keeps access tokens in localStorage
  // under keys containing "accesstoken"; the chat-API one has
  // target "…/ChatAI.ReadWrite" and the JWT in `secret`. Verified live:
  // cookie-only → results:[], with `Authorization: Bearer <secret>` → full convo.
  function extractMsalToken() {
    let best = null;
    for (const store of [localStorage, sessionStorage]) {
      try {
        for (let i = 0; i < store.length; i++) {
          const k = store.key(i);
          if (!k || !k.includes("accesstoken")) continue;
          let v;
          try { v = JSON.parse(store.getItem(k)); } catch { continue; }
          if (v?.credentialType !== "AccessToken" || typeof v.secret !== "string") continue;
          if (!/chatai\.readwrite/i.test(v.target || "")) continue;
          const exp = Number(v.expiresOn) || 0;
          if (!best || exp > best.exp) best = { v, exp };
        }
      } catch { /* ignore */ }
    }
    return best ? `${best.v.tokenType || "Bearer"} ${best.v.secret}` : null;
  }

  // Legacy Auth0 storage entry (pre-2026-07 sessions) — kept as fallback.
  function extractAccessToken() {
    const msal = extractMsalToken();
    if (msal) return msal;
    const pred = k => k.includes("@@auth0spajs@@")
                  && k.includes("copilot.microsoft.com::openid")
                  && k.includes("offline_access");
    const rec = findInStorage(localStorage, pred) || findInStorage(sessionStorage, pred);
    const token = rec?.body?.access_token;
    const type = rec?.body?.token_type || "Bearer";
    return token ? `${type} ${token}` : null;
  }

  function extractUserIdentityType() {
    const pred = k => k.includes("@@auth0spajs@@") && k.includes("@@user@@");
    const rec = findInStorage(localStorage, pred) || findInStorage(sessionStorage, pred);
    const sub = rec?.decodedToken?.user?.sub;
    if (typeof sub !== "string" || !sub) return null;
    const dash = sub.indexOf("-");
    if (dash > 0) return sub.slice(0, dash);
    const pipe = sub.indexOf("|");
    if (pipe > 0) return sub.slice(0, pipe);
    return null;
  }

  function getAuthHeaders() {
    const h = { "Accept": "*/*", "Content-Type": "application/json" };
    const token = extractAccessToken();
    if (token) h["Authorization"] = token;
    const uit = extractUserIdentityType();
    if (uit) h["X-Useridentitytype"] = uit;
    // No token found = the API will answer 200 with empty results and the
    // export silently degrades to the DOM. Stash which auth-looking storage
    // KEY NAMES exist (never values) so a debug bundle shows whether Copilot
    // moved its Auth0 entry (the empty-API case, 2026-07-21).
    if (!token && NS.debug) {
      const keys = [];
      for (const store of [localStorage, sessionStorage]) {
        try {
          for (let i = 0; i < store.length; i++) {
            const k = store.key(i);
            if (k && /auth|token|msal|oidc/i.test(k)) keys.push(k);
          }
        } catch { /* ignore */ }
      }
      NS.debug.stash("copilot", JSON.stringify({ no_auth_token: true, auth_like_storage_keys: keys }));
    }
    return h;
  }

  async function fetchConversationsList() {
    const r = await fetch(`${API_BASE}/conversations?types=group%2Cchat`, {
      method: "GET", credentials: "include", headers: getAuthHeaders()
    });
    if (!r.ok) return null;
    return NS.debug.json(r, "copilot");
  }

  async function fetchHistory(id) {
    const r = await fetch(`${API_BASE}/conversations/${id}/history?api-version=2`, {
      method: "GET", credentials: "include", headers: getAuthHeaders()
    });
    if (!r.ok) throw new Error(`Copilot API ${r.status}`);
    return NS.debug.json(r, "copilot");
  }

  function processContent(items) {
    const parts = [];
    const thinking = [];
    let imageUrl, imageAlt;
    for (const it of items || []) {
      if (it.type === "text" && it.text?.trim()) {
        // Unwrap Guided Links — `[label](ca://s?q=…)` is Copilot's internal
        // follow-up protocol; the href is dead outside the app, keep the label.
        parts.push(it.text.trim().replace(/\[([^\]]*)\]\(ca:\/\/[^)]*\)/g, "$1"));
      } else if (it.type === "chainOfThought" && it.text?.trim()) {
        // Copilot's reasoning trace — exported via the shared `> **Thinking**`
        // convention (same as chatgpt/deepseek), so stripThinking + the JSON
        // exporter's typed `thinking` segment both pick it up.
        thinking.push(it.text.trim());
      } else if (it.type === "citation") {
        const title = it.title || it.url || "source";
        parts.push(`[${title}](${it.url})`);
      } else if (it.type === "image" && !imageUrl && it.url) {
        // `url` is the full-size render; `thumbnailUrl` the ?w= variant.
        // The generation prompt doubles as alt text.
        imageUrl = it.url;
        imageAlt = it.prompt || "";
      }
    }
    return { text: parts.join("\n\n"), thinking: thinking.join("\n\n"), imageUrl, imageAlt };
  }

  // DOM-fallback scrape of one message node — used only when the API path
  // yields nothing (e.g. no auth token). Structure verified live 2026-07-21:
  //   [data-content="ai-message"] > [ div (h6.sr-only "Copilot said"),
  //                                   [data-testid="ai-message-body"],
  //                                   div.mt-3 (action bar, "Edit in a page") ]
  // Code block: wrapper > [ header (span.capitalize lang + copy button),
  //                         scroller > pre ].
  // Citation chips ("ESA/Webb"), "Show all", copy — all <button>s. All chrome
  // is stripped structurally, never by (language-dependent) label text.
  function domMessageMarkdown(node) {
    const body = node.querySelector('[data-testid="ai-message-body"]') || node;
    const clone = body.cloneNode(true);
    // Code blocks: lift the header's language onto <code> as language-<lang>
    // (htmlToMarkdown reads it for the fence), then drop the header. The
    // header is a short button-carrying child (lang span + copy button) of an
    // ancestor up to 3 levels above the pre (pre → scroller → rounded-b →
    // rounded-xl, header under rounded-xl — verified live 2026-07-21).
    for (const pre of clone.querySelectorAll("pre")) {
      let wrap = pre.parentElement;
      for (let d = 0; d < 3 && wrap; d++, wrap = wrap.parentElement) {
        const header = [...wrap.children].find(ch =>
          !ch.contains(pre) && ch.querySelector("button") && ch.textContent.trim().length < 40);
        if (!header) continue;
        const lang = header.querySelector("span")?.textContent.trim();
        const code = pre.querySelector("code");
        if (lang && code && /^[\w+#-]{1,20}$/.test(lang)) code.classList.add(`language-${lang.toLowerCase()}`);
        header.remove();
        break;
      }
    }
    // Buttons are UI (copy, citation chips, show-all, edit-in-page);
    // sr-only / data-copy="false" is Copilot's own not-content marker.
    clone.querySelectorAll('button, .sr-only, [data-copy="false"]').forEach(e => e.remove());
    let md = NS.htmlToMarkdown(clone);
    // Collapse a thumb+full pair of the same generated image (same URL ± query),
    // seen transiently right after generation. Keep the query-less full render.
    md = md.replace(/!\[([^\]]*)\]\(([^)?\s]+)\?[^)]*\)\s*\n+\s*!\[[^\]]*\]\(\2\)/g, "![$1]($2)");
    md = md.replace(/!\[([^\]]*)\]\(([^)?\s]+)\)\s*\n+\s*!\[[^\]]*\]\(\2\?[^)]*\)/g, "![$1]($2)");
    return md;
  }

  sites.copilot = {
    id: "copilot",
    label: "Copilot",
    matches(host) { return host === "copilot.microsoft.com"; },

    title() {
      return document.title.replace(/\s*[-|]\s*Copilot.*$/i, "").trim() || "Copilot chat";
    },

    getConversationId() {
      return location.pathname.match(/\/chats\/([^/?#]+)/)?.[1] || null;
    },

    async extract() {
      const fallbackTitle = this.title();
      const id = this.getConversationId();
      if (id) {
        try {
          let title = fallbackTitle;
          try {
            const list = await fetchConversationsList();
            const match = list?.results?.find(r => r.id === id);
            if (match?.title) title = match.title;
          } catch { /* title fallback ok */ }

          const data = await fetchHistory(id);
          const raw = [...(data.results || [])].reverse();
          const messages = [];
          for (const m of raw) {
            const role = m.author?.type === "human" ? "user" : "assistant";
            const { text, thinking, imageUrl, imageAlt } = processContent(m.content || []);
            const parts = [];
            if (thinking) parts.push(`> **Thinking**\n> \n> ${thinking.replace(/\n/g, "\n> ")}`);
            if (imageUrl) parts.push(`![${imageAlt || ""}](${imageUrl})`);
            // Prose \[…\]/\(…\) → $$/$ so math renders (code fences untouched).
            if (text) parts.push(NS.normalizeLatexDelimiters(text));
            const md = parts.join("\n\n").trim();
            if (md) {
              const entry = { role, markdown: md };
              if (m.createdAt) entry.time = m.createdAt;
              messages.push(entry);
            }
          }
          if (messages.length) {
            return { title, url: location.href, site: "copilot", messages };
          }
        } catch (err) {
          console.warn(NS.TAG, "Copilot API extract failed, falling back to DOM:", err);
        }
      }
      // DOM fallback - best-effort scrape (math stays degraded: Copilot's
      // KaTeX carries no application/x-tex annotation to recover from).
      const messages = [];
      const nodes = document.querySelectorAll('[data-content="user-message"], [data-content="ai-message"]');
      for (const n of nodes) {
        const role = n.getAttribute("data-content") === "user-message" ? "user" : "assistant";
        const md = domMessageMarkdown(n);
        if (md) messages.push({ role, markdown: md });
      }
      return { title: fallbackTitle, url: location.href, site: "copilot", messages };
    },

    findMountPoints() {
      const anchors = document.querySelectorAll(
        'button[data-testid="copy-ai-message-button"], ' +
        'button[data-testid="copy-user-message-button"]'
      );
      const out = [];
      const seen = new Set();
      for (const a of anchors) {
        const bar = a.parentElement?.parentElement;
        if (!bar || seen.has(bar)) continue;
        seen.add(bar);
        const role = a.getAttribute("data-testid") === "copy-user-message-button" ? "user" : "assistant";
        const msg = a.closest('[data-content]') || bar.parentElement || bar;
        msg.dataset.adxRole = role;
        out.push({ bar, msg });
      }
      return out;
    },

    extractOne(el) {
      const role = el.dataset.adxRole
        || (el.getAttribute?.("data-content") === "user-message" ? "user" : "assistant");
      const md = domMessageMarkdown(el);
      if (!md) return null;
      const out = { role: role, markdown: md };
      const time = NS.findMessageTime?.(el);
      if (time) out.time = time;
      return out;
    },

    findMessages() {
      return document.querySelectorAll('[data-content="user-message"], [data-content="ai-message"]');
    }
  };
})();
