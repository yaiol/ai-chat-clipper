(() => {
  const NS = (globalThis.AiDoc ||= {});
  const sites = (NS.sites ||= {});

  sites.grok = {
    id: "grok",
    label: "Grok",
    matches(host) {
      if (host === "grok.com" || host === "www.grok.com") return true;
      // Grok embedded in X (Twitter) at https://x.com/i/grok?conversation=...
      // Different backend than grok.com - the API path below will fail and
      // we'll fall back to DOM scraping. Registered so the extension at
      // least activates on those pages.
      if (host === "x.com" && location.pathname.startsWith("/i/grok")) return true;
      return false;
    },

    title() {
      return document.title.replace(/\s*[-|]\s*Grok.*$/i, "").trim() || "Grok chat";
    },

    getConversationId() {
      return location.pathname.match(/\/c\/([a-f0-9-]+)/)?.[1] || null;
    },

    async fetchResponseNodes(id) {
      const r = await fetch(`/rest/app-chat/conversations/${id}/response-node?includeThreads=true`, {
        credentials: "include", headers: { "Accept": "*/*" }
      });
      if (!r.ok) throw new Error(`Grok API ${r.status}`);
      return NS.debug.json(r, "grok");
    },

    async loadResponses(id, ids) {
      const r = await fetch(`/rest/app-chat/conversations/${id}/load-responses`, {
        method: "POST",
        credentials: "include",
        headers: { "Accept": "*/*", "Content-Type": "application/json" },
        body: JSON.stringify({ responseIds: ids })
      });
      if (!r.ok) throw new Error(`Grok API ${r.status}`);
      return NS.debug.json(r, "grok");
    },

    preprocess(text) {
      return (text || "")
        .replace(/\\\[([\s\S]*?)\\\]/g, "$$$$$1$$$$")
        .replace(/\\\(([\s\S]*?)\\\)/g, "$$$1$$");
    },

    buildImageUrl(u) {
      if (!u) return "";
      if (/^https?:\/\//.test(u)) return u;
      return `https://assets.grok.com/${u.replace(/^\//, "")}`;
    },

    // Generated images (and other rich content) arrive as a placeholder
    // `<grok:render card_id="X" …></grok:render>` tag in `message`, with the
    // real payload in `cardAttachmentsJson` (array of JSON strings keyed by id).
    // Parse them into an id→card map.
    parseCards(r) {
      const map = {};
      for (const s of (r.cardAttachmentsJson || [])) {
        try { const c = JSON.parse(s); if (c && c.id) map[c.id] = c; } catch { /* skip */ }
      }
      return map;
    },

    // A generated-image card → the prompt text followed by the image. Other
    // card types contribute nothing renderable (their tag is stripped).
    cardToMarkdown(card) {
      if (!card) return "";
      const parts = [];
      if (card.prompt?.trim()) parts.push(card.prompt.trim());
      const chunks = [];
      if (card.image_chunk) chunks.push(card.image_chunk);
      if (Array.isArray(card.image_chunks)) chunks.push(...card.image_chunks);
      for (const ch of chunks) {
        if (ch?.imageUrl) parts.push(`![](${this.buildImageUrl(ch.imageUrl)})`);
      }
      return parts.join("\n\n");
    },

    // Replace every `<grok:render …card_id="X"…></grok:render>` placeholder with
    // its resolved card markdown; an unknown card just drops the tag so no raw
    // XML leaks into the export.
    resolveRenderTags(text, cards) {
      return (text || "").replace(/<grok:render\b[^>]*><\/grok:render>/gi, (tag) => {
        const id = (tag.match(/card_id="([^"]+)"/i) || [])[1];
        return (id && cards[id]) ? this.cardToMarkdown(cards[id]) : "";
      });
    },

    // ── Grok-on-X (x.com) DOM extraction ──────────────────────────────────
    //
    // X embeds Grok at https://x.com/i/grok?conversation=… behind a different
    // backend than grok.com — the /rest/app-chat API doesn't exist there — so
    // this path is DOM-only. The DOM is React with atomic CSS hashes
    // (css-g5y9jx, r-1adg3ll…), almost no `data-testid`s, and **localized
    // aria-labels** ("Copier le texte" on a French account), so nothing here
    // may anchor on a label. Measured against a real 8-exchange chat; the
    // capture is kept at `local/test/grok-x/`.
    //
    // Layout: ONE conversation list whose DIRECT CHILDREN are the turns, in
    // order, user and assistant alike (plus an empty spacer child at each end).
    //
    // ⚠ The walker used to find turns by looking for `span[class*="r-1adg3ll"]`
    // — X's *text* span — and climbing out of it. That made a turn qualify by
    // CONTENT, so every answer that isn't primarily text was invisible: the
    // code-block answer, the table answer and the generated-image answer were
    // absent from the export entirely (3 of 8 in the capture, silently). Turns
    // now qualify by POSITION — child of the list — and the list itself is the
    // only thing found by content.

    // The conversation list = the lowest common ancestor of the text blocks.
    // Every user prompt is text, and prompts run from the first turn to the
    // last, so their LCA is the list — while a text-free answer still shows up
    // as one of its children.
    xcomList() {
      const scope = document.querySelector('[data-testid="primaryColumn"]') || document.body;
      const blocks = [...scope.querySelectorAll('div[style="display: block;"]')]
        .filter(d => d.querySelector('span[class*="r-1adg3ll"]'));
      if (!blocks.length) return null;
      let chain = null;
      for (const b of blocks) {
        const path = [];
        for (let n = b; n; n = n.parentElement) path.unshift(n);
        if (!chain) { chain = path; continue; }
        let i = 0;
        while (i < chain.length && i < path.length && chain[i] === path[i]) i++;
        chain = chain.slice(0, i);
      }
      let list = chain[chain.length - 1] || null;
      // A single-message chat puts the LCA inside the only turn; climb until
      // the node actually has siblings to enumerate.
      for (let i = 0; i < 8 && list && list.children.length < 2 && list.parentElement; i++) {
        list = list.parentElement;
      }
      return list;
    },

    xcomTurns() {
      const list = this.xcomList();
      if (!list) return [];
      return [...list.children]
        .filter(c => (c.textContent || "").trim() || c.querySelector("img"));
    },

    // Grok's answers carry an action bar; a user prompt carries no button at
    // all. Counting buttons is language-independent — the aria-labels are not.
    xcomRole(turn) {
      return turn.querySelector("button, [role='button']") ? "assistant" : "user";
    },

    // The action bar is the row the trailing share / like / dislike buttons
    // share. Start from the LAST button in the turn — always in that row, while
    // a code block's own copy button and an image card's controls sit earlier —
    // and climb to the first ancestor holding more than one button.
    xcomActionBar(turn) {
      const btns = turn.querySelectorAll("button");
      if (btns.length < 2) return null;
      let n = btns[btns.length - 1];
      for (let i = 0; i < 6 && n.parentElement; i++) {
        n = n.parentElement;
        if (n.querySelectorAll("button").length >= 2) return n;
      }
      return null;
    },

    extractXcomTurn(turnEl) {
      const role = this.xcomRole(turnEl);
      const clean = turnEl.cloneNode(true);
      const doc = clean.ownerDocument;

      // 1. Math. X renders KaTeX as a MathML tree PLUS a hidden
      //    `<code class="raw_katex">` holding the TeX — and, unlike real KaTeX,
      //    with no `.katex-html` and no `.katex-display`. Left alone every
      //    formula came out THREE times over: the MathML text ("ax2+bx+c=0"),
      //    the annotation, and the code span as a backtick literal. Rebuild
      //    each one as the bare annotation node the shared converter already
      //    knows, tagging display math with KaTeX's own `.katex-display` so it
      //    emits `$$…$$` (X marks it `<math display="block">` instead).
      clean.querySelectorAll("span.katex").forEach(k => {
        const raw = k.parentElement?.querySelector("code.raw_katex, code.raw_katex_block");
        const tex = (
          k.querySelector('annotation[encoding="application/x-tex"]')?.textContent ||
          raw?.textContent || ""
        ).trim();
        if (!tex) return;
        const display = !!k.querySelector('math[display="block"]') ||
                        (raw?.className || "").includes("raw_katex_block");
        const holder = doc.createElement("span");
        if (display) holder.className = "katex-display";
        const span = doc.createElement("span");
        span.className = "katex";
        const ann = doc.createElement("annotation");
        ann.setAttribute("encoding", "application/x-tex");
        ann.textContent = tex;
        span.appendChild(ann);
        holder.appendChild(span);
        k.replaceWith(holder);
      });
      clean.querySelectorAll("code.raw_katex, code.raw_katex_block").forEach(c => c.remove());

      // 2. Citation chips. X wraps each in `.omit-from-copy` — the noise its
      //    own copy button strips — but the chip HOLDS THE SOURCE LINK, which
      //    is exactly what a reader wants kept. Blanket-removing the wrapper
      //    (what this used to do) is why searched answers exported with no
      //    sources. Keep the link, drop the rest of the chip.
      clean.querySelectorAll(".omit-from-copy").forEach(chip => {
        const a = chip.querySelector("a[href]");
        if (a) chip.replaceWith(a); else chip.remove();
      });

      // 3. Source favicons are decoration (t3.gstatic.com/faviconV2 proxies) —
      //    they would export as a row of meaningless images.
      clean.querySelectorAll('img[src*="faviconV2"]').forEach(im => im.remove());

      // 4. A code block is `[data-testid="markdown-code-block"]`: a header
      //    (language label + copy button) above `<pre><code class="language-…">`.
      //    Keep the <pre> alone — the converter fences it and reads the language
      //    off the code class, while the header would glue "python" onto the
      //    first line of the listing.
      clean.querySelectorAll('[data-testid="markdown-code-block"]').forEach(cb => {
        const pre = cb.querySelector("pre");
        if (pre) cb.replaceWith(pre); else cb.remove();
      });

      // 5. Every remaining button is chrome: the action bar, the "Réflexions"
      //    thinking pill, the "N pages Web" pill, "Continuer dans Grok Imagine".
      //    Checked against the capture — no answer content sits inside one, and
      //    the generated image is a plain <img>, not a button.
      clean.querySelectorAll("button, [role='button']").forEach(b => b.remove());

      // 6. Headings. X renders no <h1>-<h6> at all — a heading is a span whose
      //    INLINE STYLE promotes it to a block with vertical margin; the level
      //    lives only in an atomic font-size class (r-uho16t, r-1blvdjr, …)
      //    that changes between X builds, so every heading is emitted as <h3>.
      //    ⚠ The class allow-list this used to require (r-adyw6z / r-135wba7)
      //    matched NOTHING on the captured page — all 8 headings of the
      //    markdown-cheat-sheet answer fell through as plain text. Match on the
      //    style, which is what actually carries the signal, and which nothing
      //    but a heading has.
      clean.querySelectorAll('span[style*="display: block"]').forEach(span => {
        if (!/margin/.test(span.getAttribute("style") || "")) return;
        const h = doc.createElement("h3");
        h.textContent = (span.textContent || "").trim();
        span.replaceWith(h);
      });

      // 7. Bold runs — `r-b88u0q` is X's heavy-weight class → <strong>. Skip
      //    spans that ALSO carry `r-1adg3ll`: those are paragraph wrappers (the
      //    bold sits on a child, not the wrapper).
      clean.querySelectorAll('span[class*="r-b88u0q"]').forEach(span => {
        const cls = (span.className || "").toString();
        if (cls.includes("r-1adg3ll")) return;
        const b = doc.createElement("strong");
        while (span.firstChild) b.appendChild(span.firstChild);
        span.replaceWith(b);
      });

      // 8. Italic runs — `r-36ujnk` carries italic styling → <em>. But X also
      //    renders a BLOCKQUOTE as italic, with the same class and no other
      //    marker (it emits no <blockquote>), which came out as a run of
      //    unbalanced `*` across the quoted paragraphs. The discriminator is
      //    `r-1x3r274`, X's inline-run marker: present on a real italic run,
      //    absent on the block wrapper. No marker → it's a quote, and a nested
      //    quote nests the same way, so `> >` falls out for free.
      clean.querySelectorAll('span[class*="r-36ujnk"]').forEach(span => {
        const inline = (span.className || "").toString().includes("r-1x3r274");
        const el = doc.createElement(inline ? "em" : "blockquote");
        while (span.firstChild) el.appendChild(span.firstChild);
        span.replaceWith(el);
      });

      // 9. Paragraph wrappers — `r-1adg3ll` is "this span is a paragraph block"
      //    → <p>, so html-to-md keeps them as separate blocks.
      clean.querySelectorAll('span[class*="r-1adg3ll"]').forEach(span => {
        const p = doc.createElement("p");
        while (span.firstChild) p.appendChild(span.firstChild);
        span.replaceWith(p);
      });

      // 10. Generic span-unwrap — anything still in a styled span is decorative;
      //     flatten it so its text reaches the surface for html-to-md.
      //     ⚠ Skip the math nodes rebuilt in step 1: unwrapping them undoes the
      //     whole repair and puts the raw MathML text back in the export.
      let pass = 0;
      while (pass++ < 4) {
        const stragglers = [...clean.querySelectorAll("span")]
          .filter(s => !s.closest(".katex, .katex-display"));
        if (!stragglers.length) break;
        for (const s of stragglers) {
          const parent = s.parentNode;
          if (!parent) continue;
          while (s.firstChild) parent.insertBefore(s.firstChild, s);
          parent.removeChild(s);
        }
      }

      const md = NS.htmlToMarkdown(clean);
      if (!md || !md.trim()) return null;
      return { role, markdown: md.trim() };
    },

    async extractXcom() {
      const messages = [];
      for (const turn of this.xcomTurns()) {
        const one = this.extractXcomTurn(turn);
        if (one) messages.push(one);
      }
      return { title: this.title(), url: location.href, site: "grok", messages };
    },

    async extract() {
      // x.com hosts Grok at /i/grok with a different backend than
      // grok.com. The /rest/app-chat/... API below doesn't exist there,
      // so go straight to the DOM extractor.
      if (location.host === "x.com") return this.extractXcom();

      const title = this.title();
      const id = this.getConversationId();
      if (id) {
        try {
          const nodes = await this.fetchResponseNodes(id);
          console.log(NS.TAG, "Grok response-node keys:", Object.keys(nodes || {}));
          console.log(NS.TAG, "Grok responseNodes length:", nodes?.responseNodes?.length);
          const ids = (nodes.responseNodes || []).map(n => n.responseId);
          if (!ids.length) throw new Error("No response nodes");
          const loaded = await this.loadResponses(id, ids);
          console.log(NS.TAG, "Grok loaded responses:", loaded?.responses?.length);
          const responses = [...(loaded.responses || [])].sort(
            (a, b) => new Date(a.createTime) - new Date(b.createTime)
          );
          const out = [];
          for (const r of responses) {
            if (r.partial) continue;
            const role = r.sender === "human" ? "user" : "assistant";
            const parts = [];
            if (r.generatedImageUrls?.length) {
              for (const u of r.generatedImageUrls) parts.push(`![](${this.buildImageUrl(u)})`);
            }
            if (r.fileAttachmentsMetadata?.length) {
              for (const f of r.fileAttachmentsMetadata) {
                if (f.fileMimeType?.startsWith("image/")) {
                  parts.push(`![](${this.buildImageUrl(f.fileUri)})`);
                } else if (f.fileName) {
                  parts.push(`*[attachment: ${f.fileName}]*`);
                }
              }
            }
            const cards = this.parseCards(r);
            const text = this.resolveRenderTags(this.preprocess(r.message), cards);
            if (text?.trim()) parts.push(text);
            const md = parts.join("\n\n").trim();
            if (md) {
              const entry = { role, markdown: md };
              if (r.createTime) entry.time = r.createTime;
              out.push(entry);
            }
          }
          if (out.length) {
            return { title, url: location.href, site: "grok", messages: out };
          }
        } catch (err) {
          console.warn(NS.TAG, "Grok API extract failed, falling back to DOM:", err);
        }
      }
      // DOM fallback - best-effort
      const messages = [];
      const nodes = document.querySelectorAll('[class*="message"], [data-message-id]');
      for (const n of nodes) {
        const md = NS.htmlToMarkdown(n);
        if (md) messages.push({ role: "assistant", markdown: md });
      }
      return { title, url: location.href, site: "grok", messages };
    },

    // ⚠ Two DIFFERENT pages behind one adapter — branch on the host. Every
    // selector below is grok.com's ("Read Aloud", "Regenerate", `[role=toolbar]`,
    // `[data-message-id]`); NONE of them exists on x.com, which is why the
    // inline buttons never appeared there. x.com anchors on the action bar
    // found positionally by `xcomActionBar` (its aria-labels are localized, so
    // they can't be matched).
    findMountPoints() {
      if (location.host === "x.com") {
        const out = [];
        for (const turn of this.xcomTurns()) {
          if (this.xcomRole(turn) !== "assistant") continue;
          const bar = this.xcomActionBar(turn);
          if (bar) out.push({ bar, msg: turn });
        }
        return out;
      }
      return this.grokcomTurns();
    },

    // ── grok.com DOM anchors ──────────────────────────────────────────────
    //
    // A turn is `div[id^="response-"]` and its parts are SIBLINGS, not nested:
    //   div#response-…
    //     |- div.message-bubble[data-testid="assistant-message"|"user-message"]
    //     |- div            (the hover rail)
    //     +- div.action-buttons > div.flex.items-center   (the native buttons)
    //
    // ⚠ The mount used to anchor on aria-labels ("Read Aloud", "Copy",
    // "Regenerate") and climb from the button with
    // `closest('[data-message-id], [class*="message"]')`. grok.com has NO
    // `data-message-id` anywhere, and `.message-bubble` is the action bar's
    // SIBLING, never its ancestor — so `msg` fell through to
    // `bar.parentElement`, i.e. `div.action-buttons`, whose textContent is
    // EMPTY. Every inline copy and every inline export therefore raised
    // "Empty message" and flashed the button red. Two of those aria-labels
    // are localized too ("Copier" on a French account), so which turns even
    // mounted depended on the UI language. Anchor on the message instead —
    // `data-testid` is not localized — and walk DOWN to its bar.
    GROKCOM_MSG_SEL: '[data-testid="assistant-message"], [data-testid="user-message"]',

    grokcomTurns() {
      return [...document.querySelectorAll(this.GROKCOM_MSG_SEL)].map(msg => {
        const turn = msg.closest('[id^="response-"]') || msg.parentElement;
        const holder = turn?.querySelector(".action-buttons");
        // The buttons sit in a flex row inside `.action-buttons`; ours are
        // inserted at its front edge, so mount on that row, not the wrapper.
        return { msg, bar: holder?.querySelector(":scope > div") || holder };
      }).filter(t => t.bar);
    },

    // One message straight from the live DOM — the inline buttons only. The
    // full-conversation export goes through the API above; this path just has
    // to agree with it.
    extractGrokcomMessage(el) {
      const role = el.getAttribute("data-testid") === "user-message" ? "user" : "assistant";
      const clean = el.cloneNode(true);

      // The thinking pill is collapsed chrome: the container holds the
      // "Réflexion : 12s" caption and nothing else — the reasoning text is not
      // in the DOM until the panel is expanded, so there is nothing to keep.
      clean.querySelectorAll(".thinking-container").forEach(n => n.remove());

      // grok marks its own chrome `print:hidden` — the "45 sources" pill row,
      // the action bar — which is exactly what an export must drop. Matched as
      // an attribute substring: the class needs a CSS escape for its colon.
      clean.querySelectorAll('[class*="print:hidden"]').forEach(n => n.remove());

      // A code block wraps a header (language label + copy button) above the
      // <pre>. Keep the <pre> alone, or the header glues the language name
      // onto the first line of the listing.
      clean.querySelectorAll("pre").forEach(pre => {
        const wrap = pre.parentElement;
        if (wrap && wrap !== clean && wrap.querySelector("button")) wrap.replaceWith(pre);
      });

      // Whatever is still a button is chrome (media controls, expanders).
      clean.querySelectorAll("button, [role='button']").forEach(b => b.remove());

      const md = this.preprocess(NS.htmlToMarkdown(clean));
      if (!md || !md.trim()) return null;
      const out = { role, markdown: md.trim() };
      const time = NS.findMessageTime?.(el);
      if (time) out.time = time;
      return out;
    },

    // Single-message extraction (DOM - for inline button)
    findMessages() {
      if (location.host === "x.com") return this.xcomTurns();
      return document.querySelectorAll(this.GROKCOM_MSG_SEL);
    },
    extractOne(el) {
      if (location.host === "x.com") return this.extractXcomTurn(el);
      return this.extractGrokcomMessage(el);
    }
  };
})();
