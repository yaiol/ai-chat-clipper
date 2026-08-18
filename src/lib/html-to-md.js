(() => {
  const NS = (globalThis.AiDoc ||= {});

  // Block-level tags used to decide whether a wrapper (div / custom element) is
  // a block container or just an inline paragraph.
  const BLOCK_SELECTOR = "p,div,section,article,main,figure,figcaption,"
    + "h1,h2,h3,h4,h5,h6,ul,ol,li,dl,dt,dd,"
    + "blockquote,pre,table,thead,tbody,tr,hr";

  function esc(s) {
    return s.replace(/([\\`*_{}\[\]()#+\-.!>])/g, "\\$1");
  }

  // ⚠ An EMPTY block element is layout, not structure. Dola separates the lines
  // of a paragraph with bare `<div></div>` spacers; because a `<div>` matches
  // BLOCK_SELECTOR, their mere presence made the surrounding wrapper look like a
  // block container, so every inline run was rendered through `block()` — which
  // splits them onto separate paragraphs AND strips emphasis (`block()` falls
  // through to `inlines()`, mapping a `<strong>`'s children and losing the `**`).
  // "This is **bold text**." came out as three paragraphs with no markers.
  // So: only a block element that actually holds something counts.
  function hasRealBlock(el) {
    if (!el?.querySelectorAll) return false;
    for (const b of el.querySelectorAll(BLOCK_SELECTOR)) {
      if ((b.textContent || "").trim() || b.querySelector("img,svg,video,canvas,input,pre,table")) return true;
    }
    return false;
  }

  // Tags whose whole meaning is inline markup — never render one through the
  // block path, which would drop its markers.
  const INLINE_TAGS = new Set(["strong", "b", "em", "i", "del", "s", "strike",
    "code", "a", "span", "sub", "sup", "mark", "u", "small", "abbr", "kbd"]);

  // A lazy-loading spacer: `data:image/svg+xml,<svg width=… height=…/>` with no
  // shapes inside. Dola emits one before every real picture; emitting it puts a
  // blank image in the export.
  function isBlankPlaceholderImage(src) {
    if (!/^data:image\/svg\+xml/i.test(src)) return false;
    let svg = src;
    try { svg = decodeURIComponent(src); } catch { /* keep raw */ }
    return !/<(path|circle|rect|ellipse|polygon|polyline|line|text|image|use|g)\b/i.test(svg);
  }

  function textContent(node) {
    return (node.textContent || "").replace(/\u00a0/g, " ");
  }

  // Skip elements injected by the extension itself (the inline action button + its
  // hover menu). Without this filter htmlToMarkdown picks up our injected
  // <img src="chrome-extension://…app.svg"> and emits it inside the export.
  function isAiDocChrome(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
    const cls = (el.className || "").toString();
    return cls.includes("adx-btn") || cls.includes("adx-menu");
  }

  // Meta AI (and Facebook chat) renders math as server-side <img> tags whose
  // alt text is the LaTeX source, e.g.
  //   <img alt="x = \frac{-b}{2a}" src="…fbcdn…/latex.png?…">
  // Those CDN URLs are session-bound and 403 outside meta.ai, so we convert
  // them back to inline / display math markup. KaTeX re-renders them at view
  // time when the user has math rendering on.
  function isLatexImage(el) {
    const src = el.getAttribute && (el.getAttribute("src") || "");
    if (!src) return false;
    if (!/\/latex\.png(\?|#|$)/.test(src)) return false;
    const alt = (el.getAttribute("alt") || "").trim();
    return alt.length > 0;
  }
  function isDisplayMath(img) {
    // Walk up to the nearest block-level ancestor; if its non-whitespace text
    // is exactly the image's alt text, the image stands alone → display mode.
    // Table cells / list items are NOT treated as block here on purpose:
    // math inside a <td> or <li> should stay inline so the surrounding row
    // isn't broken by `$$…$$` blocks.
    const blockTags = new Set(["div", "p", "section", "article", "figure", "main"]);
    let n = img.parentElement;
    while (n) {
      if (blockTags.has((n.tagName || "").toLowerCase())) {
        const t = (n.textContent || "").replace(/\s+/g, "");
        const a = (img.getAttribute("alt") || "").replace(/\s+/g, "");
        return t === a || t === "";
      }
      n = n.parentElement;
    }
    return false;
  }

  // KaTeX renders every formula THREE times over: a MathML tree, an
  // <annotation encoding="application/x-tex"> holding the LaTeX source, and the
  // visual .katex-html. Converting the subtree naively concatenates all three —
  // "ax2+bx+c=0" + "ax^2 + bx + c = 0" + "ax2+bx+c=0" — which is what a DOM-path
  // export used to show. The annotation IS the source, so emit that as math
  // markup and drop the rest. Sites whose KaTeX ships no annotation (Kimi,
  // MiniMax) fall back to the visual layer alone — degraded, but not tripled.
  function isKatex(el) {
    return el.classList && el.classList.contains("katex");
  }
  function katexMarkup(el) {
    const tex = (el.querySelector('annotation[encoding="application/x-tex"]')?.textContent || "").trim();
    if (!tex) {
      const visual = el.querySelector(".katex-html");
      return visual ? textContent(visual).trim() : textContent(el).trim();
    }
    // ⚠ `.katex-display` is KaTeX's OWN display marker and the only signal used
    // here. The "is the formula alone in its block?" heuristic that works for
    // Meta AI's latex <img> must NOT be reused: z.ai wraps EVERY formula,
    // inline ones included, in a `div.inline-flex` holding nothing else, so that
    // test marked all of them display and put `$$…$$` in the middle of a
    // sentence. A site that renders display math without `.katex-display`
    // therefore exports it as `$…$` on its own line — right formula, right
    // place, merely not centred. Under-calling display is cosmetic;
    // over-calling it breaks the surrounding prose.
    return el.closest(".katex-display") ? `\n\n$$${tex}$$\n\n` : `$${tex}$`;
  }

  // ── Inline <svg> ──────────────────────────────────────────────────────
  // An inline SVG is CONTENT on some sites (Kimi renders markmap mind-maps
  // this way; chart widgets elsewhere) and pure chrome on every site (button
  // icons). It used to be dropped SILENTLY in both cases: a rendered mind-map
  // simply vanished from the export with nothing to show it had been there.
  //
  // Discriminator: a content SVG carries TEXT or a substantial drawing; an icon
  // is a couple of <path>s with no label. Measured on a Kimi chat (2026-08-06):
  // the two markmaps carry <text> labels and an inline <style>, while all 159
  // other SVGs on the page are 16-24px icon paths.
  const SVG_MIN_SHAPES = 8;
  const SVG_SHAPES = "path, circle, rect, ellipse, polygon, polyline, line";
  function isContentSvg(el) {
    if (el.querySelector("text, image, foreignObject")) return true;
    return el.querySelectorAll(SVG_SHAPES).length >= SVG_MIN_SHAPES;
  }
  function svgMarkup(el) {
    if (!isContentSvg(el)) return "";
    const clone = el.cloneNode(true);
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    // ⚠ A data: URI has no page CSS and no layout box, so a RELATIVE size
    // renders as nothing — and relative is exactly what markmap emits
    // (width="100%" height="50vh"). Pin the size: prefer numeric attributes,
    // else measure the live element. Adding a matching viewBox keeps user units
    // equal to CSS pixels, which is the coordinate space such an SVG was laid
    // out in when it declared no viewBox of its own.
    const num = v => (/^\d+(\.\d+)?(px)?$/.test(v || "") ? parseFloat(v) : 0);
    let w = num(el.getAttribute("width")), h = num(el.getAttribute("height"));
    if (!w || !h) {
      const r = el.getBoundingClientRect?.();
      if (r?.width && r?.height) { w = Math.round(r.width); h = Math.round(r.height); }
    }
    if (w && h) {
      clone.setAttribute("width", String(w));
      clone.setAttribute("height", String(h));
      if (!clone.getAttribute("viewBox")) clone.setAttribute("viewBox", `0 0 ${w} ${h}`);
    } else {
      clone.removeAttribute("width");
      clone.removeAttribute("height");
    }
    // base64, not percent-encoding: encodeURIComponent leaves "(" and ")"
    // untouched and either one ends the markdown image early.
    try {
      const bytes = new TextEncoder().encode(clone.outerHTML);
      let bin = "";
      for (const b of bytes) bin += String.fromCharCode(b);
      return `![](data:image/svg+xml;base64,${btoa(bin)})`;
    } catch { return ""; }
  }

  function inline(node) {
    if (isAiDocChrome(node)) return "";
    if (node.nodeType === Node.TEXT_NODE) return textContent(node);
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    const el = node;
    if (isKatex(el)) return katexMarkup(el);
    const tag = el.tagName.toLowerCase();
    const inner = () => Array.from(el.childNodes).map(inline).join("");
    switch (tag) {
      case "br": return "\n";
      case "svg": return svgMarkup(el);
      case "strong": case "b": return `**${inner()}**`;
      case "em": case "i": return `*${inner()}*`;
      case "del": case "s": case "strike": return `~~${inner()}~~`;
      case "code": return `\`${textContent(el)}\``;
      case "a": {
        const href = el.getAttribute("href") || "";
        const t = inner().trim();
        return href ? `[${t}](${href})` : t;
      }
      case "img": {
        // Server-rendered LaTeX → re-emit as math markup so KaTeX can render
        // it. Facebook CDN URLs are session-bound; the alt is the source.
        if (isLatexImage(el)) {
          const tex = el.getAttribute("alt").trim();
          return isDisplayMath(el) ? `\n\n$$${tex}$$\n\n` : `$${tex}$`;
        }
        const alt = el.getAttribute("alt") || "";
        let src = el.getAttribute("src") || el.getAttribute("data-src") || "";
        if (!src) {
          const srcset = el.getAttribute("srcset") || el.getAttribute("data-srcset");
          if (srcset) src = srcset.split(",")[0].trim().split(/\s+/)[0];
        }
        if (isBlankPlaceholderImage(src)) return "";
        return src ? `![${alt}](${src})` : "";
      }
      case "picture": {
        const img = el.querySelector("img");
        if (img) return inline(img);
        const source = el.querySelector("source[srcset]");
        if (source) {
          const src = source.getAttribute("srcset").split(",")[0].trim().split(/\s+/)[0];
          return src ? `![](${src})` : "";
        }
        return "";
      }
      case "span": case "sub": case "sup": case "mark": case "u":
        return inner();
      case "div": {
        // An empty div reached inline is a line separator (see hasRealBlock).
        const body = inner();
        return body.trim() ? body : "\n";
      }
      case "input":
        // Rendered by the list handler as a task-list marker; never as text.
        return "";
      default: {
        // Elements using CSS background-image (common on meta.ai, Gemini, etc.)
        const role = el.getAttribute && el.getAttribute("role");
        if (role === "img") {
          const alt = el.getAttribute("aria-label") || el.getAttribute("alt") || "";
          const bg = el.style?.backgroundImage || "";
          const m = bg.match(/url\(["']?([^"')]+)["']?\)/);
          if (m?.[1]) return `![${alt}](${m[1]})`;
          // also check nested img
          const img = el.querySelector?.("img");
          if (img) return inline(img);
        }
        return inner();
      }
    }
  }

  function block(node, depth = 0) {
    if (isAiDocChrome(node)) return "";
    if (node.nodeType === Node.TEXT_NODE) {
      const t = textContent(node).trim();
      return t ? t : "";
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    const el = node;
    const tag = el.tagName.toLowerCase();
    const children = Array.from(el.childNodes);
    const blocks = () => children.map(c => block(c, depth)).filter(Boolean).join("\n\n");
    const inlines = () => children.map(inline).join("").trim();

    switch (tag) {
      case "h1": case "h2": case "h3": case "h4": case "h5": case "h6":
        return `${"#".repeat(Number(tag[1]))} ${inlines()}`;
      case "p": return inlines();
      case "hr": return "---";
      case "blockquote":
        return blocks().split("\n").map(l => `> ${l}`).join("\n");
      case "pre": {
        const code = el.querySelector("code");
        const langEl = code?.className?.match(/language-([\w+-]+)/);
        const lang = langEl ? langEl[1] : "";
        const body = (code || el).textContent.replace(/\n$/, "");
        return "```" + lang + "\n" + body + "\n```";
      }
      case "ul": case "ol": {
        const ordered = tag === "ol";
        // ⚠ CLAUDE: an <li> is NOT always a direct child of its list. Google's AI Overview wraps
        // every item in a <div data-bfc> inside the <ul>, so this filter found ZERO items and the
        // ENTIRE list vanished from the export - heading kept, bullets gone, and nothing reported it
        // (2026-08-12, "how old is the cat"). Descend through wrapper elements to reach the real
        // items; stop at a nested list, which belongs to its own <li> and is handled below.
        const itemsOf = (list) => {
          const out = [];
          for (const c of list.children) {
            if (c.tagName === "LI") out.push(c);
            else if (c.tagName !== "UL" && c.tagName !== "OL") out.push(...itemsOf(c));
          }
          return out;
        };
        const items = itemsOf(el);
        return items.map((li, i) => {
          const marker = ordered ? `${i + 1}.` : "-";
          const nested = [];
          const inlineBuf = [];
          // ⚠ CLAUDE: block-level children of an <li> (nested lists, but ALSO
          // code blocks, tables, blockquotes — or a wrapper <div> containing
          // one) must render as nested BLOCKS, not inline. Google AI Mode nests
          // a <pre> code widget inside each markdown-tag bullet; treating it
          // inline flattened the fence into "markdown`…`" garbage.
          const BLOCK_IN_LI = new Set(["UL", "OL", "PRE", "TABLE", "BLOCKQUOTE"]);
          for (const c of li.childNodes) {
            const isBlock = c.nodeType === Node.ELEMENT_NODE
              && (BLOCK_IN_LI.has(c.tagName)
                // ⚠ `ul, ol` belong in this probe. Dola wraps every nested list
                // in a plain <div>; without them the wrapper went inline and the
                // whole sub-list was flattened into the parent bullet's text.
                || (c.tagName === "DIV" && c.querySelector && c.querySelector("pre, table, blockquote, ul, ol")));
            if (isBlock) nested.push(block(c, depth + 1));
            else inlineBuf.push(inline(c));
          }
          // GFM task list: `<li><input type="checkbox" checked> text</li>`.
          const box = li.querySelector?.('input[type="checkbox"]');
          const task = box ? (box.hasAttribute("checked") || box.checked ? "[x] " : "[ ] ") : "";
          const head = `${"  ".repeat(depth)}${marker} ${task}${inlineBuf.join("").trim()}`;
          const sub = nested.length ? "\n" + nested.join("\n").split("\n").map(l => "  " + l).join("\n") : "";
          return head + sub;
        }).join("\n");
      }
      case "table": {
        const rows = Array.from(el.querySelectorAll("tr")).map(tr =>
          Array.from(tr.children).map(c => inline(c).replace(/\|/g, "\\|").replace(/\n/g, " ").trim())
        );
        if (!rows.length) return "";
        const header = rows[0];
        const body = rows.slice(1);
        const sep = header.map(() => "---");
        const fmt = r => `| ${r.join(" | ")} |`;
        return [fmt(header), fmt(sep), ...body.map(fmt)].join("\n");
      }
      case "div": case "section": case "article": case "main": {
        // A div with only inline content (text, <strong>, <em>, <br>, styled
        // spans - e.g. Kimi's `<div class="paragraph">`) is a PARAGRAPH, not a
        // block container. Rendering it via blocks() split every inline child
        // onto its own line. Fall through to inline unless it holds a real
        // block-level descendant.
        return hasRealBlock(el) ? blocks() : inlines();
      }
      case "svg": return svgMarkup(el);
      case "img": case "picture":
        return inline(el);
      default: {
        // If this element is inherently inline (img, a, span, role="img" wrappers),
        // render via inline() so attributes like src/href/background-image aren't lost.
        const role = el.getAttribute && el.getAttribute("role");
        if (role === "img") return inline(el);
        // Unknown / custom-element wrappers (Angular custom elements, web
        // components used by NotebookLM, Gemini, etc.). If any descendant
        // is block-level, treat this element as a block container -
        // otherwise we'd flatten paragraphs, headings, lists, or tables
        // into one inline run. Direct-child only isn't enough: Gemini
        // wraps tables in multiple nested custom elements, so the outer
        // wrapper sees only another custom element as its direct child.
        const hasBlockDescendant = hasRealBlock(el);
        // An inline-markup tag reached through the block path must still go
        // through inline(), or its markers are stripped (`inlines()` maps the
        // CHILDREN, so a <strong> loses its `**`).
        if (INLINE_TAGS.has(tag)) return inline(el);
        if (hasBlockDescendant) return blocks();
        return inlines();
      }
    }
  }

  NS.htmlToMarkdown = function htmlToMarkdown(root) {
    if (!root) return "";
    // The DOM is feeding the convo (DOM-only site or an API adapter's DOM
    // fallback) — flag it so the debug bundle ships page_html even when API
    // captures exist (the Copilot empty-API case, 2026-07-21).
    NS.debug?.markDom?.();
    const out = Array.from(root.childNodes).map(n => block(n)).filter(Boolean).join("\n\n");
    return out.replace(/\n{3,}/g, "\n\n").trim();
  };

  // Image URLs that need to be inlined as base64 data URLs so saved files
  // (md/html/pdf/docx/odt) remain viewable outside the browser session.
  // - blob: URLs are tied to the page session (e.g. Gemini DOM images)
  // - Google user-content CDN URLs for Gemini-generated images are
  //   session/cookie-bound and silently 401/403 outside Gemini, plus they
  //   send no CORS headers so direct fetch from another origin is blocked.
  // - ChatGPT estuary URLs (generated images, uploads) are signature-bound
  //   and 403 outside the chat session (verified 2026-07-21).
  // - Copilot th/id generated-image URLs are public today but are transient
  //   generation artifacts — embed so the file outlives them.
  // - Merlin generated images (storage.googleapis.com/dall-e-images/) — same:
  //   public bucket today, transient generation artifact.
  // - Grok-on-X generated images (api.x.com/2/grok/attachment.json?mediaId=…)
  //   are session artifacts behind an X endpoint. ⚠ The SAME image appears under
  //   two different srcs depending on how long the tab has been open: X starts
  //   with this URL and later swaps in a `blob:` — a capture taken at export
  //   time held the api.x.com form, so covering only `blob:` left that export
  //   with a bare link that renders nowhere but a logged-in x.com tab. Measured
  //   2026-08-06: the endpoint is CORS-enabled and returns 200 image/jpeg even
  //   with credentials omitted, so the content-script fetch resolves it and no
  //   host permission (a store permission warning) is needed for api.x.com.
  // - Mistral generated images (…blob.core.windows.net/chat-images/) carry a
  //   SAS token that expires within the HOUR — an export made at 19:57 has a
  //   dead link by 20:00, so inlining is the only way the file survives. The
  //   adapter unwraps Mistral's `/cdn-cgi/image/width=800,…/` proxy first, so
  //   what reaches here is the absolute, full-resolution blob URL.
  const NEEDS_INLINING = /^(blob:|https:\/\/[^/]*\.googleusercontent\.com\/|https:\/\/chatgpt\.com\/backend-api\/estuary\/content|https:\/\/copilot\.microsoft\.com\/th\/id\/|https:\/\/storage\.googleapis\.com\/dall-e-images\/|https:\/\/api\.x\.com\/2\/grok\/attachment\.json|https:\/\/[^/]*\.blob\.core\.windows\.net\/chat-images\/)/;
  // Matches every markdown image with a blob/remote URL; NEEDS_INLINING is
  // the single filter deciding which of them actually get inlined.
  const IMG_URL_RE = /!\[([^\]]*)\]\(((?:blob:|https?:\/\/)[^)]+)\)/g;

  NS.resolveBlobUrls = async function resolveBlobUrls(markdown) {
    if (!markdown) return markdown;
    const matches = [...markdown.matchAll(IMG_URL_RE)];
    if (!matches.length) return markdown;
    const urls = [...new Set(matches.map(m => m[2]))].filter(u => NEEDS_INLINING.test(u));
    if (!urls.length) return markdown;
    const cache = new Map();
    const fetchToDataUrl = async (u, opts) => {
      const resp = await fetch(u, opts);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const blob = await resp.blob();
      return new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result);
        r.onerror = () => rej(r.error);
        r.readAsDataURL(blob);
      });
    };
    await Promise.all(urls.map(async (u) => {
      // Strategy: content-script fetch first (uses page origin + cookies, works
      // for site-bound images like Gemini's lh3.googleusercontent.com). If that
      // fails, fall back to background fetch (uses host_permissions, no
      // credentials, works for plain public CDN URLs).
      try {
        const dataUrl = await fetchToDataUrl(u, { credentials: "include" });
        cache.set(u, dataUrl);
        return;
      } catch (e1) {
        try {
          const res = await chrome.runtime.sendMessage({ type: "adx:fetch-as-data-url", url: u });
          if (res?.ok) {
            cache.set(u, res.dataUrl);
            return;
          }
          console.warn(NS.TAG, "image fetch failed:", u,
            "| page-fetch:", String(e1?.message || e1),
            "| bg-fetch:", res?.error || "no response");
        } catch (e2) {
          console.warn(NS.TAG, "image fetch threw:", u, "page:", e1, "bg:", e2);
        }
        cache.set(u, null);
      }
    }));
    return markdown.replace(IMG_URL_RE, (full, alt, url) => {
      if (!NEEDS_INLINING.test(url)) return full;
      const data = cache.get(url);
      if (data) return `![${alt}](${data})`;
      // ⚠ Inlining FAILED — keep the original URL, never replace the image with
      // a text placeholder. Inlining is an ENHANCEMENT (it makes a saved file
      // viewable outside the browser session); losing it must not cost the image
      // itself. Dropping it here silently deleted all 225 images of a Gemini
      // /library export (2026-08-05): those URLs are cookie-bound, so the
      // content-script fetch fails CORS and the background fetch gets 403 — both
      // documented on NEEDS_INLINING above — and every picture became
      // "*[image: …]*" with nothing to recover from. A live URL still renders in
      // the media page and in an HTML export, and still downloads; a placeholder
      // is worth nothing to anyone.
      return full;
    });
  };
})();
