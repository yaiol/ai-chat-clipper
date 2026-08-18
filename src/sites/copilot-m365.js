(() => {
  const NS = (globalThis.AiDoc ||= {});
  const sites = (NS.sites ||= {});

  // Microsoft 365 Copilot (m365.cloud.microsoft/chat) — the WORK/enterprise
  // Copilot, a different product from the consumer `copilot.microsoft.com` this
  // extension already supports: different host, different backend, work account
  // required. Probed on a live signed-in conversation, 2026-08-05. DOM-only.
  //
  // ⚠ ONE ELEMENT PER EXCHANGE, NOT PER MESSAGE. A
  // `[data-testid="m365-chat-llm-web-ui-chat-message"]` holds BOTH the question
  // and the answer, so a naive one-element-per-message walk reports every turn
  // as "user" and loses half the conversation. Split it:
  //   user      → `[data-testid="chatOutput"]`   (despite the name — it is the
  //               clean prompt text, nested inside `chatQuestion`)
  //   assistant → `[data-testid="markdown-reply"]`
  // Take those two and NOT their wrappers: `chatQuestion` and
  // `copilot-message-div` prepend the screen-reader headings "You said:" /
  // "Copilot said:" (`h5.fai-UserMessage__accessibleHeading`), which land in the
  // export as text. The two selectors above are already clean — verified: no
  // copy/feedback/sources/footnote chrome inside either.
  //
  // Math is KaTeX **with** `annotation[encoding="application/x-tex"]` and real
  // `.katex-display` wrappers, so the shared converter handles it (clean `$…$`
  // and `$$…$$`) with nothing site-specific needed.
  //
  // ⚠ Code blocks are a `.scriptor-component-code-block` widget — NO <pre>, NO
  // <code>, no newlines in `textContent`, and a line-number gutter interleaved
  // with the code in one flat parent, so the raw text reads
  // "Python1import re2 3def extract_latex(text):4 …". Rebuilt below.

  const TURN_SEL = '[data-testid="m365-chat-llm-web-ui-chat-message"]';
  const USER_SEL = '[data-testid="chatOutput"]';
  const ASST_SEL = '[data-testid="markdown-reply"]';
  const CODE_SEL = ".scriptor-component-code-block";

  // Rebuild a code widget as a real <pre><code>. The gutter and the code lines
  // are siblings under one parent and both carry hashed, meaningless classes —
  // so the gutter is identified EMPIRICALLY: the class whose elements are all
  // plain integers counting 1, 2, 3, … Everything else is source, and a gutter
  // entry with no code sibling after it is a blank line.
  function rebuildCodeBlock(widget, doc) {
    const lang = (widget.querySelector("#language-badge")?.textContent || "").trim();

    // The row container = the element with the most leaf children carrying text.
    let host = null, best = 0;
    for (const el of widget.querySelectorAll("*")) {
      const kids = [...el.children].filter(c => !c.children.length && (c.textContent || "").trim());
      if (kids.length > best) { best = kids.length; host = el; }
    }
    if (!host) return null;

    const rows = [...host.children];
    const byClass = new Map();
    for (const r of rows) {
      const k = (r.className || "").toString();
      if (!byClass.has(k)) byClass.set(k, []);
      byClass.get(k).push(r);
    }
    let gutterClass = null;
    for (const [k, list] of byClass) {
      const nums = list.map(e => (e.textContent || "").trim());
      if (nums.length > 1 && nums.every(t => /^\d+$/.test(t)) && nums.every((t, i) => +t === i + 1)) {
        gutterClass = k;
        break;
      }
    }
    if (!gutterClass) return null;

    const lines = [];
    for (const r of rows) {
      if ((r.className || "").toString() === gutterClass) lines.push("");
      else if (lines.length) lines[lines.length - 1] += r.textContent || "";
    }
    if (!lines.length) return null;

    const pre = doc.createElement("pre");
    const code = doc.createElement("code");
    if (/^[\w+#.-]{1,20}$/.test(lang)) code.className = `language-${lang.toLowerCase()}`;
    code.textContent = lines.join("\n").replace(/\s+$/, "");
    pre.appendChild(code);
    return pre;
  }

  function normalizeCodeBlocks(root) {
    const doc = root.ownerDocument || document;
    for (const w of [...root.querySelectorAll(CODE_SEL)]) {
      const pre = rebuildCodeBlock(w, doc);
      if (pre) w.replaceWith(pre);
    }
  }

  function toMarkdown(el) {
    if (!el) return "";
    const clone = el.cloneNode(true);
    normalizeCodeBlocks(clone);
    return NS.htmlToMarkdown(clone);
  }

  sites["copilot-m365"] = {
    id: "copilot-m365",
    label: "M365 Copilot",
    matches(host) { return host === "m365.cloud.microsoft"; },

    title() {
      // document.title is the conversation's own name (the first prompt).
      return document.title.replace(/\s*[-|]\s*Microsoft 365.*$/i, "").trim() || "M365 Copilot chat";
    },

    getConversationId() {
      return location.pathname.match(/\/chat\/conversation\/([A-Za-z0-9-]+)/)?.[1] || null;
    },

    findMessages() {
      return [...document.querySelectorAll(TURN_SEL)];
    },

    // One exchange → up to two messages.
    extractExchange(el) {
      const out = [];
      const user = toMarkdown(el.querySelector(USER_SEL));
      if (user) out.push({ role: "user", markdown: user });
      const asst = toMarkdown(el.querySelector(ASST_SEL));
      if (asst) out.push({ role: "assistant", markdown: asst });
      return out;
    },

    async extract() {
      const messages = [];
      for (const el of this.findMessages()) messages.push(...this.extractExchange(el));
      return { title: this.title(), url: location.href, site: "copilot-m365", messages };
    },

    // The inline per-message button mounts on the exchange; its own copy /
    // feedback row is the only stable action bar.
    findMountPoints() {
      return this.findMessages().map(msg => ({
        bar: msg.querySelector('[data-testid="CopyButtonContainerTestId"]') || msg,
        msg
      }));
    },

    extractOne(el) {
      const parts = this.extractExchange(el);
      if (!parts.length) return null;
      // An inline export of one exchange keeps both halves.
      return { role: "assistant", markdown: parts.map(p => p.markdown).join("\n\n") };
    }
  };
})();
