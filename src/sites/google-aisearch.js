(() => {
  const NS = (globalThis.AiDoc ||= {});
  const sites = (NS.sites ||= {});

  // Google Search — AI Mode (google.com/search?udm=50). DOM-only, the hardest
  // target. ⚠ CLAUDE: structure learned from SaveAI's source + verified via
  // linkedom against a real capture (2026-07-19). The load-bearing facts:
  //   • Turns are [data-scope-id="turn"].
  //   • The USER QUERY is the `.iMqumd` bubble's parent text — NOT `[role=
  //     "heading"]` (those are ANSWER section headings inside the answer).
  //   • The ANSWER is [data-container-id="main-col"] — this excludes, for free,
  //     the right sidebar [data-container-id="rhs-col"] (the "N sites" sources
  //     panel + ALL its encrypted-tbn thumbnails, incl. the top image strip) AND
  //     the trailing share dialog. Keep the answer's section headings.
  //   • MATH is recoverable: Google puts the LaTeX in a `data-xpm-latex`
  //     attribute on `[data-xpm-copy-root]` elements. Read it → `$…$` (inline,
  //     style display:inline) or `$$…$$` (display). This gives clean LaTeX with
  //     NO doubling — the earlier "visual+spoken" mess was us ignoring xpm.
  //   • ⚠ DO NOT strip `.n6owBd` — it is Google's PROSE-PARAGRAPH class (the
  //     intro/transition/closing paragraphs), NOT a math dup. Stripping it once
  //     deleted every prose paragraph, leaving only headings + bullets.
  // These are Google class/attr hashes → fragile; re-verify from a fresh
  // page_html on breaks.
  const BLOCK = new Set(["DIV","P","UL","OL","LI","TABLE","H1","H2","H3","H4","H5","H6","BLOCKQUOTE","PRE","HR","BR"]);
  const UI_LINE = /^(Copié|Copier|Copy|Modifier|Edit|Recherche|Search|Afficher plus|Show more|Partager|Share|Bonne réponse|Mauvaise réponse|Sources?|python|javascript|typescript|json|bash|sql|html|css|markdown|Utilisez le code avec précaution\.?|Use code with caution\.?|J'ai gagné du temps|I saved time|Clair|Clear|Utile|Useful|Complet|Complete|Autre|Other)\s*$/i;
  // Trailing feedback / share widgets that sit at the end of an answer.
  const FEEDBACK_TRAIL = /\n#*\s*(J'ai gagné du temps|I saved time|Was this response helpful|Cette réponse|Envoyer des commentaires|Send feedback|A copy of this chat)/i;

  sites["google-aisearch"] = {
    id: "google-aisearch",
    label: "Google AI Mode",
    // ⚠ Host alone is NOT enough: the sibling `google-search` adapter (the AI
    // Overview on a classic results page) lives on the same host, and
    // registry.js returns the FIRST match. The two must be mutually exclusive,
    // so this one claims the page only in AI Mode.
    matches(host) {
      if (host !== "www.google.com" && host !== "google.com") return false;
      return this.isAiMode();
    },

    // ⚠ A CLASSIC results page — `/search?q=…` with NO `udm=50`, i.e. what the
    // "All / Tous" tab lands on — also carries `[data-scope-id="turn"]` AND
    // `[data-container-id="main-col"]`. Verified live 2026-08-05: on
    // `?q=capital+of+France` both are present, and that "turn" element held
    // 2.4 kB of inline <script> source. So neither marker proves AI Mode, and
    // accepting them made the adapter treat an ordinary search page as a
    // conversation. Only two things discriminate: the URL flag, and the AI-Mode
    // query bubble (`.iMqumd`, absent from the classic page).
    isAiMode() {
      return /[?&]udm=50\b/.test(location.search) || !!document.querySelector(".iMqumd");
    },

    // Strip the Copy/Share button chrome + timestamp that wrap the query bubble.
    cleanQueryText(el) {
      const clone = el.cloneNode(true);
      clone.querySelector(".iMqumd")?.remove();
      for (const b of [...clone.querySelectorAll("button[aria-label]")]) if (b.parentElement && b.parentElement !== clone) b.parentElement.remove();
      for (const n of [...clone.querySelectorAll("button, style, script, svg, [aria-hidden='true']")]) n.remove();
      let t = (clone.textContent || "").replace(/\s+/g, " ").trim();
      t = t.replace(/^(Copié|Copier|Copy|Modifier|Edit|Partager|Share)+/i, "").replace(/\s*\d{1,2}:\d{2}\s*(AM|PM)?\s*$/i, "").trim();
      return t;
    },

    userQuery(turn) {
      const im = turn.querySelector(".iMqumd");
      return im && im.parentElement ? this.cleanQueryText(im.parentElement) : "";
    },

    title() {
      const t = document.querySelector('[data-scope-id="turn"]');
      const q = t ? this.userQuery(t) : "";
      return (q.split("\n")[0] || "").slice(0, 80).trim() || "Google AI Mode";
    },

    getConversationId() {
      try { const u = new URL(location.href); return u.searchParams.get("mtid") || u.searchParams.get("q") || null; }
      catch { return null; }
    },

    // Replace each math widget with its LaTeX source ($…$ inline / $$…$$ display).
    inlineMath(clone) {
      for (const el of [...clone.querySelectorAll("[data-xpm-copy-root]")]) {
        const latex = el.getAttribute("data-xpm-latex")
          || [...el.querySelectorAll("[data-xpm-latex]")].map((x) => x.getAttribute("data-xpm-latex") || "").filter(Boolean).join("");
        if (!latex) continue;
        const inline = /display\s*:\s*inline/i.test(el.getAttribute("style") || "");
        el.replaceWith(document.createTextNode(inline ? `$${latex}$` : `\n\n$$${latex}$$\n\n`));
      }
    },

    // The answer's image strip is a horizontal carousel with a Next/Suivant
    // scroll button — the ONLY thing that distinguishes it from the rhs-col
    // sources panel (both hold encrypted-tbn source thumbnails). Verified: turn
    // with a picture query has exactly its strip images; text-only turns have no
    // such carousel → no stray images. Returns the strip's image srcs, deduped.
    carouselImages(turn) {
      const NEXT = /^(Suivant|Next|Weiter|Siguiente|Successivo|Próximo|Volgende|Далее|次へ|下一个|다음)$/i;
      const btn = [...turn.querySelectorAll("[aria-label]")].find((e) => NEXT.test((e.getAttribute("aria-label") || "").trim()));
      if (!btn) return [];
      let box = btn.parentElement;
      for (let d = 0; d < 8 && box; d++) {
        if (box.querySelectorAll('img[src*="images?q=tbn"], img[src*="gstatic.com/images"]').length >= 2) break;
        box = box.parentElement;
      }
      if (!box) return [];
      const seen = new Set();
      const out = [];
      for (const im of box.querySelectorAll('img[src*="images?q=tbn"], img[src*="gstatic.com/images"]')) {
        const s = im.getAttribute("src"); if (s && !seen.has(s)) { seen.add(s); out.push(s); }
      }
      return out;
    },

    // Citations: the inline "⊘" chips are empty-text links we drop, but the
    // rhs-col sources panel holds the real {title, domain, url} cards. Collect
    // them (deduped) into a Sources list — text links only, no thumbnails.
    extractSources(turn) {
      const rhs = turn.querySelector('[data-container-id="rhs-col"]');
      if (!rhs) return [];
      const seen = new Set();
      const out = [];
      for (const a of rhs.querySelectorAll('a[href^="http"]')) {
        const url = a.getAttribute("href") || "";
        if (!url || url.includes("google.com") || seen.has(url)) continue;
        let title = (a.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim();
        if (!title) title = (a.textContent || "").replace(/\s+/g, " ").trim();
        // Strip the localized "Opens in a new tab" a11y suffix + trailing ellipsis.
        title = title.replace(/\.?\s*(S'ouvre dans un nouvel onglet|Opens in a new tab|Se abre en una nueva pestaña|In neuem Tab öffnen)\.?\s*$/i, "").replace(/\s*\.{2,}\s*$/, "…").trim();
        if (!title || title.length < 3) continue;   // skip favicon/image-only links
        seen.add(url);
        let domain = ""; try { domain = new URL(url).hostname.replace(/^www\./, ""); } catch { /* keep empty */ }
        out.push({ title: title.slice(0, 120), url, domain });
      }
      return out;
    },

    answerMarkdown(turn) {
      const root = turn.querySelector('[data-container-id="main-col"]') || turn;
      const clone = root.cloneNode(true);
      this.inlineMath(clone);
      for (const b of [...clone.querySelectorAll("button[aria-label]")]) if (b.parentElement && b.parentElement !== clone) b.parentElement.remove();
      // ⚠ CLAUDE: do NOT strip .n6owBd — it's Google's PROSE-PARAGRAPH class
      // (intro/transition/closing paragraphs), NOT a math dup. Removing it
      // deleted every prose paragraph (kept only headings + bullets). Math
      // dedup is handled by the data-xpm-latex replacement above, so .n6owBd
      // removal is neither needed nor safe.
      for (const n of [...clone.querySelectorAll('button, style, script, noscript, svg, [hidden], [aria-hidden="true"], [style*="display:none"], [style*="display: none"]')]) n.remove();
      // Choppy fix: inline-only <div> → <span> so bold runs flow into sentences.
      for (const div of [...clone.querySelectorAll("div")]) {
        if (![...div.querySelectorAll("*")].some((c) => BLOCK.has(c.tagName) && c !== div)) {
          const span = document.createElement("span");
          while (div.firstChild) span.appendChild(div.firstChild);
          div.replaceWith(span);
        }
      }
      let md = NS.htmlToMarkdown(clone) || "";
      // Dedup adjacent identical images (Google renders a graph + its "lightbox"
      // full-size copy = the same src twice).
      const seenImg = new Set();
      md = md.replace(/!\[[^\]]*\]\(([^)]+)\)/g, (m, url) => (seenImg.has(url) ? "" : (seenImg.add(url), m)));
      // Drop broken images: empty-src image markdown, and lone "!" remnants
      // (Google lazy-image placeholders that render as bare "!").
      md = md.replace(/!\[[^\]]*\]\(\s*\)/g, "").replace(/\[\]\([^)]*\)/g, "").replace(/^\s*!+\s*$/gm, "");
      const cut = md.search(FEEDBACK_TRAIL); if (cut > 0) md = md.slice(0, cut);
      md = md.split("\n").filter((l) => {
        const t = l.trim();
        if (/^#+\s*$/.test(t)) return false;   // empty heading
        return !UI_LINE.test(t);
      }).join("\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
      // Prepend the answer's image strip (the Next/Suivant carousel) — the frog
      // photos live here, not in main-col, but they ARE answer content.
      const strip = this.carouselImages(turn);
      if (strip.length) md = strip.map((s) => `![](${s})`).join("\n\n") + (md ? "\n\n" + md : "");
      // Append the Sources list (from the rhs-col citation cards).
      const sources = this.extractSources(turn);
      if (sources.length) {
        const list = sources.map((s, i) => `${i + 1}. [${s.title}](${s.url})${s.domain ? " — " + s.domain : ""}`).join("\n");
        md = (md ? md + "\n\n" : "") + "**Sources:**\n\n" + list;
      }
      return md;
    },

    // ⚠ CLAUDE: `[data-scope-id="turn"]` is NOT reliable on its own. Google
    // ships AI Mode without it on at least some builds — the competitor's
    // current build (AI Exporter 4.4.0) does not reference the attribute at
    // all and resolves a turn by climbing from `[data-subtree="aimc"]`
    // (the AI-Mode content subtree) to the ancestor that holds the query
    // bubble and exactly ONE such subtree. Keep both: the attribute when it
    // is there, that climb when it is not — otherwise a DOM refresh silently
    // returns zero turns, which reads as "extraction works but there are no
    // messages" and as "the inline buttons are gone".
    turns() {
      const tagged = [...document.querySelectorAll('[data-scope-id="turn"]')];
      if (tagged.length) return tagged;
      const out = new Set();
      for (const sub of document.querySelectorAll('[data-subtree="aimc"]')) {
        let box = sub;
        for (let d = 0; d < 10 && box; d++) {
          if (box.querySelector('span[jsname="y5v2y"], .iMqumd') && box.querySelectorAll('[data-subtree="aimc"]').length === 1) { out.add(box); break; }
          box = box.parentElement;
        }
      }
      return [...out];
    },

    // Google's own action row (copy · share · 👍 · 👎 · ⋯) under an answer.
    // ⚠ Its buttons are told apart only by LOCALIZED aria-labels — useless
    // across 27 languages. The stable anchor is the SHARE button's id
    // fragment `shrproxy`; climb from it until the ancestor holds the row.
    // (Same anchor AI Exporter 4.4.0 uses, for the same reason.)
    // ⚠ The test is on DIRECT CHILDREN, not on descendants. "Any ancestor
    // holding ≥4 buttons" stops at whatever wrapper sits around the row, and
    // prepending there drops our buttons into an anonymous line box ABOVE the
    // native ones and wraps Share onto its own line — which is exactly what it
    // did. The row is the box whose own children ARE the buttons, so ours
    // become their siblings and lay out with them.
    actionRow(turn) {
      const proxy = turn.querySelector('[id*="shrproxy"]');
      const share = proxy && (proxy.closest("button") || proxy.querySelector("button") || proxy);
      if (!share) return null;
      let box = share.parentElement;
      for (let d = 0; d < 10 && box; d++) {
        const own = [...box.children].filter((c) => c.matches("button[aria-label]") || c.querySelector("button[aria-label]")).length;
        if (own >= 4) return box;
        box = box.parentElement;
      }
      return null;
    },

    async extract() {
      const messages = [];
      if (!this.isAiMode()) return { title: this.title(), url: location.href, site: "google-aisearch", messages };
      for (const turn of this.turns()) {
        const q = this.userQuery(turn);
        if (q) messages.push({ role: "user", markdown: q });
        const a = this.answerMarkdown(turn);
        if (a) messages.push({ role: "assistant", markdown: a });
      }
      return { title: this.title(), url: location.href, site: "google-aisearch", messages };
    },

    extractOne(turn) {
      const md = this.answerMarkdown(turn);
      return md ? { role: "assistant", markdown: md } : null;
    },

    // ⚠ CLAUDE: never anchor on the turn itself — the shared mount PREPENDS,
    // so our buttons would land ABOVE the user's own query (the ChatGLM /
    // Dola mistake). First choice is Google's own action row; the answer
    // column is the fallback for an answer still streaming (the row appears
    // only when it finishes). `msg` stays the turn — answerMarkdown() reads
    // the carousel and the rhs-col sources off it, both outside main-col.
    findMountPoints() {
      const out = [];
      if (!this.isAiMode()) return out;
      for (const turn of this.turns()) {
        const bar = this.actionRow(turn) || turn.querySelector('[data-container-id="main-col"]');
        if (bar) out.push({ bar, msg: turn });
      }
      return out;
    }
  };
})();
