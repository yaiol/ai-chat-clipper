(() => {
  const NS = (globalThis.AiDoc ||= {});
  const sites = (NS.sites ||= {});

  const ROOT_PARENT_ID = "00000000-0000-0000-0000-000000000000";
  const LIST_MESSAGES_PATH = "/apiv2/kimi.gateway.chat.v1.ChatService/ListMessages";

  // Kimi's auth token: a `kimi-auth` cookie when JS-readable, else a bearer
  // stashed in localStorage. May be absent entirely (httpOnly session cookie) —
  // the fetch still sends it via credentials:"include", so a null here is NOT
  // fatal (the old code threw on null, which broke the whole API path whenever
  // the cookie wasn't script-visible).
  function getAuthToken() {
    const m = document.cookie.match(/kimi-auth=([^;]+)/);
    if (m) return `Bearer ${m[1]}`;
    try {
      for (const k of ["kimi-auth", "access_token", "accessToken", "authorization"]) {
        const v = localStorage.getItem(k);
        if (v) return /^Bearer /i.test(v) ? v : `Bearer ${v}`;
      }
    } catch { /* localStorage may be unavailable */ }
    return null;
  }

  function resolveCitations(text, refs) {
    if (!text) return "";
    const chunks = refs?.usedSearchChunks;
    if (!chunks?.length) return text.replace(/\[\^\d+\^\]/g, "");
    const byId = new Map(chunks.map(c => [String(c.id), c]));
    return text.replace(/\[\^(\d+)\^\]/g, (m, n) => {
      const ref = byId.get(n);
      if (!ref) return "";
      const label = ref.base?.siteName || ref.base?.title || n;
      const url = ref.base?.url;
      return url ? `[[${label}](${url})]` : "";
    });
  }

  function extractContent(blocks, refs) {
    const parts = [];
    for (const b of blocks || []) {
      if (b && "text" in b && typeof b.text?.content === "string") {
        const t = b.text.content.trim();
        if (t) parts.push(t);
      }
    }
    const joined = parts.join("\n\n").trim();
    return joined ? resolveCitations(joined, refs) : "";
  }

  function pickBestChild(childIds, byId) {
    if (!childIds?.length) return null;
    if (childIds.length === 1) return childIds[0];
    // Prefer a child whose DOM element exists
    const inDom = childIds.find(id => !!document.querySelector(`[data-message-id="${id}"]`));
    if (inDom) return inDom;
    // Otherwise pick the most recently created
    let best = null;
    for (const id of childIds) {
      const c = byId.get(id);
      if (!c) continue;
      if (!best || new Date(c.createTime) > new Date(best.createTime)) best = c;
    }
    return best?.id || null;
  }

  sites.kimi = {
    id: "kimi",
    label: "Kimi",
    matches(host) {
      return host === "www.kimi.com"
          || host === "kimi.com"
          || host === "kimi.moonshot.cn";
    },

    title() {
      return document.title.replace(/\s*[-|]\s*Kimi.*$/i, "").trim() || "Kimi chat";
    },

    getConversationId() {
      return location.pathname.match(/\/chat\/([a-f0-9-]+)/)?.[1] || null;
    },

    async fetchMessages(chatId) {
      const token = getAuthToken();
      const headers = {
        "accept": "*/*",
        "connect-protocol-version": "1",
        "content-type": "application/json",
        "origin": location.origin,
        "x-language": "zh-CN",
        "x-msh-platform": "web",
        "x-msh-version": "1.0.0"
      };
      // Send the bearer when we have one; otherwise rely on the session cookie
      // (credentials:"include"). Don't hard-fail on a missing readable token.
      if (token) headers.authorization = token;
      const r = await fetch(LIST_MESSAGES_PATH, {
        method: "POST",
        credentials: "include",
        headers,
        body: JSON.stringify({ chat_id: chatId, page_size: 1000 })
      });
      if (!r.ok) throw new Error(`Kimi API ${r.status}`);
      return NS.debug.json(r, "kimi");
    },

    linearize(data) {
      const raw = data?.messages || [];
      const byId = new Map(raw.map(m => [m.id, m]));
      const root = raw.find(m => m.parentId === ROOT_PARENT_ID);
      if (!root) return [];
      const out = [];
      let cur = pickBestChild(root.childrenMessageIds ?? [], byId);
      while (cur) {
        const m = byId.get(cur);
        if (!m) break;
        const ok = (m.role === "user" || m.role === "assistant")
                && m.status === "MESSAGE_STATUS_COMPLETED";
        if (ok) {
          const md = extractContent(m.blocks ?? [], m.refs);
          if (md) {
            const entry = { role: m.role, markdown: md };
            if (m.createTime) entry.time = m.createTime;
            out.push(entry);
          }
        }
        cur = pickBestChild(m.childrenMessageIds ?? [], byId);
      }
      return out;
    },

    async extract() {
      const title = this.title();
      const id = this.getConversationId();
      if (id) {
        try {
          const data = await this.fetchMessages(id);
          const messages = this.linearize(data);
          if (messages.length) {
            return { title, url: location.href, site: "kimi", messages };
          }
        } catch (err) {
          console.warn(NS.TAG, "Kimi API extract failed, falling back to DOM:", err);
        }
      }
      // DOM fallback
      const messages = [];
      for (const el of this.findMessages()) {
        const one = this.extractOne(el);
        if (one) messages.push(one);
      }
      return { title, url: location.href, site: "kimi", messages };
    },

    // DOM extraction — Kimi renders each turn as a `.chat-content-item` with a
    // `-user` / `-assistant` class modifier (there is NO data-message-id /
    // data-role, which is why the old selector found nothing). User text lives
    // in `.user-content`; the assistant answer in `.markdown-container`(s), which
    // are clean (avatar, web-search bar, action buttons, and citations are all
    // outside them). ⚠ Kimi's KaTeX ships no annotation/mathml, so math degrades
    // to rendered glyphs on this path — the API path preserves the `$…$` source.
    findMessages() {
      return document.querySelectorAll(".chat-content-item");
    },

    extractOne(el) {
      const cls = (el.getAttribute("class") || "").toString();
      const role = /assistant/.test(cls) ? "assistant"
                 : /user/.test(cls) ? "user"
                 : (el.dataset.adxRole || "assistant");
      // Assistant answers interleave prose (`.markdown-container`) with
      // tool-generated images (`.ipython-images-list`, e.g. a drawn picture).
      // querySelectorAll returns them in document order so the image lands in
      // its right place. htmlToMarkdown turns each `<img>` into `![alt](src)`.
      let nodes = role === "user"
        ? el.querySelectorAll(".user-content")
        : el.querySelectorAll(".markdown-container, .ipython-images-list");
      if (!nodes.length) nodes = el.querySelectorAll(".segment-content");
      const md = [...nodes].map(n => NS.htmlToMarkdown(n)).filter(Boolean).join("\n\n").trim();
      if (!md) return null;
      const out = { role, markdown: md };
      const time = NS.findMessageTime?.(el);
      if (time) out.time = time;
      return out;
    },

    // ⚠ Kimi's action row holds NO <button> — every control is a
    // `<div class="icon-button">` wrapping an inline `<svg name="Copy">`. The
    // old anchor (`button[aria-label*="Copy"]`, `button[data-testid*=copy]`)
    // therefore matched nothing at all and no icon was ever mounted here.
    // Anchor on the semantic class instead: one `.segment-assistant-actions-content`
    // per assistant turn, present at rest (the parent fades it in on hover —
    // Kimi's own copy button behaves the same way, so ours follows the site).
    // Assistant-only: `.segment-user-actions` is the prompt's edit/copy row.
    findMountPoints() {
      const out = [];
      for (const msg of document.querySelectorAll(".chat-content-item-assistant")) {
        const bar = msg.querySelector(".segment-assistant-actions-content");
        if (bar) out.push({ bar, msg });
      }
      return out;
    }
  };
})();
