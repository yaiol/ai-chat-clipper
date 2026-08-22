(() => {
  const NS = (globalThis.AiDoc ||= {});
  const sites = (NS.sites ||= {});

  // MiniMax Agent (agent.minimax.io/mavis?id=<numeric>) — Next.js app on the
  // hailuo.ai CDN. The conversation is fetched client-side after mount (NOT
  // embedded in __next_f) and rendered into the DOM, so extraction is DOM-based.
  // ⚠ CLAUDE: structure re-confirmed against the live app 2026-08-22,
  // anchored on stable data-testid attributes (class hashes churn):
  //   [data-testid="message-item"]         one turn
  //     [data-testid="user-message-bubble"]  → user turn's content
  //     .message-content (a CLASS, not a testid — .matrix-markdown.message-content)
  //                                          → assistant answer; several per turn
  //     [data-testid="turn-process-disclosure"] → collapsed agent reasoning,
  //                                            caption only ("Processed 10s")
  //     [data-testid="message-actions"] / [data-testid="user-message-actions"]
  //                                          → the action bar of each turn
  // ⚠ `[data-testid="activity-group"]` from the 2026-07-19 capture is GONE —
  // the reasoning steps are now `turn-process-disclosure`. Nothing queried it,
  // so only this comment was stale; do not reintroduce it as a selector.
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
    },

    // ── Inline buttons (DOM) ─────────────────────────────────────────────
    //
    // MiniMax had no inline support at all, so the in-chat buttons never
    // appeared here. Each turn ends in its own action bar:
    //   assistant → [data-testid="message-actions"]       (copy, feedback, time)
    //   user      → [data-testid="user-message-actions"]  (time, copy)
    //
    // ⚠ Those bars hold NO <button>: every native control is a <div> with a
    // testid (`message-copy-button`, `message-feedback-like-action`, …) carrying
    // `opacity-0 … group-hover:opacity-100`, so it is invisible until the turn
    // is hovered. Anchoring on `button` — the reflex — matches nothing here,
    // exactly the trap kimi.js documents. Our own buttons deliberately do NOT
    // copy that fade: borrowing the site's Tailwind classes would make them
    // vanish for good the day those class names change, and an invisible
    // button is a worse failure than a always-visible one.
    findMountPoints() {
      const out = [];
      for (const msg of this.findMessages()) {
        const bar = msg.querySelector('[data-testid="message-actions"], [data-testid="user-message-actions"]');
        if (bar) out.push({ bar, msg });
      }
      return out;
    },

    // The fragments belonging to ONE answer. MiniMax has rendered a single
    // reply as several consecutive `message-item`s (activity steps + answer
    // segments) and only the last of them carries the action bar — so a copy
    // anchored on the bar would take the tail of the answer and drop the rest.
    // Walk back over any preceding non-user item that has no bar of its own.
    // (Today's build emits one item per reply, so this is usually a no-op —
    // `message-item`s are NOT siblings, each sits in its own wrapper, hence the
    // index walk rather than previousElementSibling.)
    turnParts(el) {
      const all = [...this.findMessages()];
      const i = all.indexOf(el);
      if (i < 0) return [el];
      const parts = [el];
      for (let j = i - 1; j >= 0; j--) {
        const prev = all[j];
        if (prev.querySelector('[data-testid="user-message-bubble"]')) break;
        if (prev.querySelector('[data-testid="message-actions"]')) break;
        parts.unshift(prev);
      }
      return parts;
    },

    // One turn from the live DOM. Reads the same nodes extract() does, so the
    // inline copy and the full export agree.
    extractOne(el) {
      const bubble = el.querySelector('[data-testid="user-message-bubble"]');
      if (bubble) {
        // Read the bubble, never the whole item: the timestamp ("15:09") sits
        // in the action bar outside it and would trail the prompt text.
        const md = NS.htmlToMarkdown(bubble);
        if (!md || !md.trim()) return null;
        const out = { role: "user", markdown: md.trim() };
        const t = NS.findMessageTime?.(el);
        if (t) out.time = t;
        return out;
      }
      // Assistant: the answer segments only. `turn-process-disclosure` and the
      // action bar both sit OUTSIDE `.message-content`, so this drops the
      // "Processed 10s" caption and the button row without touching them.
      const parts = [];
      for (const item of this.turnParts(el)) {
        for (const c of item.querySelectorAll(".message-content")) {
          const md = NS.htmlToMarkdown(c);
          if (md && md.trim()) parts.push(md.trim());
        }
      }
      const md = parts.join("\n\n").trim();
      if (!md) return null;
      const out = { role: "assistant", markdown: md };
      const t = NS.findMessageTime?.(el);
      if (t) out.time = t;
      return out;
    }
  };
})();
