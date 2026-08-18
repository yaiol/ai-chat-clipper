(() => {
  const NS = (globalThis.AiDoc ||= {});
  const sites = (NS.sites ||= {});

  sites.claude = {
    id: "claude",
    label: "Claude",
    matches(host) { return host === "claude.ai"; },

    title() {
      return document.title.replace(/\s*[-|]\s*Claude.*$/i, "").trim() || "Claude chat";
    },

    findMessages() {
      const userNodes = document.querySelectorAll('[data-testid="user-message"]');
      const assistantNodes = document.querySelectorAll('.font-claude-response, .font-claude-message, [data-is-streaming]');
      const tagged = [];
      for (const el of userNodes) { el.dataset.adxRole = "user"; tagged.push(el); }
      for (const el of assistantNodes) { el.dataset.adxRole = "assistant"; tagged.push(el); }
      tagged.sort((a, b) => {
        const pos = a.compareDocumentPosition(b);
        if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
        if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
        return 0;
      });
      return tagged;
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

    findMountPoints() {
      const MSG_SEL = '.font-claude-response, .font-claude-message, [data-testid="user-message"]';
      const copies = document.querySelectorAll('button[data-testid*="action-bar-copy"]');
      const out = [];
      for (const c of copies) {
        const bar = c.parentElement?.parentElement;
        if (!bar) continue;

        // Primary: ascend from the copy button to its enclosing message bubble.
        // Claude usually renders the action bar inside the assistant message,
        // so closest() returns the right one. The sibling-walk below used to
        // be the only strategy and it skipped checking the bar's own
        // ancestors - so it walked past the assistant message and landed on
        // the previous turn's user message (root cause of the "inline export
        // on Claude returns the prior user message" bug).
        let msg = c.closest(MSG_SEL);

        // Fallback: action bar is a sibling-of-message (toolbar below a bubble).
        if (!msg) {
          let node = bar;
          while (node && node !== document.body && !msg) {
            let sib = node.previousElementSibling;
            while (sib) {
              const found = sib.matches?.(MSG_SEL) ? sib : sib.querySelector?.(MSG_SEL);
              if (found) { msg = found; break; }
              sib = sib.previousElementSibling;
            }
            node = node.parentElement;
          }
        }

        if (!msg) msg = bar; // last-ditch fallback - keeps the menu visible at least
        msg.dataset.adxRole = msg.matches?.('[data-testid="user-message"]') ? "user" : "assistant";
        out.push({ bar, msg });
      }
      return out;
    },

    getConversationId() {
      return location.pathname.match(/\/chat\/([a-f0-9-]+)/)?.[1] || null;
    },

    getOrganizationId() {
      return document.cookie.match(/lastActiveOrg=([^;]+)/)?.[1] || null;
    },

    async fetchConversation(orgId, convId) {
      const url = `/api/organizations/${orgId}/chat_conversations/${convId}?tree=True&rendering_mode=messages&render_all_tools=true`;
      const r = await fetch(url, { credentials: "include", headers: { "Accept": "*/*" } });
      if (!r.ok) throw new Error(`Claude API ${r.status}`);
      return NS.debug.json(r, "claude");
    },

    // Render a visual artifact (SVG from the built-in `artifacts` tool or an MCP
    // visualization widget) as a data-URL image so it survives to every export:
    // md-to-html un-escapes `![](…)` images, and json.js splits it as an `image`
    // segment. Non-SVG (HTML) widgets are kept as a fenced ```html block rather
    // than dropped. Returns null when there's nothing renderable.
    renderVisual(code, title) {
      const c = (code || "").trim();
      if (!c) return null;
      const cap = title ? `${title}` : "image";
      if (/^<svg[\s>]/i.test(c)) {
        // encodeURIComponent leaves ( and ) unescaped, but markdown image
        // syntax `![](url)` ends at the first unescaped `)` — an SVG with
        // `rotate(…)` / `rgba(…)` split mid-URL and broke the image (the
        // truncated-sheep bug, 2026-07-21). Encode parens manually, same as
        // chatgpt.js svgToDataUrl.
        const encoded = encodeURIComponent(c).replace(/\(/g, "%28").replace(/\)/g, "%29");
        return `![${cap}](data:image/svg+xml;charset=utf-8,${encoded})`;
      }
      if (/^<(?:!doctype|html|div|section|main|article|body)[\s>]/i.test(c)) {
        return `${title ? `**${title}**\n\n` : ""}\`\`\`html\n${c}\n\`\`\``;
      }
      return null;
    },

    linearize(data) {
      const out = [];
      const all = data.chat_messages || [];
      // Claude conversations are a TREE (edits/retries create sibling branches).
      // Walk from the current leaf up to the root via parent_message_uuid to get
      // ONLY the active branch — a flat index sort includes dead branches, which
      // duplicated the retried user turn and pulled in aborted empty replies.
      const byUuid = new Map(all.map(m => [m.uuid, m]));
      let chain = null;
      const leaf = data.current_leaf_message_uuid;
      if (leaf && byUuid.has(leaf)) {
        chain = [];
        const seen = new Set();
        let cur = byUuid.get(leaf);
        while (cur && !seen.has(cur.uuid)) {
          seen.add(cur.uuid);
          chain.push(cur);
          cur = byUuid.get(cur.parent_message_uuid);
        }
        chain.reverse();
      }
      const msgs = chain || [...all].sort((a, b) => a.index - b.index);
      for (const m of msgs) {
        if (m.truncated) continue;
        const role = m.sender === "human" ? "user" : "assistant";
        const parts = [];
        // User-uploaded image files
        if (role === "user" && m.files?.length) {
          for (const f of m.files) {
            if (f.file_kind === "image") {
              const rel = f.preview_url || f.thumbnail_url
                       || f.preview_asset?.url || f.thumbnail_asset?.url;
              if (rel) {
                const url = /^https?:/.test(rel) ? rel : `https://claude.ai${rel}`;
                parts.push(`![${f.file_name || ""}](${url})`);
              } else if (f.file_name) {
                parts.push(`*[image: ${f.file_name}]*`);
              }
            }
          }
        }
        // Text-file attachments (Claude inlines extracted_content)
        if (role === "user" && m.attachments?.length) {
          for (const a of m.attachments) {
            if (a.extracted_content) parts.push(a.extracted_content);
            else if (a.file_name) parts.push(`*[attachment: ${a.file_name}]*`);
          }
        }
        for (const c of (m.content || [])) {
          if (c.type === "text" && c.text?.trim()) {
            parts.push(c.text);
          } else if (c.type === "thinking" && c.thinking?.trim()) {
            parts.push(`> **Thinking**\n> \n> ${c.thinking.trim().replace(/\n/g, "\n> ")}`);
          } else if (c.type === "tool_use" && c.name === "artifacts" && c.input?.content) {
            // An SVG (or HTML) artifact is a picture, not code — render it.
            const type = c.input.type || c.input.language || "";
            const visual = /svg|html/i.test(type) ? this.renderVisual(c.input.content, c.input.title) : null;
            if (visual) {
              parts.push(visual);
            } else {
              const lang = c.input.language || c.input.type || "text";
              const title = c.input.title ? `**${c.input.title}**\n\n` : "";
              parts.push(`${title}\`\`\`${lang}\n${c.input.content}\n\`\`\``);
            }
          } else if (c.type === "tool_use" && c.input?.widget_code) {
            // MCP visualization widgets (e.g. visualize:show_widget) carry the
            // drawing in input.widget_code, not input.content.
            const visual = this.renderVisual(c.input.widget_code, c.input.title);
            if (visual) parts.push(visual);
          }
        }
        const md = parts.join("\n\n").trim();
        if (md) {
          const entry = { role, markdown: md };
          // Claude returns ISO-8601 strings; html.js's formatTime handles them.
          if (m.created_at) entry.time = m.created_at;
          out.push(entry);
        }
      }
      return out;
    },

    async extract() {
      const title = this.title();
      const convId = this.getConversationId();
      const orgId = this.getOrganizationId();
      if (convId && orgId) {
        try {
          const data = await this.fetchConversation(orgId, convId);
          const messages = this.linearize(data);
          if (messages.length) {
            return { title: data.name || title, url: location.href, site: "claude", messages };
          }
        } catch (err) {
          console.warn(NS.TAG, "Claude API extract failed, falling back to DOM:", err);
        }
      }
      const messages = [];
      for (const n of this.findMessages()) {
        const one = this.extractOne(n);
        if (one) messages.push(one);
      }
      return { title, url: location.href, site: "claude", messages };
    }
  };
})();
