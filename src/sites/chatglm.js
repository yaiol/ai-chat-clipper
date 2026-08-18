(() => {
  const NS = (globalThis.AiDoc ||= {});
  const sites = (NS.sites ||= {});

  // ChatGLM / 智谱清言 (chatglm.cn) — Zhipu's Chinese chat, the CN sibling of the
  // international z.ai. A Vue app: every element carries `data-v-*` scoped-style
  // attributes (meaningless as anchors) and there are no `data-testid`s, so the
  // anchors here are semantic CLASS names. Probed on a live conversation,
  // 2026-08-05.
  //
  // ⚠ DOM-only, and the API is deliberately NOT used. The page loads its history
  // from `GET /chatglm/mainchat-api/conversation/messages?assistant_id=…&
  // conversation_id=…`, which returns the full raw markdown — but every replay
  // from script gets `400 {"status":40001,"bad request"}`. Plain, with app
  // headers, with `X-Requested-With`, with a dummy `refer__991`, without
  // `assistant_id` — all 400. The real client signs each call (their anti-bot
  // `refer__991` token), which is the same session-signature wall documented for
  // AI Studio / NotebookLM. Nothing is lost by reading the DOM: the API's stored
  // question text carries the SAME truncation described below.
  //
  // ⚠ ChatGLM itself truncates long user prompts — a 145-char question is stored
  // and rendered as its last ~88 characters. Verified in BOTH the DOM and the
  // API response, so it is ChatGLM's own data, NOT an extraction bug. Don't
  // "fix" it; there is nothing to recover.
  //
  // Layout: `.conversation-item` = one EXCHANGE (question + answer). The last
  // item is a `.followup-container` (suggested next prompts) with neither, and
  // is filtered out.
  //   user      → `.question-txt` — deliberately NOT its parent
  //                `.question-text-style`, which also holds the `.user-name`
  //                ("访客_…", the account label) and a `.copy-btn` whose text is
  //                "Click to copy to input box."
  //   assistant → `.answer-content-wrap` — NOT `.answer-content`, which wraps
  //                brand/model chrome ("ChatGLM 语音 …") around it.
  //
  // Math is KaTeX **with** `annotation[encoding="application/x-tex"]` and real
  // `.katex-display` wrappers → the shared converter handles it unaided.

  const TURN_SEL = ".conversation-item";
  const Q_SEL = ".question-txt";
  const A_SELECTORS = [".answer-content-wrap", ".markdown-body", ".answer-content"];
  // The artifact card ChatGLM renders above a generated file ("代码生成完成 /
  // MARKDOWN代码" — "code generation complete"), plus the copy affordances.
  const CHROME_SEL = ".code-block, .copy-button, .copy-btn";

  function toMarkdown(el) {
    if (!el) return "";
    const clone = el.cloneNode(true);
    clone.querySelectorAll(CHROME_SEL).forEach(n => n.remove());
    return NS.htmlToMarkdown(clone);
  }

  // ⚠ Fall through on an EMPTY RESULT, not merely on a missing element. An
  // image-only answer (the "draw me a sheep" turn) does have a `.markdown-body`
  // — it is just empty — so a first-element-wins chain returned "" and dropped
  // the whole answer. Take the first selector that actually yields text.
  function answerMarkdown(item) {
    for (const sel of A_SELECTORS) {
      const md = toMarkdown(item.querySelector(sel));
      if (md) return md;
    }
    return "";
  }

  sites.chatglm = {
    id: "chatglm",
    label: "ChatGLM",
    matches(host) { return host === "chatglm.cn" || host === "www.chatglm.cn"; },

    title() {
      // document.title is the brand ("智谱清言"), never the chat name — the
      // conversation title lives in the sidebar's active row.
      return (document.querySelector(".conversation-name")?.textContent || "").trim() || "ChatGLM chat";
    },

    // The conversation id is a QUERY param (`?cid=…`), not a path segment.
    getConversationId() {
      return new URLSearchParams(location.search).get("cid");
    },

    findMessages() {
      return [...document.querySelectorAll(TURN_SEL)]
        .filter(i => i.querySelector(Q_SEL) || A_SELECTORS.some(s => i.querySelector(s)));
    },

    extractExchange(item) {
      const out = [];
      const q = toMarkdown(item.querySelector(Q_SEL));
      if (q) out.push({ role: "user", markdown: q });
      const a = answerMarkdown(item);
      if (a) out.push({ role: "assistant", markdown: a });
      return out;
    },

    async extract() {
      const messages = [];
      for (const item of this.findMessages()) messages.push(...this.extractExchange(item));
      return { title: this.title(), url: location.href, site: "chatglm", messages };
    },

    extractOne(el) {
      const parts = this.extractExchange(el);
      if (!parts.length) return null;
      return { role: "assistant", markdown: parts.map(p => p.markdown).join("\n\n") };
    },

    // ⚠ ChatGLM's own action row is `.left-btn-part` (copy / export-pdf / share /
    // more), inside `.regenerate-part-container` at the bottom of the exchange,
    // and it is present at rest — verified on a live chat: exactly one row per
    // real `.conversation-item`, visible without hover. Anchor on it, like every
    // other adapter.
    //
    // `bar: msg` (the whole `.conversation-item`) was the shortcut and it was
    // wrong twice over: the shared mount PREPENDS into `bar`, so the buttons
    // landed at the TOP of the exchange — above the question, visually stranded
    // between two turns — and a `.conversation-item` carrying NO row is the empty
    // `followup-container` placeholder, not a turn, so it would have been given
    // buttons for nothing. Requiring the row fixes both: no row, no mount.
    findMountPoints() {
      const out = [];
      for (const msg of this.findMessages()) {
        const bar = msg.querySelector(".left-btn-part");
        if (bar) out.push({ bar, msg });
      }
      return out;
    }
  };
})();
