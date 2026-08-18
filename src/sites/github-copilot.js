(() => {
  const NS = (globalThis.AiDoc ||= {});
  const sites = (NS.sites ||= {});

  sites["github-copilot"] = {
    id: "github-copilot",
    label: "GitHub Copilot",
    matches(host) { return host === "github.com" && /^\/copilot(\/|$)/.test(location.pathname); },

    title() {
      return document.title.replace(/\s*[-|·]\s*GitHub.*$/i, "").trim() || "GitHub Copilot chat";
    },

    // URL: /copilot/c/<threadId>
    getConversationId() {
      return location.pathname.match(/\/copilot\/c\/([a-f0-9-]+)/)?.[1] || null;
    },

    getAuthToken() {
      try {
        const raw = localStorage.getItem("COPILOT_AUTH_TOKEN");
        return raw ? JSON.parse(raw)?.value || null : null;
      } catch { return null; }
    },

    async fetchMessages(threadId, token) {
      const url = `https://api.individual.githubcopilot.com/github/chat/threads/${threadId}/messages`;
      const r = await fetch(url, {
        method: "GET",
        credentials: "same-origin",
        headers: {
          "Authorization": `GitHub-Bearer ${token}`,
          "Cache-Control": "max-age=0",
          "X-Github-Api-Version": "2025-05-01",
          "Copilot-Integration-Id": "copilot-chat"
        }
      });
      if (!r.ok) throw new Error(`GitHub Copilot API ${r.status}`);
      return NS.debug.json(r, "github-copilot");
    },

    linearize(data) {
      const raw = [...(data.messages || [])].sort(
        (a, b) => new Date(a.createdAt) - new Date(b.createdAt)
      );
      const out = [];
      for (const m of raw) {
        const role = m.role === "user" ? "user" : "assistant";
        const md = (m.content || "").trim();
        if (md) {
          const entry = { role, markdown: md };
          if (m.createdAt) entry.time = m.createdAt;
          out.push(entry);
        }
      }
      return out;
    },

    async extract() {
      const fallbackTitle = this.title();
      const id = this.getConversationId();
      const token = this.getAuthToken();
      if (id && token) {
        try {
          const data = await this.fetchMessages(id, token);
          const messages = this.linearize(data);
          if (messages.length) {
            return {
              title: data.thread?.name || fallbackTitle,
              url: location.href,
              site: "github-copilot",
              messages
            };
          }
        } catch (err) {
          console.warn(NS.TAG, "GitHub Copilot API extract failed, falling back to DOM:", err);
        }
      }
      // DOM fallback
      const messages = [];
      for (const el of this.findMessages()) {
        const one = this.extractOne(el);
        if (one) messages.push(one);
      }
      return { title: fallbackTitle, url: location.href, site: "github-copilot", messages };
    },

    findMessages() {
      return document.querySelectorAll(
        'react-app[app-name*="copilot"] [class*="ChatMessage-module__"], ' +
        '[class*="ChatMessage-module__"]'
      );
    },

    extractOne(el) {
      const cls = (el.className || "").toString();
      const role = /user|human/i.test(cls) ? "user" : "assistant";
      const body = el.querySelector('[class*="ChatMessage-module__content"]') || el;
      const md = NS.htmlToMarkdown(body);
      if (!md) return null;
      const out = { role: role, markdown: md };
      const time = NS.findMessageTime?.(el);
      if (time) out.time = time;
      return out;
    },

    findMountPoints() {
      // Reference: react-app[app-name*="copilot"] [class*=ChatMessage-module__actions][data-testid="nonshared-toolbar"]
      const bars = document.querySelectorAll(
        'react-app[app-name*="copilot"] [class*="ChatMessage-module__actions"][data-testid="nonshared-toolbar"], ' +
        '[class*="ChatMessage-module__actions"][data-testid="nonshared-toolbar"], ' +
        '[class*="ChatMessage-module__actions"]'
      );
      const out = [];
      const seen = new Set();
      for (const bar of bars) {
        if (seen.has(bar)) continue;
        seen.add(bar);
        const msg = bar.closest('[class*="ChatMessage-module__"]') || bar.parentElement || bar;
        out.push({ bar, msg });
      }
      return out;
    }
  };
})();
