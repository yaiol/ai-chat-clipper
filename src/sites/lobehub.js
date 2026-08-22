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
    },

    // ── Inline buttons (DOM) ─────────────────────────────────────────────
    //
    // LobeHub had no inline support, so the in-chat buttons never appeared.
    // Layout, confirmed live 2026-08-22:
    //   div.message-wrapper[data-message-id]     one turn
    //     div.message-header                       avatar + time
    //     div.message-body                         the content
    //     div > div[role="menubar"]                the action row
    //
    // ⚠ The list is VIRTUALIZED (react-virtuoso): only the turns near the
    // viewport exist in the DOM — one at a time when a reply is long. That is
    // fine for per-message buttons (the MutationObserver re-injects as rows
    // mount) but it is why findMessages() must never be used for a whole
    // conversation: extract() goes through the tRPC API for that.
    LOBE_TURN_SEL: ".message-wrapper[data-message-id]",

    // ⚠ Role is in NO class: user and assistant wrappers share one hashed
    // class (acss-…). The only non-localized marker is the inline layout
    // variable — `--lobe-flex-align: flex-end` on a user turn, `flex-start` on
    // an assistant one. The avatar is NOT a discriminator: an account with a
    // user avatar renders an <img> in both headers.
    domRole(el) {
      return /--lobe-flex-align:\s*flex-end/.test(el.getAttribute("style") || "") ? "user" : "assistant";
    },

    // ⚠ TWO traps in one action row, both measured 2026-08-22:
    //
    // 1. NEVER mount inside `[data-singleton-message-action-bar-host]`:
    //    LobeHub keeps ONE action bar and portals it into whichever turn is
    //    hovered, so a button injected there stays bound to the first turn it
    //    was built for and silently copies the WRONG message.
    // 2. NEVER mount on `[role="menubar"]` itself: it is `opacity: 0;
    //    pointer-events: none` at rest and only a real CSS :hover lifts it, so
    //    our buttons would be invisible and unclickable until the turn is
    //    hovered — the very "the buttons aren't there" failure this work is
    //    fixing. Its PARENT row is opacity 1, so mounting one level up keeps
    //    ours on the action line and always visible, with LobeHub's own
    //    controls fading in beside them on hover.
    findMountPoints() {
      const out = [];
      for (const msg of document.querySelectorAll(this.LOBE_TURN_SEL)) {
        const menubar = msg.querySelector('[role="menubar"]');
        const bar = menubar?.parentElement;
        if (bar && msg.contains(bar)) out.push({ bar, msg });
      }
      return out;
    },

    findMessages() {
      return document.querySelectorAll(this.LOBE_TURN_SEL);
    },

    extractOne(el) {
      const body = el.querySelector(".message-body");
      if (!body) return null;
      const clean = body.cloneNode(true);
      // Collapsed reasoning / tool-step accordions ("Réflexion terminée",
      // "2 étapes effectuées (20s)") hold a caption and nothing else — the
      // trace itself is not in the DOM. The API path lifts `reasoning.content`
      // into a `> **Thinking**` block; this path has nothing to lift.
      clean.querySelectorAll(".accordion-item").forEach(n => n.remove());
      // The action row and any hover-rendered code-block control.
      clean.querySelectorAll('[role="menubar"], button, [role="button"]').forEach(n => n.remove());
      // Math survives here: LobeHub ships real KaTeX with an
      // `annotation[encoding="application/x-tex"]`, which html-to-md.js reads —
      // so the DOM path keeps `$…$` instead of degrading to glyphs.
      const md = NS.htmlToMarkdown(clean);
      if (!md || !md.trim()) return null;
      const out = { role: this.domRole(el), markdown: md.trim() };
      const time = NS.findMessageTime?.(el);
      if (time) out.time = time;
      return out;
    }
  };
})();
