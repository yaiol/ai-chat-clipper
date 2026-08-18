(() => {
  const NS = (globalThis.AiDoc ||= {});
  const sites = (NS.sites ||= {});

  sites.poe = {
    id: "poe",
    label: "Poe",
    matches(host) { return host === "poe.com" || host === "www.poe.com"; },

    title() {
      return document.title.replace(/\s*[-|]\s*Poe.*$/i, "").trim() || "Poe chat";
    },

    getConversationId() {
      return location.pathname.match(/\/chat\/([^/?#]+)/)?.[1] || null;
    },

    _actionBars() {
      // Poe uses CSS-module class hashes; target the stable prefix.
      return document.querySelectorAll('[class*="ChatMessageActionBar_actionBar"]');
    },

    _findMsgElement(bar) {
      // Walk up until we reach the message wrapper (usually a class containing "ChatMessage_").
      let node = bar.parentElement;
      let depth = 0;
      while (node && depth < 10) {
        const cls = node.className || "";
        if (/ChatMessage_(chatMessage|humanBubble|botBubble|bubble)/i.test(cls)) return node;
        node = node.parentElement;
        depth++;
      }
      // Fallback to textContent-heavy ancestor
      const barLen = (bar.textContent || "").trim().length;
      node = bar.parentElement;
      depth = 0;
      while (node && depth < 10) {
        const len = (node.textContent || "").trim().length;
        if (len > barLen + 30) return node;
        node = node.parentElement;
        depth++;
      }
      return bar.parentElement || bar;
    },

    _roleFromMsg(msg) {
      const cls = msg.className || "";
      if (/humanBubble|HumanMessage|_user|userMessage/i.test(cls)) return "user";
      // Check descendants / ancestors for human markers
      if (msg.querySelector?.('[class*="humanBubble" i], [class*="HumanMessage" i]')) return "user";
      if (msg.closest?.('[class*="humanBubble" i], [class*="HumanMessage" i]')) return "user";
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
        msg.dataset.adxRole = this._roleFromMsg(msg);
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
      return { title, url: location.href, site: "poe", messages };
    },

    findMountPoints() {
      const out = [];
      for (const bar of this._actionBars()) {
        const msg = this._findMsgElement(bar);
        if (msg) msg.dataset.adxRole = this._roleFromMsg(msg);
        out.push({ bar, msg: msg || bar });
      }
      return out;
    }
  };
})();
