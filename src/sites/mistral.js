(() => {
  const NS = (globalThis.AiDoc ||= {});
  const sites = (NS.sites ||= {});

  // Mistral Le Chat (chat.mistral.ai). DOM-only. Measured on a live chat,
  // 2026-08-06.
  //
  // ⚠ Mistral exposes a clean semantic anchor — `[data-message-id]` carrying
  // `data-message-author-role="user|assistant"` — and this adapter used none of
  // it. It located messages by their "Copy to clipboard" button, then climbed
  // out of the action bar until an ancestor's text ran 30 characters longer.
  // That lands on a layout wrapper (`div.flex.min-w-0.flex-1.flex-col`) which
  // also holds Mistral's per-message chrome, which is why every single message
  // exported with a stray "19:57" clock line under it. Anchor on the message
  // element and strip the chrome by name.
  //
  // Chrome that lives INSIDE a message element:
  //   .text-hint           the clock ("19:57") and the thinking pill ("Travail
  //                        effectué pendant 2s"). Both are noise.
  //   button[aria-label]   the action bar (Like / Dislike / Copy / Lire à voix
  //                        haute / Copy code / image controls). The labels are
  //                        localized, so match the ATTRIBUTE, never its value.
  //   a button holding an  the "Sources" chip. Its images are Google favicon
  //   <img>                proxies (`/_next/image?url=…s2%2Ffavicons…`) — the
  //                        junk thumbnails that showed up in the media page.
  //
  // Content Mistral renders WITHOUT the element you would expect:
  //   div[role="table"]           a flat CSS grid, no <table> anywhere — the
  //   .rich-table                 4-column history table exported as 20 loose
  //                               paragraphs.
  //   [data-testid="code-block"]  <pre><code> with no `language-` class; the
  //                               language is only in the header icon's
  //                               aria-label ("python icon").
  //   img[src^="/cdn-cgi/image/"] a RELATIVE, downscaled (width=800) proxy in
  //                               front of the real Azure blob URL. Relative
  //                               means the inliner never matched it at all (it
  //                               requires blob:/http), so an export kept a link
  //                               that resolves nowhere — and the blob's SAS
  //                               token expires within the hour regardless.

  const CHROME_SEL = ".text-hint, button[aria-label]";
  const COPY_SEL = 'button[aria-label="Copy to clipboard"], button[aria-label="Copier dans le presse-papiers"]';

  // `div[role=table]` is a flat grid, row-major: a run of `columnheader`
  // children followed by `cell` children. The header run gives the column
  // count; `grid-template-columns` is presentation and not parsed.
  function gridToTable(grid, doc) {
    const kids = [...grid.children];
    const cols = kids.filter(k => k.getAttribute("role") === "columnheader").length;
    if (!cols || kids.length < cols) return;
    const rows = [];
    for (let i = 0; i < kids.length; i += cols) rows.push(kids.slice(i, i + cols));
    // Mistral appends a sticky gutter column holding a per-row action button;
    // it is empty in every row, so drop any column that is empty throughout.
    const keep = [];
    for (let c = 0; c < cols; c++) {
      if (rows.some(r => (r[c]?.textContent || "").trim())) keep.push(c);
    }
    if (!keep.length) return;
    const table = doc.createElement("table");
    rows.forEach((row, ri) => {
      const tr = doc.createElement("tr");
      for (const c of keep) {
        const cell = doc.createElement(ri === 0 ? "th" : "td");
        cell.innerHTML = row[c]?.innerHTML || "";
        tr.appendChild(cell);
      }
      table.appendChild(tr);
    });
    grid.replaceWith(table);
  }

  // Search citations are BUTTONS with no href — the source URL is not in the
  // DOM at all, only the domain text, which html-to-md glued onto the preceding
  // word ("…330 light-years awaysciencedaily.com"). Keep the attribution, set
  // it apart. ⚠ Run AFTER gridToTable: a rich-table's column headers are also
  // buttons (they sort), and those must stay plain labels.
  function unwrapButtons(root, doc) {
    for (const b of root.querySelectorAll("button")) {
      if (!b.parentNode) continue;
      if (b.querySelector("img")) { b.remove(); continue; }
      const t = (b.textContent || "").trim();
      if (!t) { b.remove(); continue; }
      b.replaceWith(doc.createTextNode(b.closest("table") ? t : ` [${t}]`));
    }
  }

  // Keep only the <pre>: the header carries the language label and a copy
  // button, and the language belongs on the <code> where html-to-md reads it.
  function fixCodeBlocks(root) {
    for (const cb of root.querySelectorAll('[data-testid="code-block"]')) {
      const pre = cb.querySelector("pre");
      if (!pre) { cb.remove(); continue; }
      const lang = (cb.querySelector('i[aria-label$=" icon"]')?.getAttribute("aria-label") || "")
        .replace(/\s*icon$/, "").trim();
      const code = pre.querySelector("code");
      if (lang && code && !/language-/.test(code.className || "")) {
        code.className = `${code.className || ""} language-${lang}`.trim();
      }
      cb.replaceWith(pre);
    }
  }

  function fixImages(root) {
    for (const img of root.querySelectorAll("img")) {
      const src = img.getAttribute("src") || "";
      // Favicon proxies for search sources — decoration, and what filled the
      // media page with unusable 16px thumbnails.
      if (/s2%2Ffavicons|s2\/favicons/.test(src)) { img.remove(); continue; }
      // Unwrap Mistral's resizing proxy to the underlying blob URL: absolute
      // (so the inliner matches it) and full resolution (160 KB vs 37 KB).
      const unwrapped = src.replace(/^\/cdn-cgi\/image\/[^/]*\//, "");
      if (unwrapped !== src) img.setAttribute("src", unwrapped);
      else if (src.startsWith("/")) img.setAttribute("src", new URL(src, location.origin).href);
    }
  }

  sites.mistral = {
    id: "mistral",
    label: "Mistral",
    matches(host) { return host === "chat.mistral.ai"; },

    title() {
      return document.title.replace(/\s*[-|]\s*(Le\s*Chat|Mistral).*$/i, "").trim() || "Mistral chat";
    },

    getConversationId() {
      return location.pathname.match(/\/chat\/([^/?#]+)/)?.[1] || null;
    },

    findMessages() {
      return document.querySelectorAll("[data-message-id]");
    },

    extractOne(el) {
      const role = el.getAttribute("data-message-author-role") || el.dataset.adxRole || "assistant";
      const clean = el.cloneNode(true);
      const doc = clean.ownerDocument;
      clean.querySelectorAll(CHROME_SEL).forEach(n => n.remove());
      clean.querySelectorAll('div[role="table"]').forEach(g => gridToTable(g, doc));
      unwrapButtons(clean, doc);
      fixCodeBlocks(clean);
      fixImages(clean);
      const md = NS.htmlToMarkdown(clean);
      if (!md || !md.trim()) return null;
      const out = { role, markdown: md.trim() };
      const time = NS.findMessageTime?.(el);
      if (time) out.time = time;
      return out;
    },

    async extract() {
      const messages = [];
      for (const el of this.findMessages()) {
        const one = this.extractOne(el);
        if (one) messages.push(one);
      }
      return { title: this.title(), url: location.href, site: "mistral", messages };
    },

    // The action bar is the row the trailing aria-labelled buttons share. Climb
    // from the LAST one — a code block's own "Copy code" button sits earlier in
    // the message. Every message has one (user rows carry Edit + Copy), so both
    // roles get an inline button, as before.
    _actionBar(msg) {
      const btns = msg.querySelectorAll("button[aria-label]");
      if (btns.length < 2) return msg.querySelector(COPY_SEL)?.parentElement || null;
      let n = btns[btns.length - 1];
      for (let i = 0; i < 5 && n.parentElement && n.parentElement !== msg; i++) {
        n = n.parentElement;
        if (n.querySelectorAll("button[aria-label]").length >= 2) return n;
      }
      return null;
    },

    findMountPoints() {
      const out = [];
      for (const msg of this.findMessages()) {
        const bar = this._actionBar(msg);
        if (bar) out.push({ bar, msg });
      }
      return out;
    }
  };
})();
