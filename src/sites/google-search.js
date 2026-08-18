(() => {
  const NS = (globalThis.AiDoc ||= {});
  const sites = (NS.sites ||= {});

  // Google Search — the AI OVERVIEW ("Aperçu IA") block on a CLASSIC results
  // page, i.e. `/search?q=…` WITHOUT `udm=50`. That is the "All / Tous" tab.
  // Sibling of `google-aisearch`, which is the conversational **AI Mode**
  // (`udm=50`). Two surfaces, two ids — see the note on mutual exclusion below.
  // Probed live 2026-08-05.
  //
  // ⚠ THE TWO ADAPTERS MUST BE MUTUALLY EXCLUSIVE. Both live on
  // `www.google.com` and `registry.js` returns the FIRST adapter whose
  // `matches(host)` is true, so a host-only test would let whichever loads
  // first answer for both surfaces. So `google-aisearch.matches()` now also
  // requires AI Mode, and this one requires the opposite plus a real overview.
  //
  // ⚠ The classic page carries `[data-scope-id="turn"]` and
  // `[data-container-id="main-col"]` too — they are the OVERVIEW's own
  // containers, which is why they cannot distinguish the surfaces. What they
  // CAN do is locate the answer: `[data-container-id="main-col"]` is exactly
  // the overview text (356 chars on the probe, matching the rendered block —
  // no script source, none of the hidden "Aucun Aperçu IA n'est disponible"
  // fallback copies that sit elsewhere in the page).
  //
  // The AI Overview is built from the SAME Google components as AI Mode —
  // `.n6owBd` prose paragraphs, `data-streaming-container`, the same citation
  // chips — so the answer is rendered by **delegating to the AI Mode adapter's
  // `answerMarkdown()`** rather than copying its cleaning rules. One fix serves
  // both when Google reshuffles.
  //
  // Shape: an overview is a ONE-SHOT answer, so the export is a single
  // exchange — the search query as the user turn (there is no query bubble
  // here; the query is the `q` parameter), the overview as the assistant turn.

  const OVERVIEW_SEL = '[data-container-id="main-col"]';
  const PROSE_SEL = ".n6owBd";

  function aiMode() {
    return sites["google-aisearch"]?.isAiMode?.() ?? /[?&]udm=50\b/.test(location.search);
  }

  function overviewEl() {
    const el = document.querySelector(OVERVIEW_SEL);
    // A results page with no overview still has the container; the AI prose
    // paragraph class is what says an answer was actually generated.
    return el && el.querySelector(PROSE_SEL) ? el : null;
  }

  sites["google-search"] = {
    id: "google-search",
    label: "Google Search",

    matches(host) {
      if (host !== "www.google.com" && host !== "google.com") return false;
      if (!location.pathname.startsWith("/search")) return false;
      return !aiMode() && !!overviewEl();
    },

    query() {
      return (new URLSearchParams(location.search).get("q") || "").trim();
    },

    title() {
      const q = this.query();
      return q ? (q.length > 80 ? q.slice(0, 80).trimEnd() + "…" : q) : "Google AI Overview";
    },

    getConversationId() { return null; },

    findMessages() {
      const el = overviewEl();
      return el ? [el] : [];
    },

    extractOne(el) {
      // Reuse AI Mode's cleaner — it already inlines `data-xpm-latex` math,
      // drops labelled-button wrappers and keeps `.n6owBd` prose.
      const md = sites["google-aisearch"]?.answerMarkdown?.(el) || NS.htmlToMarkdown(el);
      return md ? { role: "assistant", markdown: md } : null;
    },

    async extract() {
      const messages = [];
      const q = this.query();
      if (q) messages.push({ role: "user", markdown: q });
      for (const el of this.findMessages()) {
        const one = this.extractOne(el);
        if (one) messages.push(one);
      }
      return { title: this.title(), url: location.href, site: "google-search", messages };
    },

    findMountPoints() {
      return this.findMessages().map(msg => ({ bar: msg, msg }));
    }
  };
})();
