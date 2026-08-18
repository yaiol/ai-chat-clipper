(() => {
  const NS = (globalThis.AiDoc ||= {});
  const sites = (NS.sites ||= {});

  // LobeHub (app.lobehub.com) — the hosted LobeChat SaaS.
  // Confirmed live (2026-07-21): tRPC endpoint
  //   GET /trpc/lambda/message.getMessages?batch=1&input=
  //       {"0":{"json":{"agentId":..,"groupId":null,"threadId":null,"topicId":..}}}
  // cookie-auth only (credentials: include, no bearer header). Response:
  //   [ { result: { data: { json: [ <message>, ... ] } } } ]  — chronological.
  // Message: { role: "user"|"assistant"|"tool", content (markdown with
  //   \(..\)/\[..\] math), reasoning: { content } (thinking trace),
  //   imageList/fileList, createdAt }. "tool" turns carry raw tool payloads
  //   (<searchResults>, <crawlResults>, <artifacts_guides>) — internal
  //   protocol, never user-facing; assistant turns that only call a tool have
  //   empty content — both are excluded, matching what the page renders.
  // Artifacts are inline in content:
  //   <lobeArtifact identifier=".." type="image/svg+xml" title=".."><svg…></lobeArtifact>
  sites.lobehub = {
    id: "lobehub",
    label: "LobeHub",
    matches(host) { return host === "app.lobehub.com"; },

    title() {
      // document.title = "<topic title> · <agent> · LobeHub"
      return document.title.split(" · ")[0].trim() || "LobeHub chat";
    },

    getConversationId() {
      const m = location.pathname.match(/\/agent\/([^/]+)\/([^/?#]+)/);
      return m ? { agentId: m[1], topicId: m[2] } : null;
    },

    async fetchMessages(agentId, topicId) {
      const input = encodeURIComponent(JSON.stringify({
        0: { json: { agentId, groupId: null, threadId: null, topicId } }
      }));
      const r = await fetch(`/trpc/lambda/message.getMessages?batch=1&input=${input}`, {
        credentials: "include", headers: { "Accept": "*/*" }
      });
      if (!r.ok) throw new Error(`LobeHub API ${r.status}`);
      const batch = await NS.debug.json(r, "lobehub");
      return batch?.[0]?.result?.data?.json || [];
    },

    // <lobeArtifact type="image/svg+xml">…</lobeArtifact> → markdown image
    // (data-URI; parens percent-encoded or the markdown URL ends at the first
    // `)` — same trap as claude.js renderVisual). Other artifact types → a
    // titled fenced block rather than dropped.
    renderArtifacts(text) {
      return text.replace(
        /<lobeArtifact\b([^>]*)>([\s\S]*?)<\/lobeArtifact>/g,
        (_, attrs, bodyRaw) => {
          const attr = (name) => attrs.match(new RegExp(name + '="([^"]*)"'))?.[1] || "";
          const title = attr("title") || attr("identifier");
          const body = bodyRaw.trim();
          if (/^<svg[\s>]/i.test(body)) {
            const encoded = encodeURIComponent(body).replace(/\(/g, "%28").replace(/\)/g, "%29");
            return `![${title || "image"}](data:image/svg+xml;charset=utf-8,${encoded})`;
          }
          const lang = /html/i.test(attr("type")) ? "html" : "";
          return `${title ? `**${title}**\n\n` : ""}\`\`\`${lang}\n${body}\n\`\`\``;
        }
      );
    },

    async extract() {
      const title = this.title();
      const ids = this.getConversationId();
      const messages = [];
      if (ids) {
        const raw = await this.fetchMessages(ids.agentId, ids.topicId);
        for (const m of raw) {
          if (m.role !== "user" && m.role !== "assistant") continue;
          const content = (m.content || "").trim();
          const imgs = (m.imageList || []).filter(im => im?.url);
          const files = (m.fileList || []).filter(f => f?.name);
          // Tool-calling assistant step: no content, only a reasoning trace
          // about invoking the tool — the page hides these, so do we.
          if (!content && !imgs.length && !files.length) continue;
          const parts = [];
          const thinking = (m.reasoning?.content || "").trim();
          if (thinking && m.role === "assistant") {
            parts.push(`> **Thinking**\n> \n> ${thinking.replace(/\n/g, "\n> ")}`);
          }
          for (const im of imgs) parts.push(`![${im.alt || ""}](${im.url})`);
          for (const f of files) parts.push(`*[attachment: ${f.name}]*`);
          if (content) parts.push(NS.normalizeLatexDelimiters(this.renderArtifacts(content)));
          const entry = { role: m.role, markdown: parts.join("\n\n").trim() };
          const t = Date.parse(m.createdAt);
          if (!isNaN(t)) entry.time = t / 1000;
          messages.push(entry);
        }
      }
      return { title, url: location.href, site: "lobehub", messages };
    }
  };
})();
