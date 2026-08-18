(() => {
  const NS = (globalThis.AiDoc ||= {});
  const sites = (NS.sites ||= {});

  // MiniMax Agent (agent.minimax.io/mavis?id=<numeric>) — Next.js app on the
  // hailuo.ai CDN. The conversation is fetched client-side after mount (NOT
  // embedded in __next_f) and rendered into the DOM, so extraction is DOM-based.
  // ⚠ CLAUDE: structure confirmed from a real page_html capture (2026-07-19),
  // anchored on stable data-testid attributes (class hashes churn):
  //   [data-testid="message-item"]         one turn
  //     [data-testid="user-message-bubble"]  → user turn's content
  //     .message-content (a CLASS, not a testid — .matrix-markdown.message-content)
  //                                          → assistant answer; several per turn
  //     [data-testid="activity-group"]       → collapsed agent reasoning / tool
  //                                            steps — surfaced as a thinking block
  // FIRST PASS: nails the Q&A; agent-activity fidelity is best-effort. Verify
  // against a real export before treating any change as done.
  sites.minimax = {
    id: "minimax",
    label: "MiniMax",
    matches(host) { return host === "agent.minimax.io"; },

    title() {
      // MiniMax doesn't put the conversation title in document.title — it shows
      // the app tagline ("MiniMax Agent: Minimize Effort…"). Detect that generic
      // value and fall back rather than exporting the tagline as the title.
      const t = (document.title || "").trim();
      if (!t || /^MiniMax Agent/i.test(t)) return "MiniMax chat";
      return t;
    },

    getConversationId() {
      try { return new URL(location.href).searchParams.get("id") || null; }
      catch { return null; }
    },

    findMessages() {
      return document.querySelectorAll('[data-testid="message-item"]');
    },

    // ⚠ CLAUDE: one assistant reply is split across SEVERAL message-items —
    // interleaved [activity-group, answer-segment, activity-group, …]. We group
    // consecutive non-user items into ONE assistant turn, taking only the
    // `.message-content` answer segments. The activity-group items are dropped:
    // their DOM text is just a collapsed label ("Thought 1 time(s)"), not the
    // reasoning. Math is a known loss — MiniMax's KaTeX carries no x-tex
    // annotation, so formulas degrade (a^2 → "a2"); the API would preserve them.
    async extract() {
      const messages = [];
      let pending = null;  // accumulating assistant segments
      const flush = () => {
        if (pending) { const md = pending.join("\n\n").trim(); if (md) messages.push({ role: "assistant", markdown: md }); }
        pending = null;
      };
      for (const el of this.findMessages()) {
        const userBubble = el.querySelector('[data-testid="user-message-bubble"]');
        if (userBubble) {
          flush();
          const md = NS.htmlToMarkdown(userBubble);
          if (md && md.trim()) messages.push({ role: "user", markdown: md.trim() });
          continue;
        }
        // Assistant fragment: collect answer segments; skip activity labels.
        if (!pending) pending = [];
        for (const c of el.querySelectorAll('.message-content')) {
          const md = NS.htmlToMarkdown(c);
          if (md && md.trim()) pending.push(md.trim());
        }
      }
      flush();
      return { title: this.title(), url: location.href, site: "minimax", messages };
    }
  };
})();
