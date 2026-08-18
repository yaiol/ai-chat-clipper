(() => {
  const NS = (globalThis.AiDoc ||= {});
  const sites = (NS.sites ||= {});

  // HuggingFace Chat (chat-ui, open source) - SvelteKit app at huggingface.co/chat.
  // Each message is rendered as a Tailwind-styled article. We use a DOM-only
  // strategy: anchor on the Copy action button, walk up to find the message body.
  // The page also exposes message data via `/chat/conversation/<id>/__data.json`,
  // but the schema changes between chat-ui releases - sticking to DOM is safer.

  sites.huggingchat = {
    id: "huggingchat",
    label: "HuggingChat",
    matches(host) { return host === "huggingface.co" && location.pathname.startsWith("/chat"); },

    title() {
      return document.title.replace(/\s*[-|·]\s*HuggingChat.*$/i, "")
                          .replace(/\s*[-|·]\s*Hugging Face.*$/i, "")
                          .trim() || "HuggingChat";
    },

    getConversationId() {
      return location.pathname.match(/\/chat\/(?:conversation\/)?([A-Za-z0-9_-]+)/)?.[1] || null;
    },

    _copyButtons() {
      return document.querySelectorAll(
        'button[aria-label*="Copy" i], ' +
        'button[title*="Copy" i], ' +
        'button[data-tooltip*="Copy" i]'
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
      // Check for human/user data attributes / classes nearby
      if (msg.querySelector?.('[class*="human" i], [data-from*="user" i], [class*="userMessage" i]')) return "user";
      // If the action bar has only a Copy button (and not Retry/Regenerate), it's likely a user message
      const labels = Array.from(bar.querySelectorAll("button, [role='button']")).map(
        b => (b.getAttribute("aria-label") || b.getAttribute("title") || "").toLowerCase()
      );
      if (labels.some(l => /retry|regenerate|continue|read aloud/.test(l))) return "assistant";
      if (labels.some(l => /^edit$|edit prompt|edit message/.test(l))) return "user";
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
      return { title, url: location.href, site: "huggingchat", messages };
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
