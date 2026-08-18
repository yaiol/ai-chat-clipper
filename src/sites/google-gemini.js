(() => {
  const NS = (globalThis.AiDoc ||= {});
  const sites = (NS.sites ||= {});

  const RPC_TAG = "wrb.fr";
  const RPCID = "hNvQHb";
  const PAGE_SIZE = 100;

  // Safe nested access: get(obj, [0,1,2], default)
  function get(obj, path, def) {
    let cur = obj;
    for (const k of path) {
      if (cur == null) return def;
      cur = Array.isArray(cur) ? cur[k] : cur[k];
    }
    return cur === undefined || cur === null ? def : cur;
  }

  function extractTextArray(arr) {
    if (!arr) return [];
    if (typeof arr === "string") return arr.trim() ? [arr] : [];
    if (!Array.isArray(arr)) return [];
    const out = [];
    for (const e of arr) {
      if (typeof e === "string" && e.trim()) out.push(e);
      else if (Array.isArray(e)) out.push(...extractTextArray(e));
      else if (e && typeof e === "object") {
        for (const v of Object.values(e)) if (typeof v === "string" && v.trim()) out.push(v);
      }
    }
    return out;
  }

  // Read window.WIZ_global_data from the page's MAIN world via background scripting.
  // Avoids inline <script> injection (Gemini's CSP forbids it).
  async function readPageGlobals() {
    const res = await chrome.runtime.sendMessage({
      type: "adx:read-page-globals",
      keys: ["FdrFJe", "cfb2h", "Im6cmf", "SNlM0e"]
    });
    if (!res?.ok) throw new Error(res?.error || "Could not read page globals");
    return res.payload || {};
  }

  function parseBatchResponse(text) {
    let s = text;
    s = s.replace(/^\)\]\}'\s*\n/, "");
    const lines = s.split("\n").filter(l => l.trim() !== "");
    const arrays = [];
    for (const line of lines) {
      const t = line.trim();
      if (/^\d+$/.test(t)) continue;
      if (!t.startsWith("[")) continue;
      try { arrays.push(JSON.parse(t)); } catch {}
    }
    return arrays;
  }

  function extractChatData(arrays) {
    for (const arr of arrays) {
      const rows = Array.isArray(arr) ? arr : [];
      for (const row of rows) {
        if (!Array.isArray(row)) continue;
        if (row[0] !== RPC_TAG || row[1] !== RPCID) continue;
        try {
          const payload = JSON.parse(row[2]);
          const continueCursor = get(payload, [1], "");
          const items = get(payload, [0], []);
          return {
            continueCursor,
            items: Array.isArray(items) ? [...items].reverse() : []
          };
        } catch {}
      }
    }
    return null;
  }

  // Walk item[3][12][0][0] to find pairs of (placeholder URL, real CDN URL).
  // Gemini answer text contains placeholders like
  //   http://googleusercontent.com/image_generation_content/N
  // and the real image URL (https://lh3.googleusercontent.com/gg-...) lives in
  // a metadata tree alongside it. We swap each placeholder for the real URL.
  function extractImageReplacements(item) {
    // ⚠ CLAUDE: two mapping subtrees exist (debug-bundle capture, 2026-07-19):
    // generated images under item[3][12], but web/search images (e.g. the
    // <Image src="image_agent_tag_…"/> cards) under item[3][0][0][12]. Walk
    // both. Placeholders are ANY http://googleusercontent.com/<slug> URL
    // (image_generation_content/N, image_agent_tag_N, lmdx_image/N, …), and
    // the real CDN URL may be lh3.googleusercontent.com OR *.gstatic.com
    // (licensed/search images) — the old lh3-only + generation_content-only
    // filters silently dropped every search-image mapping.
    const roots = [get(item, [3, 12, 0, 0], null), get(item, [3, 0, 0, 12], null)];
    const pairs = [];
    const seen = new Set();
    const isCdn = (u) => typeof u === "string"
      && /^https:\/\/(lh3\.googleusercontent\.com|[^/]+\.gstatic\.com|[^/]+\.googleusercontent\.com)\//.test(u);
    const isPlaceholder = (u) => typeof u === "string"
      && u.startsWith("http://googleusercontent.com/");
    function findFirstCdn(node) {
      if (isCdn(node)) return node;
      if (Array.isArray(node)) {
        for (const c of node) {
          const r = findFirstCdn(c);
          if (r) return r;
        }
      }
      return null;
    }
    function walk(node) {
      if (!Array.isArray(node)) return;
      // A mapping node holds a placeholder in one of its slots (seen at [1][0]
      // and [7][0] across revisions) and the real CDN URL elsewhere in the
      // same node. Pair placeholder -> first CDN URL within this node.
      for (let i = 0; i < node.length; i++) {
        const ph = get(node, [i, 0], null);
        if (isPlaceholder(ph) && !seen.has(ph)) {
          const real = findFirstCdn(node);
          if (real) { seen.add(ph); pairs.push({ placeholder: ph, real }); }
        }
      }
      for (const child of node) if (Array.isArray(child)) walk(child);
    }
    for (const root of roots) if (Array.isArray(root) && root.length) walk(root);
    return pairs;
  }

  function applyImageReplacements(text, pairs) {
    if (!text || !pairs.length) return text;
    let out = text;
    for (const { placeholder, real } of pairs) {
      // Replace the placeholder URL anywhere it appears (markdown, plain text).
      out = out.split(placeholder).join(real);
    }
    // ⚠ CLAUDE: Gemini also emits JSX-ish image cards whose src is the
    // placeholder SLUG only — <Image alt="…" caption="…" src="image_agent_tag_N"/>
    // — no host prefix, so the URL replacement above can never hit it. Convert
    // the tag to markdown using the matching pair; unmatched tags are left
    // as-is (the JSON exporter still surfaces them as typed image segments).
    out = out.replace(/<Image\b[^>]*\/?>/gi, (tag) => {
      const attr = (n) =>
        (tag.match(new RegExp(n + '\\s*=\\s*"([^"]*)"', "i")) || [])[1] || "";
      const src = attr("src");
      if (!src) return tag;
      const hit = pairs.find((p) =>
        p.placeholder === src || p.placeholder.endsWith("/" + src));
      if (!hit) return tag;
      const alt = attr("alt") || attr("caption") || "";
      const caption = attr("caption");
      return `![${alt}](${hit.real})` + (caption ? `\n*${caption}*` : "");
    });
    return out;
  }

  // Best-effort timestamp probe - Gemini's batchexecute response is opaque
  // positional data. Reverse-engineering found it reads
  // item[4][0], which in older builds was the message create time and in newer
  // builds is the modelId string. We try a few likely positions and accept
  // the first that looks like a Unix timestamp (either seconds or ms).
  function itemTime(item) {
    const candidates = [
      get(item, [4, 0],   null),
      get(item, [12],     null),
      get(item, [13],     null),
      get(item, [3, 1],   null),
      get(item, [3, 2],   null),
    ];
    for (const v of candidates) {
      if (typeof v !== "number") continue;
      // Heuristic: Unix seconds in [1.5e9, 4e9] or ms in [1.5e12, 4e12].
      if ((v > 1.5e9 && v < 4e9) || (v > 1.5e12 && v < 4e12)) return v;
    }
    return null;
  }

  function itemToMessages(item) {
    const out = [];
    const time = itemTime(item);
    // USER
    const askText = get(item, [2, 0, 0], "");
    const askAttachments = get(item, [2, 0, 4, 0, 3], []);
    const userParts = [];
    if (Array.isArray(askAttachments)) {
      for (const a of askAttachments) {
        if (!Array.isArray(a)) continue;
        const name = get(a, [2], "");
        const url = get(a, [3], "");
        const mime = get(a, [11], "") || "";
        if (mime.startsWith("image/") && url) userParts.push(`![${name}](${url})`);
        else if (name) userParts.push(`*[attachment: ${name}]*`);
      }
    }
    if (askText && typeof askText === "string") userParts.push(askText);
    const userMd = userParts.join("\n\n").trim();
    if (userMd) {
      const userEntry = { role: "user", markdown: userMd };
      if (time != null) userEntry.time = time;
      out.push(userEntry);
    }

    // ASSISTANT
    const replacements = extractImageReplacements(item);
    // Gemini stores the full assistant markdown - pipe-form tables, code
    // fences, math blocks - as a single string at [3, 0, 0, 1, 0]. Earlier
    // we used extractTextArray on the parent [3, 0, 0, 1], which recursed
    // through the surrounding metadata array. On some response shapes that
    // walk also collected cell-by-cell strings from a structured-table
    // representation and concatenated them without separators, destroying
    // the table layout in the export. The direct path is precise and
    // matches what the page renders. Fall back to the recursive walk only
    // when the direct path is empty (defensive - handles older builds).
    let answerText = (get(item, [3, 0, 0, 1, 0], "") || "").trim();
    if (!answerText) {
      answerText = extractTextArray(get(item, [3, 0, 0, 1], [])).join("\n").trim();
    }
    // Thinking: newer builds store the full text as a STRING at [37][0][0]
    // (older builds: an array of strings one level deeper). ⚠ CLAUDE: never
    // index one level past the string — string[0] is its first CHARACTER
    // ("*" from "**Initiating…"), which silently exported as the whole
    // thinking. Found via the debug-bundle raw capture, 2026-07-19.
    const tNode = get(item, [3, 0, 0, 37, 0, 0], null);
    let thinkingText = (typeof tNode === "string"
      ? tNode
      : extractTextArray(tNode || []).join("\n")).trim();
    answerText = applyImageReplacements(answerText, replacements);
    thinkingText = applyImageReplacements(thinkingText, replacements);

    // If a placeholder URL appears bare (no markdown wrapping) the real CDN URL
    // will now appear bare too - wrap it in image markdown so renderers display it.
    answerText = answerText.replace(
      /(^|\s)(https:\/\/[^/]*\.googleusercontent\.com\/[^\s)]+)/g,
      (_, lead, url) => `${lead}![](${url})`
    );

    const asstParts = [];
    if (thinkingText) {
      asstParts.push(`> **Thinking**\n> \n> ${thinkingText.replace(/\n/g, "\n> ")}`);
    }
    if (answerText) asstParts.push(answerText);
    const asstMd = asstParts.join("\n\n").trim();
    if (asstMd) {
      const asstEntry = { role: "assistant", markdown: asstMd };
      if (time != null) asstEntry.time = time;
      out.push(asstEntry);
    }

    return out;
  }

  async function fetchPage({ Im6cmf, FdrFJe, cfb2h, SNlM0e }, convId, cursor) {
    const base = `https://gemini.google.com${Im6cmf || "/_/BardChatUi"}/data/batchexecute`;
    const reqId = String(Math.floor(Math.random() * 9000000) + 1000000);
    const url = `${base}?rpcids=${RPCID}&source-path=${encodeURIComponent(location.pathname)}`
              + `&bl=${encodeURIComponent(cfb2h)}&f.sid=${encodeURIComponent(FdrFJe)}`
              + `&hl=en&_reqid=${reqId}&rt=c`;
    const inner = JSON.stringify([`c_${convId}`, PAGE_SIZE, cursor ?? null, 1, [0], [4], null, 1]);
    const body = new URLSearchParams();
    body.append("f.req", JSON.stringify([[[RPCID, inner, null, "generic"]]]));
    body.append("at", SNlM0e);
    const r = await fetch(url, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body: body.toString()
    });
    if (!r.ok) throw new Error(`Gemini batchexecute ${r.status}`);
    const text = await NS.debug.text(r, "google-gemini");
    return extractChatData(parseBatchResponse(text));
  }

  // ── Library (/library) — a gallery, not a conversation ────────────────────
  //
  // Gemini's library is a grid of generated media with no prompts and no turns,
  // so `extract()` returns one image "message" per card. That keeps it inside
  // the normal pipeline: the popup's Media button stashes the result and the
  // media page renders it, with no special-casing anywhere downstream.
  //
  // ⚠ FULL RESOLUTION IS THE WHOLE POINT — never export the card's `src`.
  // The thumbnail carries a `=w200-h200-n-v1-rj` suffix and is not merely small,
  // it is a SQUARE CROP of a 16:9 original. Measured on a live library
  // (2026-08-05): =w200-h200-n-v1-rj → 200x200, no suffix → 512x288,
  // =s0 → 1280x720, =w2048 → 1280x720 (so =s0 is the source, not an upscale).
  // Hence: strip the trailing =… segment and ask for =s0.
  const LIBRARY_CARD = "library-item-card img.thumbnail";
  const fullResUrl = (src) => src.replace(/=[^=/]*$/, "") + "=s0";

  // The grid lazy-loads: an `infinite-scroller.item-list` appends cards as it is
  // scrolled (60 cards had rendered where 30 were present moments earlier). Walk
  // it the way the z.ai loader does — stop on "did new cards arrive?", never on a
  // scroll position, because appended content moves the position back down.
  async function loadWholeLibrary() {
    const sc = document.querySelector("infinite-scroller.item-list");
    if (!sc) return;
    const count = () => document.querySelectorAll(LIBRARY_CARD).length;
    let quiet = 0;
    for (let step = 0; step < 40 && quiet < 3; step++) {
      const before = count();
      sc.scrollTop = sc.scrollHeight;
      await new Promise(r => setTimeout(r, 400));
      quiet = count() > before ? 0 : quiet + 1;
    }
  }

  sites["google-gemini"] = {
    id: "google-gemini",
    label: "Gemini",
    matches(host) { return host === "gemini.google.com"; },

    title() {
      // Gemini's <title> ends with " - Google Gemini" (newer) or " - Gemini"
      // (older). Strip both forms - without the optional "Google " prefix
      // the export filename ends up with " - Google Gemini" appended to
      // {title} when used with a filename template.
      return document.title.replace(/\s*[-|]\s*(Google\s+)?Gemini.*$/i, "").trim() || "Gemini chat";
    },

    // URL shape: /app/<convId> or /u/0/app/<convId> or /gem/<gemId>/<convId>
    getConversationId() {
      const segs = location.pathname.split("/").filter(Boolean);
      const last = segs[segs.length - 1];
      if (!last || last === "app" || last === "gem") return null;
      if (!/^[A-Za-z0-9_-]{8,}$/.test(last)) return null;
      return last;
    },

    findMessages() {
      return document.querySelectorAll('user-query, model-response');
    },

    extractOne(el) {
      const role = el.tagName.toLowerCase() === "user-query" ? "user" : "assistant";
      const body = el.querySelector('.query-text, .markdown, message-content') || el;
      const md = NS.htmlToMarkdown(body);
      if (!md) return null;
      const out = { role: role, markdown: md };
      const time = NS.findMessageTime?.(el);
      if (time) out.time = time;
      return out;
    },

    findMountPoints() {
      const bars = document.querySelectorAll('message-actions div[class*="buttons-container"]');
      const out = [];
      for (const bar of bars) {
        const msg = bar.closest('model-response') || bar.closest('user-query');
        if (msg) out.push({ bar, msg });
      }
      return out;
    },

    // After API extraction, replace any auth-protected googleusercontent URLs
    // with the same image's blob: URL from the DOM. The blob URL is same-origin,
    // already loaded with the user's session, and our resolveBlobUrls turns it
    // into a base64 data URL that survives outside the page.
    swapImagesWithDomBlobs(messages) {
      const responseEls = document.querySelectorAll("model-response");
      let asstIdx = 0;
      for (const m of messages) {
        if (m.role !== "assistant") continue;
        const respEl = responseEls[asstIdx++];
        if (!respEl) continue;
        const blobs = Array.from(respEl.querySelectorAll('img[src^="blob:"]'))
          .map(i => i.src);
        if (!blobs.length) continue;
        // Strip any markdown image whose URL is a placeholder or googleusercontent CDN.
        m.markdown = m.markdown.replace(
          /!\[[^\]]*\]\((http:\/\/googleusercontent\.com\/image_generation_content\/[^)]+|https:\/\/[^/]*\.googleusercontent\.com\/[^)]+|https:\/\/[^/]*\.google\.com\/(?:rd-)?gg\/[^)]+)\)\s*/g,
          ""
        );
        // Also strip bare versions of those URLs that might appear without markdown wrapping.
        m.markdown = m.markdown.replace(
          /(https:\/\/[^/]*\.googleusercontent\.com\/[^\s)]+|https:\/\/[^/]*\.google\.com\/(?:rd-)?gg\/[^\s)]+|http:\/\/googleusercontent\.com\/image_generation_content\/\d+)/g,
          ""
        );
        // Prepend blob image markdown - resolveBlobUrls will inline these as data URLs.
        const imgMd = blobs.map(b => `![](${b})`).join("\n\n");
        m.markdown = (imgMd + "\n\n" + m.markdown).trim();
      }
      return messages;
    },

    isLibrary() { return /^\/(u\/\d+\/)?library(\/|$)/.test(location.pathname); },

    async extract() {
      const title = this.title();

      if (this.isLibrary()) {
        await loadWholeLibrary();
        const seen = new Set();
        const messages = [];
        // ⚠ DIAGNOSTIC — keep until the library path is confirmed working in a
        // real browser. It returned zero images twice while the same code
        // matched 30/30 cards when evaluated directly in the page, so the next
        // report needs to say WHICH half is failing rather than prompt a third
        // guess. Cheap, one line, console only.
        console.log(`${NS.TAG} library extract: path=${location.pathname} cards=${document.querySelectorAll("library-item-card").length} thumbs=${document.querySelectorAll(LIBRARY_CARD).length}`);
        for (const img of document.querySelectorAll(LIBRARY_CARD)) {
          const url = fullResUrl(img.src);
          if (!url || seen.has(url)) continue;
          seen.add(url);
          // Emitted as markdown by hand, NOT through htmlToMarkdown: that path
          // inlines googleusercontent images as base64 (NEEDS_INLINING), which
          // is right for a chat but would turn a 60-image library into tens of
          // megabytes in chrome.storage. The media page fetches on download
          // instead — *.googleusercontent.com is already in host_permissions.
          messages.push({ role: "assistant", markdown: `![](${url})` });
        }
        // inlineImages:false — see extractConvo() in content.js. A library is a
        // gallery of full-size originals; embedding them as base64 is tens of MB.
        return { title: title || "Gemini library", url: location.href, site: "google-gemini",
                 inlineImages: false, messages };
      }

      const convId = this.getConversationId();
      if (convId) {
        try {
          const globals = await readPageGlobals();
          if (!globals.FdrFJe || !globals.cfb2h || !globals.SNlM0e) {
            throw new Error("Missing Gemini session params (FdrFJe/cfb2h/SNlM0e). Refresh page.");
          }
          const all = [];
          let cursor = null;
          for (let page = 0; page < 20; page++) {
            const data = await fetchPage(globals, convId, cursor);
            if (!data || !data.items?.length) break;
            all.unshift(...data.items);
            if (data.items.length < PAGE_SIZE) break;
            cursor = data.continueCursor;
            if (!cursor) break;
          }
          let messages = [];
          for (const item of all) messages.push(...itemToMessages(item));
          messages = this.swapImagesWithDomBlobs(messages);
          if (messages.length) {
            return { title, url: location.href, site: "google-gemini", messages };
          }
        } catch (err) {
          console.warn(NS.TAG, "Gemini API extract failed, falling back to DOM:", err);
        }
      }
      // DOM fallback
      const messages = [];
      for (const n of this.findMessages()) {
        const one = this.extractOne(n);
        if (one) messages.push(one);
      }
      return { title, url: location.href, site: "google-gemini", messages };
    }
  };
})();
