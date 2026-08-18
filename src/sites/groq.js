(() => {
  const NS = (globalThis.AiDoc ||= {});
  const sites = (NS.sites ||= {});

  // Groq Cloud chat (chat.groq.com) - Next.js / React app. The page exposes
  // each message as a card containing a Copy button; we use the standard
  // copy-button-anchored heuristic (Mistral / Meta AI / HuggingChat pattern).

  sites.groq = {
    id: "groq",
    label: "Groq",
    matches(host) { return host === "chat.groq.com"; },

    title() {
      return document.title.replace(/\s*[-|·]\s*Groq.*$/i, "").trim() || "Groq chat";
    },

    getConversationId() {
      // Possible URL shapes: /chat/<id> or /<id>; fall back to URL search.
      return location.pathname.match(/\/(?:chat\/)?([A-Za-z0-9_-]{6,})/)?.[1] || null;
    },

    // Groq's action toolbar has no aria-labels. Two known shapes:
    //  - Active/visible message:  "flex flex-row align-center items-center gap-1 pt-2"
    //  - Historical / hover-only: "flex ... absolute -bottom-6 right-0"
    _actionBars() {
      return document.querySelectorAll([
        'div[class*="align-center"][class*="items-center"][class*="gap-1"][class*="pt-2"]',
        'div[class*="absolute"][class*="-bottom-6"][class*="right-0"]',
        'div[class*="flex"][class*="flex-row"][class*="absolute"][class*="bottom-"]'
      ].join(", "));
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
      if (/user|human|from-user|userMessage/i.test(cls)) return "user";
      if (msg.querySelector?.('[class*="user" i], [data-from*="user" i]')) return "user";
      const labels = Array.from(bar.querySelectorAll("button, [role='button']")).map(
        b => (b.getAttribute("aria-label") || b.getAttribute("title") || "").toLowerCase()
      );
      if (labels.some(l => /retry|regenerate|read aloud|try again/.test(l))) return "assistant";
      if (labels.some(l => /^edit$|edit prompt|edit message/.test(l))) return "user";
      return "assistant";
    },

    findMessages() {
      const bars = this._actionBars();
      const seen = new Set();
      const out = [];
      for (const bar of bars) {
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
      const out = { role, markdown: md };
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
      return { title, url: location.href, site: "groq", messages };
    },

    findMountPoints() {
      const out = [];
      for (const bar of this._actionBars()) {
        const msg = this._findMsgElement(bar);
        if (msg) msg.dataset.adxRole = this._roleFromMsg(msg, bar);
        out.push({ bar, msg: msg || bar });
      }
      return out;
    }
  };
})();
