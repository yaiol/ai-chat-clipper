(() => {
  const NS = (globalThis.AiDoc ||= {});
  const sites = (NS.sites ||= {});

  // DuckDuckGo AI Chat - duckduckgo.com/aichat
  // Anonymous wrapper that proxies to major models (GPT-4o-mini, Claude
  // Haiku, Llama, Mixtral). No persistent conversation IDs - chat is bound
  // to a session cookie + ephemeral VQD token. DOM-only adapter; the
  // streaming response endpoint (`/duckchat/v1/chat`) is auth-bound and not
  // worth replicating until the cache layer lands (see ../PLAN-cache.md).

  sites.duckduckgo = {
    id: "duckduckgo",
    label: "DuckDuckGo AI Chat",
    matches(host) {
      return host === "duckduckgo.com" && location.pathname.startsWith("/aichat");
    },

    title() {
      return document.title.replace(/\s*[-|·]\s*DuckDuckGo.*$/i, "").trim()
          || "DuckDuckGo AI Chat";
    },

    // No conversation ID surfaced in the URL by default. Returning null
    // disables the (non-existent) API path; extract() goes straight to DOM.
    getConversationId() {
      return null;
    },

    _copyButtons() {
      return document.querySelectorAll(
        'button[aria-label*="Copy" i], button[title*="Copy" i], ' +
        'button[data-testid*="copy" i]'
      );
    },

    _findMsgElement(bar) {
      const barLen = (bar.textContent || "").trim().length;
      let node = bar.parentElement;
      let depth = 0;
      while (node && depth < 12) {
        const len = (node.textContent || "").trim().length;
        if (len > barLen + 30) return node;
        node = node.parentElement;
        depth++;
      }
      return bar.parentElement || bar;
    },

    _roleFromMsg(msg, bar) {
      const cls = (msg.className || "").toString();
      if (/from-user|user-message|userMessage/i.test(cls)) return "user";
      const labels = Array.from(bar.querySelectorAll("button, [role='button']")).map(
        b => (b.getAttribute("aria-label") || b.getAttribute("title") || "").toLowerCase()
      );
      if (labels.some(l => /retry|regenerate|read aloud/.test(l))) return "assistant";
      if (labels.some(l => /^edit$|edit message/.test(l))) return "user";
      return "assistant";
    },

    findMessages() {
      const bars = this._copyButtons();
      const seen = new Set();
      const out = [];
      for (const c of bars) {
        const bar = c.parentElement;
        if (!bar) continue;
        const msg = this._findMsgElement(bar);
        if (!msg || seen.has(msg)) continue;
        seen.add(msg);
        msg.dataset.adxRole = this._roleFromMsg(msg, bar);
        out.push(msg);
      }
      return out;
    },

    extractOne(el) {
      const role = el.dataset.adxRole || "assistant";
      const md = NS.htmlToMarkdown(el);
      if (!md) return null;
      const out = { role: role, markdown: md };
      const time = NS.findMessageTime?.(el);
      if (time) out.time = time;
      return out;
    },

    async extract() {
      const title = this.title();
      const messages = [];
      for (const el of this.findMessages()) {
        const one = this.extractOne(el);
        if (one) messages.push(one);
      }
      return { title, url: location.href, site: "duckduckgo", messages };
    },

    findMountPoints() {
      const anchors = this._copyButtons();
      const out = [];
      const seenBars = new Set();
      for (const a of anchors) {
        const bar = a.parentElement;
        if (!bar || seenBars.has(bar)) continue;
        seenBars.add(bar);
        const msg = this._findMsgElement(bar);
        if (msg) msg.dataset.adxRole = this._roleFromMsg(msg, bar);
        out.push({ bar, msg: msg || bar });
      }
      return out;
    }
  };
})();
