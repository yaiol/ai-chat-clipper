(() => {
  const NS = (globalThis.AiDoc ||= {});
  const sites = (NS.sites ||= {});

  sites.deepseek = {
    id: "deepseek",
    label: "DeepSeek",
    matches(host) { return host === "chat.deepseek.com"; },

    title() {
      return document.title.replace(/\s*[-|]\s*DeepSeek.*$/i, "").trim() || "DeepSeek chat";
    },

    findMessages() {
      const containers = document.querySelectorAll('[class*="_chat_"], [class*="message"]');
      const out = [];
      const seen = new Set();
      for (const c of containers) {
        if (seen.has(c) || Array.from(seen).some(s => s.contains(c))) continue;
        seen.add(c);
        out.push(c);
      }
      return out;
    },

    extractOne(el) {
      const isUser = !!el.querySelector('[class*="user"]') || (el.className || "").includes("user");
      const md = NS.htmlToMarkdown(el);
      if (!md) return null;
      const out = { role: isUser ? "user" : "assistant", markdown: md };
      const time = NS.findMessageTime?.(el);
      if (time) out.time = time;
      return out;
    },

    findMountPoints() {
      const bars = document.querySelectorAll('._965abe9, [class^="_"][class*="action" i], [class^="_"][class*="toolbar" i]');
      const out = [];
      const seen = new Set();
      for (const bar of bars) {
        if (seen.has(bar)) continue;
        seen.add(bar);
        // Walk up until we find an ancestor whose textContent is substantially larger
        // than the action bar's own text - that's the message body wrapper.
        const barLen = (bar.textContent || "").trim().length;
        let msg = bar.parentElement;
        let depth = 0;
        while (msg && depth < 8) {
          const msgLen = (msg.textContent || "").trim().length;
          if (msgLen > barLen + 30) break;
          msg = msg.parentElement;
          depth++;
        }
        if (!msg) msg = bar.parentElement || bar;
        out.push({ bar, msg });
      }
      return out;
    },

    getConversationId() {
      return location.pathname.match(/\/a\/chat\/s\/([a-f0-9-]+)/)?.[1] || null;
    },

    getUserToken() {
      try {
        const raw = localStorage.getItem("userToken");
        return raw ? JSON.parse(raw)?.value || null : null;
      } catch { return null; }
    },

    async fetchConversation(id, token) {
      const r = await fetch(`/api/v0/chat/history_messages?chat_session_id=${id}&cache_version=0`, {
        credentials: "include",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` }
      });
      if (!r.ok) throw new Error(`DeepSeek API ${r.status}`);
      return NS.debug.json(r, "deepseek");
    },

    linearize(data) {
      const msgs = data?.data?.biz_data?.chat_messages || [];
      const session = data?.data?.biz_data?.chat_session;
      const byId = new Map();
      for (const m of msgs) byId.set(m.message_id, m);
      let cur = session?.current_message_id;
      const chain = [];
      const guard = new Set();
      while (cur != null && !guard.has(cur)) {
        guard.add(cur);
        const m = byId.get(cur);
        if (!m) break;
        chain.push(m);
        cur = m.parent_id;
      }
      chain.reverse();
      const out = [];
      for (const m of chain) {
        if (m.status !== "FINISHED") continue;
        const role = m.role === "USER" ? "user" : "assistant";
        const parts = [];
        if (m.thinking_content?.trim()) {
          parts.push(`> **Thinking**\n> \n> ${m.thinking_content.trim().replace(/\n/g, "\n> ")}`);
        }
        if (m.files?.length) {
          parts.push(m.files.map(f => `*[file: ${f.file_name}]*`).join("\n"));
        }
        if (m.content?.trim()) parts.push(m.content);
        const md = parts.join("\n\n").trim();
        if (md) {
          const entry = { role, markdown: md };
          // DeepSeek uses inserted_at - Unix ms (per reference extension).
          if (m.inserted_at) entry.time = m.inserted_at;
          out.push(entry);
        }
      }
      return out;
    },

    async extract() {
      const title = this.title();
      const id = this.getConversationId();
      const token = this.getUserToken();
      if (id && token) {
        try {
          const data = await this.fetchConversation(id, token);
          const messages = this.linearize(data);
          const apiTitle = data?.data?.biz_data?.chat_session?.title;
          if (messages.length) {
            return { title: apiTitle || title, url: location.href, site: "deepseek", messages };
          }
        } catch (err) {
          console.warn(NS.TAG, "DeepSeek API extract failed, falling back to DOM:", err);
        }
      }
      const messages = [];
      for (const n of this.findMessages()) {
        const one = this.extractOne(n);
        if (one) messages.push(one);
      }
      return { title, url: location.href, site: "deepseek", messages };
    }
  };
})();
