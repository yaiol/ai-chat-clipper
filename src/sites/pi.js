(() => {
  const NS = (globalThis.AiDoc ||= {});
  const sites = (NS.sites ||= {});

  // Pi (Inflection) - pi.ai
  // Conversational chat with one persistent thread per user. URL shapes
  // observed: /talk, /talk/<id>, or root with ?conversationId=… . The site's
  // GraphQL API is auth-bound; DOM-only adapter for now (cache-replay path
  // would unlock it - see ../PLAN-cache.md).

  sites.pi = {
    id: "pi",
    label: "Pi",
    matches(host) { return host === "pi.ai" || host === "www.pi.ai"; },

    title() {
      return document.title.replace(/\s*[-|·]\s*Pi.*$/i, "").trim() || "Pi conversation";
    },

    getConversationId() {
      const m = location.search.match(/[?&]conversationId=([^&]+)/);
      if (m) return decodeURIComponent(m[1]);
      return location.pathname.match(/\/talk\/([^/?#]+)/)?.[1] || null;
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
      if (/from-user|user-message|userMessage|me-message/i.test(cls)) return "user";
      const labels = Array.from(bar.querySelectorAll("button, [role='button']")).map(
        b => (b.getAttribute("aria-label") || b.getAttribute("title") || "").toLowerCase()
      );
      // Pi has a distinctive "listen / play voice" action on assistant messages
      if (labels.some(l => /retry|regenerate|listen|play|read aloud/.test(l))) return "assistant";
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
      return { title, url: location.href, site: "pi", messages };
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
