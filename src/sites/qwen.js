(() => {
  const NS = (globalThis.AiDoc ||= {});
  const sites = (NS.sites ||= {});

  // Qwen Chat (chat.qwen.ai) — Alibaba's Qwen web app.
  // Confirmed against a real capture (2026-07-19): GET /api/v2/chats/<id>
  // (v1 404s) returns { success, data: { title, chat: { history: { messages:
  // <id-keyed tree>, currentId } } } }. A user turn carries plain `content`;
  // an assistant turn has content:"" and a phased `content_list`:
  //   - phase "thinking_summary" → extra.summary_thought.content[] (the trace)
  //   - phase "answer"           → content (markdown segment; several per turn
  //                                 when a tool call interleaves)
  //   - phase "image_gen_tool"   → extra.image_list[].image (signed CDN URLs —
  //                                 they expire, same caveat as ChatGPT estuary)
  sites.qwen = {
    id: "qwen",
    label: "Qwen",
    matches(host) { return host === "chat.qwen.ai"; },

    title() {
      return document.title.replace(/\s*[-|·]\s*Qwen.*$/i, "").trim() || "Qwen chat";
    },

    getConversationId() {
      return location.pathname.match(/\/c\/([0-9a-f-]{8,})/i)?.[1] || null;
    },

    authHeaders() {
      const h = { Accept: "application/json" };
      try {
        const t = localStorage.getItem("token");
        if (t) h.Authorization = `Bearer ${t.replace(/^"|"$/g, "")}`;
      } catch { /* storage blocked — session cookies may still be enough */ }
      return h;
    },

    // Assemble one message's markdown. Assistant turns: thinking blockquote
    // (shared `> **Thinking**` convention) + answer/image phases in list order.
    messageMarkdown(m) {
      if (Array.isArray(m?.content_list) && m.content_list.length) {
        const thinking = [];
        const parts = [];
        for (const it of m.content_list) {
          if (it.phase === "thinking_summary") {
            const th = it?.extra?.summary_thought?.content;
            if (Array.isArray(th)) thinking.push(...th.filter((x) => typeof x === "string" && x.trim()));
          } else if (it.phase === "image_gen_tool") {
            for (const im of it?.extra?.image_list || []) {
              if (im?.image) parts.push(`![](${im.image})`);
            }
          } else if (typeof it.content === "string" && it.content.trim()) {
            parts.push(it.content.trim());
          }
        }
        const out = [];
        if (thinking.length) {
          out.push(`> **Thinking**\n> \n> ${thinking.join("\n\n").replace(/\n/g, "\n> ")}`);
        }
        out.push(...parts);
        return out.join("\n\n").trim();
      }
      return typeof m?.content === "string" ? m.content.trim() : "";
    },

    // Walk the active branch from currentId up to the root, then reverse.
    linearize(chat) {
      const hist = chat?.history;
      const byId = (hist && hist.messages) || {};
      const branch = [];
      let cur = (hist && hist.currentId) || null;
      const guard = new Set();
      while (cur && byId[cur] && !guard.has(cur)) {
        guard.add(cur);
        branch.push(byId[cur]);
        cur = byId[cur].parentId || null;
      }
      branch.reverse();
      if (!branch.length && Array.isArray(chat?.messages)) branch.push(...chat.messages);

      const messages = [];
      for (const m of branch) {
        const role = m?.role === "user" ? "user" : m?.role === "assistant" ? "assistant" : null;
        if (!role) continue;
        const md = this.messageMarkdown(m);
        if (!md) continue;
        const entry = { role, markdown: md };
        if (typeof m.timestamp === "number") entry.time = m.timestamp;
        messages.push(entry);
      }
      return messages;
    },

    async extract() {
      let title = this.title();
      const id = this.getConversationId();
      let messages = [];
      if (id) {
        try {
          // ⚠ CLAUDE: capture the body BEFORE the ok-check, so a failed fetch
          // (401/404/HTML) still lands in the Debug bundle — the response we
          // most need when a site breaks.
          const r = await fetch(`/api/v2/chats/${id}`, { credentials: "include", headers: this.authHeaders() });
          const raw = await NS.debug.text(r, "qwen");
          if (!r.ok) throw new Error(`Qwen API ${r.status}`);
          const j = JSON.parse(raw);
          const payload = (j && j.data) || j;
          if (payload?.title) title = payload.title;
          messages = this.linearize(payload?.chat || payload);
        } catch (err) {
          console.warn(NS.TAG, "Qwen API extract failed:", err);
        }
      }
      return { title, url: location.href, site: "qwen", messages };
    },

    // ── Inline buttons (DOM) ─────────────────────────────────────────────
    //
    // Qwen had NO inline support at all — no findMountPoints, no extractOne —
    // so the in-chat buttons simply never appeared here (same for lobehub,
    // merlin, minimax and reve). Layout:
    //   div.qwen-chat-message.qwen-chat-message-{user|assistant}
    //     ├─ …                       (the bubble / .response-message-content)
    //     └─ div.message-hoc-container
    //          └─ … div.qwen-chat-package-comp-new-action-control-icons
    //                                (the native copy / vote / share buttons)
    //
    // ⚠ Role comes from the modifier CLASS, never from the action bar's
    // aria-labels ("Copy", "Edit", "Regenerate"): those follow the UI
    // language, so anchoring on them mounts a different set of turns on a
    // French or Chinese account.
    QWEN_TURN_SEL: ".qwen-chat-message",
    QWEN_BAR_SEL: ".qwen-chat-package-comp-new-action-control-icons",

    findMountPoints() {
      const out = [];
      for (const msg of document.querySelectorAll(this.QWEN_TURN_SEL)) {
        // The row of icon buttons, not its `…-control` wrapper: the wrapper
        // also holds the "+8 sources" pill, and our buttons go at the front
        // edge of the icon row where the native ones are.
        const bar = msg.querySelector(this.QWEN_BAR_SEL);
        if (bar) out.push({ bar, msg });
      }
      return out;
    },

    findMessages() {
      return document.querySelectorAll(this.QWEN_TURN_SEL);
    },

    // One turn from the live DOM. The full-conversation export uses the API
    // above; this only has to agree with it.
    extractOne(el) {
      const role = el.classList.contains("qwen-chat-message-user") ? "user" : "assistant";
      const clean = el.cloneNode(true);

      // The footer carries the action bar and the sources pill — chrome, and
      // the very node our own buttons are injected into, so leaving it in
      // would copy the caption of the button that was just clicked.
      clean.querySelectorAll(".message-hoc-container").forEach(n => n.remove());

      // Collapsed thinking card: it holds the status caption ("Thinking
      // completed") and nothing else — the reasoning text is not in the DOM,
      // so there is nothing to lift into a `> **Thinking**` block the way the
      // API path does.
      clean.querySelectorAll(".qwen-chat-thinking-tool-status-card-wraper").forEach(n => n.remove());

      // A code block puts a header (language label + copy/preview) above the
      // <pre>; keep the <pre> alone or the language name is glued onto the
      // first line of the listing.
      clean.querySelectorAll("pre").forEach(pre => {
        const wrap = pre.parentElement;
        if (wrap && wrap !== clean && wrap.querySelector("button")) wrap.replaceWith(pre);
      });

      // Anything still a button is chrome. Inline <svg> is left to
      // html-to-md.js, which already tells an icon from a content drawing.
      clean.querySelectorAll("button, [role='button']").forEach(b => b.remove());

      const md = NS.htmlToMarkdown(clean);
      if (!md || !md.trim()) return null;
      const out = { role, markdown: md.trim() };
      const time = NS.findMessageTime?.(el);
      if (time) out.time = time;
      return out;
    }
  };
})();
