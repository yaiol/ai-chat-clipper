(() => {
  const NS = (globalThis.AiDoc ||= {});
  const sites = (NS.sites ||= {});

  sites.yuanbao = {
    id: "yuanbao",
    label: "Yuanbao",
    matches(host) { return host === "yuanbao.tencent.com"; },

    title() {
      return document.title.replace(/\s*[-|]\s*(腾讯元宝|Yuanbao).*$/i, "").trim() || "Yuanbao chat";
    },

    // URL: /chat/<agentId>/<conversationId>
    extractIds() {
      const m = location.pathname.match(/\/chat\/([^/]+)\/([^/?#]+)/);
      return m ? { agentId: m[1], conversationId: m[2] } : null;
    },

    getConversationId() {
      return this.extractIds()?.conversationId || null;
    },

    async fetchConversation(agentId, conversationId) {
      const r = await fetch("/api/user/agent/conversation/v1/detail", {
        method: "POST",
        credentials: "include",
        headers: {
          "Accept": "application/json, text/plain, */*",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ agentId, conversationId, limit: 100, offset: 0 })
      });
      if (!r.ok) throw new Error(`Yuanbao API ${r.status}`);
      return NS.debug.json(r, "yuanbao");
    },

    linearize(data) {
      const convs = [...(data.convs || [])].sort((a, b) => a.index - b.index);
      const out = [];
      for (const c of convs) {
        const role = c.speaker === "human" ? "user" : "assistant";
        const parts = [];
        for (const s of (c.speechesV2 || [])) {
          for (const item of (s.content || [])) {
            if (item.type === "text" && item.msg) {
              parts.push(item.msg);
            } else if (item.type === "image" && item.url) {
              parts.push(`![](${item.url})`);
            }
          }
        }
        const md = parts.join("\n\n").trim();
        if (md) {
          const entry = { role, markdown: md };
          // Yuanbao's createTime is Unix seconds - formatTime() in
          // exporters/html.js + select.js auto-detects seconds vs ms.
          if (typeof c.createTime === "number") entry.time = c.createTime;
          out.push(entry);
        }
      }
      return out;
    },

    async extract() {
      const fallbackTitle = this.title();
      const ids = this.extractIds();
      if (ids) {
        try {
          const data = await this.fetchConversation(ids.agentId, ids.conversationId);
          const messages = this.linearize(data);
          if (messages.length) {
            return {
              title: data.title || fallbackTitle,
              url: location.href,
              site: "yuanbao",
              messages
            };
          }
        } catch (err) {
          console.warn(NS.TAG, "Yuanbao API extract failed, falling back to DOM:", err);
        }
      }
      // DOM fallback (best-effort)
      const messages = [];
      const nodes = document.querySelectorAll('[class*="message" i], [class*="conversation" i] [class*="bubble" i]');
      const seen = new Set();
      for (const n of nodes) {
        if (Array.from(seen).some(s => s.contains(n) || n.contains(s))) continue;
        seen.add(n);
        const md = NS.htmlToMarkdown(n);
        if (md) messages.push({ role: "assistant", markdown: md });
      }
      return { title: fallbackTitle, url: location.href, site: "yuanbao", messages };
    },

    findMessages() {
      return document.querySelectorAll('[class*="conv-item"], [class*="message-item"]');
    },

    extractOne(el) {
      const cls = (el.className || "").toString();
      const role = /human|user/i.test(cls) ? "user" : "assistant";
      const md = NS.htmlToMarkdown(el);
      if (!md) return null;
      const out = { role: role, markdown: md };
      const time = NS.findMessageTime?.(el);
      if (time) out.time = time;
      return out;
    },

    findMountPoints() {
      // Anchor on copy button - Yuanbao's UI is in Chinese, label likely "复制"
      const anchors = document.querySelectorAll(
        'button[aria-label*="复制"], ' +
        'button[title*="复制"], ' +
        'button[aria-label*="Copy" i]'
      );
      const out = [];
      const seen = new Set();
      for (const a of anchors) {
        const bar = a.parentElement;
        if (!bar || seen.has(bar)) continue;
        seen.add(bar);
        const barLen = (bar.textContent || "").trim().length;
        let msg = bar.parentElement;
        let depth = 0;
        while (msg && depth < 10) {
          const len = (msg.textContent || "").trim().length;
          if (len > barLen + 30) break;
          msg = msg.parentElement;
          depth++;
        }
        if (!msg) msg = bar.parentElement || bar;
        out.push({ bar, msg });
      }
      return out;
    }
  };
})();
