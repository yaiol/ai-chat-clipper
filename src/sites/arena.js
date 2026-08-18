(() => {
  const NS = (globalThis.AiDoc ||= {});
  const sites = (NS.sites ||= {});

  // Arena (arena.ai) — the LLM leaderboard's Battle Mode chat. Probed on a live
  // conversation, 2026-08-05. DOM-only: Next.js on Vercel, and every API route
  // answers `403 {"error":"Route not allowed"}` to anything but its own client.
  //
  // ⚠ ONE PROMPT, TWO ANSWERS. Battle Mode replies to each question with two
  // models side by side, so the canonical flat `{role, markdown}` list gets a
  // user turn followed by TWO assistant messages, each headed with the model
  // that produced it. Keeping both is the point of the site — the comparison IS
  // the content — and it is what the exported document has to preserve.
  //
  // ⚠ THE MESSAGE LIST IS `flex-col-reverse` — DOM ORDER IS NEWEST-FIRST.
  // `ol[class*="col-reverse"]` renders bottom-up, so reading its children in
  // document order yields the conversation backwards, with each answer pair
  // appearing BEFORE the question that produced it. `.reverse()` is not a
  // cosmetic choice here; without it every export is inverted.
  //
  // Row shapes (children of that ol, after reversing):
  //   assistant pair → contains `[class*="carousel"]`; its column children each
  //                    hold one `.prose` body and a `span.font-medium` label
  //                    whose two child spans are the provider and the model
  //                    ("Anthropic" + "claude-sonnet-4-6").
  //   user           → no carousel, one `.prose` bubble.
  // The last row is the in-flight generation and is empty — dropped by the
  // non-empty check rather than by counting.
  //
  // Math is KaTeX and code blocks are real `<pre>`, so the shared converter
  // handles both unaided.

  const LIST_SEL = 'ol[class*="col-reverse"]';
  const BODY_SEL = ".prose";
  const CAROUSEL_SEL = '[class*="carousel"]';

  function modelLabel(col) {
    const span = col.querySelector("span.font-medium");
    if (!span) return "";
    // Provider and model are two child spans whose text runs together
    // ("Anthropicclaude-sonnet-4-6") — join them with a space instead.
    const parts = [...span.children].map(c => (c.textContent || "").trim()).filter(Boolean);
    return (parts.length ? parts.join(" ") : (span.textContent || "").trim());
  }

  sites.arena = {
    id: "arena",
    label: "Arena",
    matches(host) { return host === "arena.ai" || host === "www.arena.ai"; },

    getConversationId() {
      return location.pathname.match(/\/c\/([A-Za-z0-9-]+)/)?.[1] || null;
    },

    title() {
      // document.title is the marketing title on every page, so name the export
      // after the opening question instead.
      const first = this.findMessages().find(r => !r.querySelector(CAROUSEL_SEL));
      const t = (first?.querySelector(BODY_SEL)?.textContent || "").trim().split("\n")[0];
      return t ? (t.length > 70 ? t.slice(0, 70).trimEnd() + "…" : t) : "Arena chat";
    },

    // Chronological order — see the reverse note above.
    findMessages() {
      const list = document.querySelector(LIST_SEL);
      if (!list) return [];
      return [...list.children].reverse().filter(r => (r.textContent || "").trim());
    },

    extractRow(row) {
      const carousel = row.querySelector(CAROUSEL_SEL);
      if (!carousel) {
        const md = NS.htmlToMarkdown(row.querySelector(BODY_SEL));
        return md ? [{ role: "user", markdown: md }] : [];
      }
      const out = [];
      for (const col of carousel.children) {
        const body = col.querySelector(BODY_SEL);
        if (!body) continue;
        const md = NS.htmlToMarkdown(body);
        if (!md) continue;
        const model = modelLabel(col);
        out.push({ role: "assistant", markdown: model ? `**${model}**\n\n${md}` : md });
      }
      return out;
    },

    async extract() {
      const messages = [];
      for (const row of this.findMessages()) messages.push(...this.extractRow(row));
      return { title: this.title(), url: location.href, site: "arena", messages };
    },

    extractOne(row) {
      const parts = this.extractRow(row);
      if (!parts.length) return null;
      return { role: parts[0].role, markdown: parts.map(p => p.markdown).join("\n\n") };
    },

    findMountPoints() {
      return this.findMessages().map(msg => ({ bar: msg, msg }));
    }
  };
})();
