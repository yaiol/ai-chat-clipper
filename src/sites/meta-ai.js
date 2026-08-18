(() => {
  const NS = (globalThis.AiDoc ||= {});
  const sites = (NS.sites ||= {});

  sites["meta-ai"] = {
    id: "meta-ai",
    label: "Meta AI",
    matches(host) { return host === "www.meta.ai" || host === "meta.ai"; },

    title() {
      return document.title.replace(/\s*[-|]\s*Meta.*AI.*$/i, "").trim() || "Meta AI chat";
    },

    getConversationId() {
      return location.pathname.match(/\/(?:c|chat)\/([^/?#]+)/)?.[1] || null;
    },

    _anchorButtons() {
      // Meta AI: assistant bar has "Copier la réponse"; user bar has "Modifier le message".
      return document.querySelectorAll(
        'button[aria-label="Copier la réponse"], ' +
        'button[aria-label="Copy response"], ' +
        'button[aria-label="Modifier le message"], ' +
        'button[aria-label="Edit message"], ' +
        'button[aria-label*="Copy" i], ' +
        'button[aria-label*="Copier" i]'
      );
    },

    _findMsgElement(bar) {
      const barLen = (bar.textContent || "").trim().length;
      let node = bar.parentElement;
      let depth = 0;
      while (node && depth < 15) {
        const len = (node.textContent || "").trim().length;
        if (len > barLen + 30) return node;
        node = node.parentElement;
        depth++;
      }
      return bar.parentElement || bar;
    },

    _roleFromBar(bar) {
      const labels = Array.from(bar.querySelectorAll("button, [role='button']")).map(
        b => (b.getAttribute("aria-label") || "").toLowerCase()
      );
      if (labels.some(l => l.includes("modifier le message") || l.includes("edit message"))) return "user";
      if (labels.some(l => l.includes("copier la réponse") || l.includes("copy response"))) return "assistant";
      return "assistant";
    },

    findMessages() {
      const bars = this._anchorButtons();
      const seen = new Set();
      const out = [];
      for (const c of bars) {
        const bar = c.parentElement;
        if (!bar) continue;
        const msg = this._findMsgElement(bar);
        if (!msg || seen.has(msg)) continue;
        seen.add(msg);
        msg.dataset.adxRole = this._roleFromBar(bar);
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
      return { title, url: location.href, site: "meta-ai", messages };
    },

    findMountPoints() {
      const anchors = this._anchorButtons();
      const out = [];
      const seenBars = new Set();
      for (const a of anchors) {
        const bar = a.parentElement;
        if (!bar || seenBars.has(bar)) continue;
        seenBars.add(bar);
        const msg = this._findMsgElement(bar);
        if (msg) msg.dataset.adxRole = this._roleFromBar(bar);
        out.push({ bar, msg: msg || bar });
      }
      return out;
    }
  };
})();
