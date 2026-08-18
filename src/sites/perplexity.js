(() => {
  const NS = (globalThis.AiDoc ||= {});
  const sites = (NS.sites ||= {});

  const USE_CASES = [
    "answer_modes", "media_items", "knowledge_cards", "inline_entity_cards",
    "place_widgets", "finance_widgets", "sports_widgets", "flight_status_widgets",
    "shopping_widgets", "jobs_widgets", "search_result_widgets",
    "clarification_responses", "inline_images", "inline_assets",
    "placeholder_cards", "diff_blocks", "inline_knowledge_cards",
    "entity_group_v2", "refinement_filters", "canvas_mode", "maps_preview",
    "answer_tabs", "price_comparison_widgets"
  ];

  function buildUrl(threadId) {
    const params = new URLSearchParams({
      with_parent_info: "true",
      with_schematized_response: "true",
      version: "2.18",
      source: "default",
      limit: "10",
      offset: "0",
      from_first: "true"
    });
    for (const u of USE_CASES) params.append("supported_block_use_cases", u);
    return `https://www.perplexity.ai/rest/thread/${threadId}?${params.toString()}`;
  }

  function buildCitationReplacer(blocks) {
    const webResults = [];
    for (const b of blocks) {
      if (b.intended_usage === "web_results") {
        const results = b.web_result_block?.web_results || [];
        webResults.push(...results);
      }
    }
    return (text) => text.replace(/\[(\d+)\]/g, (match, n) => {
      const idx = parseInt(n, 10) - 1;
      const wr = webResults[idx];
      if (!wr?.url) return match;
      let label = wr.meta_data?.citation_domain_name || wr.meta_data?.domain_name;
      if (!label) {
        try { label = new URL(wr.url).hostname.replace(/^www\./, "").split(".")[0]; } catch {}
      }
      return label ? `[[${idx}]](${wr.url})` : match;
    });
  }

  function extractAssistantMarkdown(blocks) {
    const replaceCitations = buildCitationReplacer(blocks);
    const parts = [];
    // ⚠ Perplexity emits the SAME answer twice per entry: once as `ask_text`
    // (the canonical final answer) and once as `ask_text_<n>_markdown` (the
    // per-answer-tab variant). Emitting both doubled every assistant message.
    // Prefer the plain `ask_text`; fall back to the `_markdown` variants only
    // when no plain block exists (streaming/edge captures).
    const hasPlain = blocks.some(b => b.intended_usage === "ask_text");
    const isAnswer = (usage) => hasPlain
      ? usage === "ask_text"
      : (typeof usage === "string" && usage.startsWith("ask_text_"));
    for (const b of blocks) {
      const usage = b.intended_usage;
      if (usage === "media_items") {
        const items = b.media_block?.media_items || [];
        for (const it of items) {
          if (it.medium === "image" && it.image) parts.push(`![](${it.image})`);
        }
      } else if (isAnswer(usage)) {
        const answer = b.markdown_block?.answer;
        if (answer?.trim()) parts.push(replaceCitations(answer));
        const media = b.markdown_block?.media_items || [];
        for (const m of media) {
          if (m.medium === "image" && m.image) parts.push(`![](${m.image})`);
        }
      }
    }
    return parts.join("\n\n").trim();
  }

  sites.perplexity = {
    id: "perplexity",
    label: "Perplexity",
    matches(host) { return host === "www.perplexity.ai" || host === "perplexity.ai"; },

    title() {
      return document.title.replace(/\s*[-|]\s*Perplexity.*$/i, "").trim() || "Perplexity chat";
    },

    getConversationId() {
      return location.pathname.match(/\/search\/([^/?#]+)/)?.[1] || null;
    },

    async fetchThread(id) {
      const r = await fetch(buildUrl(id), {
        method: "GET",
        credentials: "include",
        headers: {
          "Accept": "*/*",
          "Content-Type": "application/json",
          "x-app-apiclient": "default",
          "x-app-apiversion": "2.18"
        }
      });
      if (!r.ok) throw new Error(`Perplexity API ${r.status}`);
      return NS.debug.json(r, "perplexity");
    },

    async extract() {
      const id = this.getConversationId();
      const fallbackTitle = this.title();
      if (id) {
        try {
          const data = await this.fetchThread(id);
          const entries = data?.entries || [];
          const messages = [];
          for (const e of entries) {
            // Both user and assistant messages share the entry timestamp -
            // Perplexity records one time per entry (per reference extension).
            const time = e.entry_updated_datetime || e.updated_datetime || null;
            if (e.query_str?.trim()) {
              const userEntry = { role: "user", markdown: e.query_str.trim() };
              if (time) userEntry.time = time;
              messages.push(userEntry);
            }
            const md = extractAssistantMarkdown(e.blocks || []);
            if (md) {
              const asstEntry = { role: "assistant", markdown: md };
              if (time) asstEntry.time = time;
              messages.push(asstEntry);
            }
          }
          if (messages.length) {
            const title = entries.find(e => e.thread_title)?.thread_title || fallbackTitle;
            return { title, url: location.href, site: "perplexity", messages };
          }
        } catch (err) {
          console.warn(NS.TAG, "Perplexity API extract failed, falling back to DOM:", err);
        }
      }
      // DOM fallback
      const messages = [];
      const nodes = document.querySelectorAll('[class*="threadContentWidth"]');
      for (const n of nodes) {
        const md = NS.htmlToMarkdown(n);
        if (md) messages.push({ role: "assistant", markdown: md });
      }
      return { title: fallbackTitle, url: location.href, site: "perplexity", messages };
    },

    findMountPoints() {
      // Anchor: button containing an SVG <use> referencing the regenerate icon
      const uses = document.querySelectorAll('svg use');
      const out = [];
      const seen = new Set();
      for (const use of uses) {
        const href = use.getAttribute("href")
                  || use.getAttribute("xlink:href")
                  || use.getAttributeNS("http://www.w3.org/1999/xlink", "href")
                  || "";
        if (!/icon-repeat/i.test(href)) continue;
        const button = use.closest("button");
        if (!button) continue;
        const bar = button.parentElement;
        if (!bar || seen.has(bar)) continue;
        seen.add(bar);
        const msg = button.closest('[class*="threadContentWidth"]') || bar.parentElement || bar;
        out.push({ bar, msg });
      }
      return out;
    },

    findMessages() {
      return document.querySelectorAll('[class*="threadContentWidth"]');
    },

    extractOne(el) {
      const md = NS.htmlToMarkdown(el);
      if (!md) return null;
      const out = { role: "assistant", markdown: md };
      const time = NS.findMessageTime?.(el);
      if (time) out.time = time;
      return out;
    }
  };
})();
