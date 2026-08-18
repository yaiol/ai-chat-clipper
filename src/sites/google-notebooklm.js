(() => {
  const NS = (globalThis.AiDoc ||= {});
  const sites = (NS.sites ||= {});

  // NotebookLM exposes a Google batchexecute RPC just like Gemini. The
  // response contains the model's *raw markdown* - properly structured
  // headings, lists and citations - which the rendered DOM does not
  // preserve. We use the API when we can capture the session tokens it
  // requires (atToken, conversationUuid, reqId - observed via background
  // webRequest), and fall back to DOM scraping otherwise.

  const RPC_TAG          = "wrb.fr";
  const RPCID_SUMMARY    = "VfAZjd";
  const RPCID_MESSAGES   = "khqZz";
  const API_BASE         = "https://notebooklm.google.com/_/LabsTailwindUi/data/batchexecute";
  const PAGE_SIZE        = 100;
  const MAX_PAGES        = 15;

  function get(obj, path, def) {
    let cur = obj;
    for (const k of path) {
      if (cur == null) return def;
      cur = cur[k];
    }
    return cur === undefined || cur === null ? def : cur;
  }

  // Google's batchexecute response is `)]}'` followed by lines that are
  // either a digit length-prefix or a JSON array. Returns the parsed arrays.
  function parseBatchResponse(text) {
    let s = text.replace(/^\)\]\}'\s*\n?/, "");
    const arrays = [];
    // The format is essentially newline-delimited JSON with leading
    // chunk-length integers. Walk forward, attempting to JSON.parse each
    // bracket-balanced span.
    let i = 0;
    while (i < s.length) {
      // Skip non-array prefix (lengths, whitespace).
      while (i < s.length && s[i] !== "[") i++;
      if (i >= s.length) break;
      // Bracket-balance scan.
      let depth = 0, inStr = false, esc = false, start = i;
      for (; i < s.length; i++) {
        const c = s[i];
        if (inStr) {
          if (esc) esc = false;
          else if (c === "\\") esc = true;
          else if (c === '"') inStr = false;
        } else {
          if (c === '"') inStr = true;
          else if (c === "[") depth++;
          else if (c === "]") { depth--; if (depth === 0) { i++; break; } }
        }
      }
      const slice = s.slice(start, i);
      try { arrays.push(JSON.parse(slice)); } catch {}
    }
    return arrays;
  }

  // Find the row matching a given RPC id within a batch response.
  function findRpcRow(arrays, rpcid) {
    for (const arr of arrays) {
      const rows = Array.isArray(arr) ? arr : [];
      for (const row of rows) {
        if (Array.isArray(row) && row[0] === RPC_TAG && row[1] === rpcid) return row;
      }
    }
    return null;
  }

  async function readPageGlobals() {
    const res = await chrome.runtime.sendMessage({
      type: "adx:read-page-globals",
      keys: ["FdrFJe", "cfb2h"]
    });
    if (!res?.ok) throw new Error(res?.error || "Could not read page globals");
    return res.payload || {};
  }

  async function readSession() {
    const res = await chrome.runtime.sendMessage({ type: "adx:notebooklm-session" });
    return res?.session || null;
  }

  function buildUrl({ bl, sid, reqId }) {
    const params = new URLSearchParams({
      rpcids:        "",                  // set per-call
      "source-path": location.pathname,
      bl:            bl  || "",
      "f.sid":       sid || "",
      hl:            "en",
      _reqid:        String(reqId),
      rt:            "c",
    });
    return params;
  }

  async function callRpc({ rpcid, innerJson, atToken, bl, sid, reqId }) {
    const params = buildUrl({ bl, sid, reqId });
    params.set("rpcids", rpcid);
    const url = `${API_BASE}?${params.toString()}`;
    const body = new URLSearchParams();
    body.append("f.req", JSON.stringify([[[rpcid, innerJson, null, "generic"]]]));
    body.append("at", atToken);
    const r = await fetch(url, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type":  "application/x-www-form-urlencoded;charset=UTF-8",
        "x-same-domain": "1",
      },
      body: body.toString(),
    });
    if (!r.ok) throw new Error(`NotebookLM batchexecute ${r.status}`);
    const text = await NS.debug.text(r, "google-notebooklm");
    const arrays = parseBatchResponse(text);
    const row = findRpcRow(arrays, rpcid);
    if (!row || typeof row[2] !== "string") throw new Error(`Bad ${rpcid} response shape`);
    return JSON.parse(row[2]);
  }

  async function fetchSummary(session, globals, reqId) {
    const inner = JSON.stringify([session.conversationUuid, [2]]);
    const payload = await callRpc({
      rpcid:     RPCID_SUMMARY,
      innerJson: inner,
      atToken:   session.atToken,
      bl:        globals.cfb2h,
      sid:       globals.FdrFJe,
      reqId,
    });
    return get(payload, [0, 0, 0], "") || "";
  }

  async function fetchMessagesPage(session, globals, reqId, cursor) {
    const inner = JSON.stringify([[], null, null, session.conversationUuid, PAGE_SIZE, cursor]);
    const payload = await callRpc({
      rpcid:     RPCID_MESSAGES,
      innerJson: inner,
      atToken:   session.atToken,
      bl:        globals.cfb2h,
      sid:       globals.FdrFJe,
      reqId,
    });
    const messages = get(payload, [0], []) || [];
    const rawCursor = get(payload, [1], null);
    const next = rawCursor && (typeof rawCursor === "string" || Array.isArray(rawCursor)) && rawCursor.length > 0
      ? rawCursor : null;
    return { messages: Array.isArray(messages) ? messages : [], nextCursor: next };
  }

  async function fetchAllMessages(session, globals, baseReqId) {
    const out = [];
    let cursor = null, page = 0;
    let reqId = parseInt(baseReqId, 10);
    if (isNaN(reqId)) reqId = Math.floor(Math.random() * 9_000_000) + 1_000_000;
    while (page < MAX_PAGES) {
      const { messages, nextCursor } = await fetchMessagesPage(session, globals, reqId + page, cursor);
      out.push(...messages);
      if (!nextCursor || messages.length < PAGE_SIZE) break;
      cursor = nextCursor;
      page++;
    }
    return out.reverse(); // API returns newest first; we want chronological.
  }

  async function extractViaApi(title) {
    const session = await readSession();
    if (!session?.atToken || !session?.conversationUuid) return null;

    const globals = await readPageGlobals();
    if (!globals.FdrFJe || !globals.cfb2h) return null;

    let baseReqId = session.reqId;
    if (baseReqId) {
      const n = parseInt(baseReqId, 10);
      if (!isNaN(n)) baseReqId = String(n + 100000);
    }

    const messages = [];
    try {
      const summaryText = await fetchSummary(session, globals, parseInt(baseReqId || "1000000", 10));
      if (summaryText) messages.push({ role: "assistant", markdown: summaryText });
    } catch (e) {
      console.warn(NS.TAG, "NotebookLM summary fetch failed", e);
    }

    let turns;
    try {
      turns = await fetchAllMessages(session, globals, baseReqId);
    } catch (e) {
      console.warn(NS.TAG, "NotebookLM messages fetch failed", e);
      return null;
    }

    for (const t of turns) {
      if (!Array.isArray(t)) continue;
      const userText = get(t, [3], "");
      const asstText = get(t, [4, 0, 0], "");
      if (userText) messages.push({ role: "user",      markdown: String(userText) });
      if (asstText) messages.push({ role: "assistant", markdown: String(asstText) });
    }

    if (!messages.length) return null;
    return { title, url: location.href, site: "google-notebooklm", messages };
  }

  // ── DOM fallback ────────────────────────────────────────────────────────
  // Used when we haven't captured the session tokens yet (e.g. the user
  // exports immediately after opening a notebook and the page hasn't issued
  // its own batchexecute call). Quality is limited - NotebookLM's rendered
  // DOM lacks real <ul>/<h*> elements for the model's markdown.

  function preprocessDom(body) {
    const clone = body.cloneNode(true);

    clone.querySelectorAll(
      "mat-icon, .material-icons, .material-icons-outlined, .material-symbols-outlined, .material-symbols-rounded, .material-symbols-sharp"
    ).forEach(el => el.remove());

    const CITATION_CLS_RE = /citation|cite-chip|citation-marker|source-ref|citation-button|source-chip|sources-button/i;
    const CITATION_TAG_RE = /^(citation|sources?-button|source-chip|cite|citation-chip|sources?-marker)$/i;
    const isChip = (el) => {
      const cls = (el.className || "").toString();
      if (CITATION_CLS_RE.test(cls)) return true;
      if (CITATION_TAG_RE.test(el.tagName || "")) return true;
      if (el.tagName === "BUTTON" && el.parentElement?.tagName === "SUP") return true;
      return false;
    };
    const CHIP_RE = /^\s*\d+(?:\s*[,\-\u2013]\s*\d+)*\s*$/;
    const normalize = (t) => t.replace(/\s+/g, "").replace(/\u2013/g, "-");

    clone.querySelectorAll(
      "button, a, cite, sup, span, citation, sources-button, source-chip, citation-chip"
    ).forEach(el => {
      if (!isChip(el)) return;
      const t = (el.textContent || "").trim();
      if (!CHIP_RE.test(t)) return;
      el.replaceWith(clone.ownerDocument.createTextNode(`[${normalize(t)}]`));
    });

    clone.querySelectorAll("span").forEach(span => {
      const disp = (span.style?.display || "").toLowerCase();
      if (disp === "block" || disp === "flex" || disp === "grid" || disp === "list-item") {
        const div = clone.ownerDocument.createElement("div");
        while (span.firstChild) div.appendChild(span.firstChild);
        for (const a of span.attributes) div.setAttribute(a.name, a.value);
        span.replaceWith(div);
      }
    });

    return clone;
  }

  function compactCitations(md) {
    md = md.replace(/\]\s+([.,;:!?])/g, "]$1");
    const CHIP = "\\[\\d+(?:\\s*[,\\-\u2013]\\s*\\d+)*\\]";
    const RUN = new RegExp("(?:" + CHIP + "\\s*){2,}", "g");
    const expand = (txt) => {
      const out = [];
      for (const part of txt.split(",")) {
        const p = part.trim();
        const range = p.match(/^(\d+)\s*[-\u2013]\s*(\d+)$/);
        if (range) {
          const a = +range[1], b = +range[2];
          for (let n = Math.min(a, b); n <= Math.max(a, b); n++) out.push(n);
        } else if (/^\d+$/.test(p)) out.push(+p);
      }
      return out;
    };
    return md.replace(RUN, (run) => {
      const nums = [];
      for (const m of run.matchAll(/\[([^\]]+)\]/g)) nums.push(...expand(m[1]));
      const unique = [...new Set(nums)].sort((a, b) => a - b);
      const isContig = unique.length >= 3 && unique.every((n, i) => i === 0 || n === unique[i - 1] + 1);
      if (isContig) return `[${unique[0]}-${unique[unique.length - 1]}]`;
      return `[${unique.join(", ")}]`;
    });
  }

  function detectRoleDom(el) {
    const cls      = (el.className || "").toString();
    const dataRole = el.getAttribute("data-role") || el.getAttribute("data-author") || el.getAttribute("role") || "";
    const haystack = (cls + " " + dataRole).toLowerCase();
    if (/from[-_]?user|user[-_]?(message|query|turn|chat|prompt)|is[-_]?user|\buser\b|human|question|prompt/.test(haystack)) return "user";
    if (el.closest && el.closest("user-query, from-user-query, from-user, user-prompt, chat-question, [class*='user-query' i], [class*='from-user' i], [class*='user-prompt' i]")) return "user";
    if (el.querySelector && el.querySelector("user-query, from-user-query, from-user, user-prompt, chat-question")) return "user";
    if (!el.querySelector?.('[class*="markdown" i], [class*="response-content" i], [class*="message-content" i], [class*="rich-text" i], message-content')) return "user";
    return "assistant";
  }

  function extractViaDom(title) {
    const nodes = document.querySelectorAll(
      "chat-message, user-query, from-user-query, from-user, user-prompt, chat-question"
    );
    const seen = new Set();
    const outNodes = [];
    for (const n of nodes) {
      let nested = false;
      for (const other of nodes) {
        if (other !== n && other.contains(n)) { nested = true; break; }
      }
      if (nested || seen.has(n)) continue;
      seen.add(n);
      outNodes.push(n);
    }

    const messages = [];
    for (const el of outNodes) {
      const tag = (el.tagName || "").toLowerCase();
      const role = /^(user-query|from-user-query|from-user|user-prompt|chat-question)$/.test(tag)
        ? "user"
        : detectRoleDom(el);
      const body = el.querySelector(
        '[class*="markdown" i], .message-content, [class*="message-text" i], [class*="response-content" i], [class*="rich-text" i]'
      ) || el;
      const clean = preprocessDom(body);
      let md = NS.htmlToMarkdown(clean);
      if (!md) continue;
      md = compactCitations(md);
      const out = { role, markdown: md };
      const time = NS.findMessageTime?.(el);
      if (time) out.time = time;
      messages.push(out);
    }
    return { title, url: location.href, site: "google-notebooklm", messages };
  }

  // ── Studio (notes / reports) extraction ────────────────────────────────
  //
  // NotebookLM Studio has two artifact wrappers:
  //
  //   Reports (long-form generated docs):
  //     studio-panel > artifact-viewer
  //       > div.artifact-viewer-container
  //           > div.artifact-header            ← toolbar (mount point)
  //           > div.artifact-content
  //               > report-viewer
  //                   > labs-tailwind-doc-viewer  ← rendered body
  //
  //   Notes (single-paragraph user/assistant notes):
  //     studio-panel > note-editor
  //       > form.note-form
  //           > div.note-title-container       ← title row (mount point)
  //               > input.note-header__editable-title
  //               > button.note-editor-delete-button
  //           > labs-tailwind-doc-viewer       ← rendered body
  //
  // Both bodies use the same labs-tailwind structural-element markup:
  //   div.paragraph.heading1 + role="heading" aria-level="1"   → <h1>
  //   div.paragraph.heading2 + aria-level="2"                  → <h2>
  //   …
  //   div.paragraph (no heading role)                          → <p>
  //   table-element-view, list-element-view, etc.              → recurse
  //
  // Angular's view-encapsulation attributes (`_ngcontent-ng-c<hash>`) change
  // on every build, so we deliberately avoid them and key only on stable
  // tag/class/role/aria selectors.

  const STUDIO_HOSTS = "artifact-viewer, note-editor";

  function isStudioArtifact(el) {
    return !!(el && (
      el.tagName === "ARTIFACT-VIEWER" ||
      el.tagName === "NOTE-EDITOR" ||
      el.closest?.(STUDIO_HOSTS)
    ));
  }

  function artifactTitleFromHeader(host) {
    if (!host) return null;
    const input = host.querySelector(
      "input.note-header__editable-title, .artifact-title-form input, .artifact-header input[type='text'], .artifact-header input, .note-title-container input"
    );
    if (input?.value && input.value.trim()) return input.value.trim();
    const titleEl = host.querySelector("editable-project-title, .artifact-title");
    const t = (titleEl?.textContent || "").trim();
    return t || null;
  }

  function preprocessNotebookLMStudio(body) {
    const clone = body.cloneNode(true);

    // 1. Drop UI chrome that lives inside the viewer.
    clone.querySelectorAll(
      ".artifact-header, .artifact-footer, .artifact-title-form, .note-title-container"
    ).forEach(el => el.remove());

    // 1b. Unwrap NotebookLM's structural carrier elements so the real
    //     semantic tags (h1/p/ul/table/…) end up as direct children of
    //     their natural parents. Without this, html-to-md sees an unknown
    //     custom tag wrapping each block and flattens everything inline.
    //
    //     Specifically:
    //       <element-list-renderer>          → unwrap
    //       <labs-tailwind-doc-viewer>       → unwrap
    //       <labs-tailwind-structural-element-view-v2> → unwrap
    //       <paragraph-element-view>         → unwrap
    //       <table-element-view>             → unwrap (keeps the inner <table>)
    //       <list-element-view>              → unwrap (if it exists)
    //       <report-viewer>                  → unwrap
    //
    //     We iterate until the document stabilises because unwrapping a
    //     parent surfaces inner wrappers that then also need unwrapping.
    const UNWRAP_TAGS = new Set([
      "element-list-renderer",
      "labs-tailwind-doc-viewer",
      "labs-tailwind-structural-element-view-v2",
      "paragraph-element-view",
      "table-element-view",
      "list-element-view",
      "report-viewer",
    ]);
    const unwrap = (el) => {
      const parent = el.parentNode;
      if (!parent) return;
      while (el.firstChild) parent.insertBefore(el.firstChild, el);
      parent.removeChild(el);
    };
    for (let pass = 0; pass < 6; pass++) {
      const toUnwrap = [...clone.querySelectorAll("*")].filter(el =>
        UNWRAP_TAGS.has(el.tagName.toLowerCase())
      );
      if (!toUnwrap.length) break;
      toUnwrap.forEach(unwrap);
    }
    // Also handle the case where the root itself is one of these.
    // (Children are returned via root.childNodes by htmlToMarkdown either way.)

    // 2. Strip Material Icons (their textContent is the ligature name).
    clone.querySelectorAll(
      "mat-icon, .material-icons, .material-icons-outlined, .material-symbols-outlined, .material-symbols-rounded, .material-symbols-sharp"
    ).forEach(el => el.remove());

    // 2b. Unwrap Google's redirect links. Anchors in NotebookLM content
    //     point at https://www.google.com/url?sa=E&q=<encoded-real-url>
    //     so the user sees a Google interstitial instead of the source.
    //     Replace the href with the decoded target.
    clone.querySelectorAll('a[href*="google.com/url"]').forEach(a => {
      try {
        const u = new URL(a.getAttribute("href"), location.origin);
        const real = u.searchParams.get("q") || u.searchParams.get("url");
        if (real) a.setAttribute("href", real);
      } catch {}
    });

    // 3. Citation chips. NotebookLM Studio renders citations as small
    //    clickable elements whose text is a single integer; without the
    //    chip → `[N]` rewrite they merge into the preceding word
    //    ("understanding1" instead of "understanding [1]").
    const CITATION_CLS_RE = /citation|cite-chip|citation-marker|source-ref|citation-button|source-chip|sources-button/i;
    const CITATION_TAG_RE = /^(citation|sources?-button|source-chip|cite|citation-chip|sources?-marker)$/i;
    const CHIP_RE = /^\s*\d+(?:\s*[,\-\u2013]\s*\d+)*\s*$/;
    const normalizeChip = (t) => t.replace(/\s+/g, "").replace(/\u2013/g, "-");
    const isChip = (el) => {
      const cls = (el.className || "").toString();
      if (CITATION_CLS_RE.test(cls)) return true;
      if (CITATION_TAG_RE.test(el.tagName || "")) return true;
      if (el.tagName === "BUTTON" && el.parentElement?.tagName === "SUP") return true;
      return false;
    };
    clone.querySelectorAll(
      "button, a, cite, sup, span, citation, sources-button, source-chip, citation-chip"
    ).forEach(el => {
      if (!isChip(el)) return;
      const t = (el.textContent || "").trim();
      if (!CHIP_RE.test(t)) return;
      el.replaceWith(clone.ownerDocument.createTextNode(` [${normalizeChip(t)}]`));
    });

    // 4. Promote heading paragraphs to real heading elements.
    clone.querySelectorAll('div.paragraph[role="heading"], div.paragraph.heading1, div.paragraph.heading2, div.paragraph.heading3, div.paragraph.heading4, div.paragraph.heading5, div.paragraph.heading6').forEach(div => {
      let level = parseInt(div.getAttribute("aria-level") || "", 10);
      if (!level || level < 1 || level > 6) {
        const m = (div.className || "").toString().match(/heading([1-6])/);
        if (m) level = parseInt(m[1], 10);
      }
      if (!level) level = 3;
      const h = clone.ownerDocument.createElement("h" + level);
      while (div.firstChild) h.appendChild(div.firstChild);
      div.replaceWith(h);
    });

    // 5. Promote non-heading paragraphs to <p> so html-to-md / DOCX / ODT
    //    pick the right style.
    clone.querySelectorAll("div.paragraph").forEach(div => {
      const p = clone.ownerDocument.createElement("p");
      while (div.firstChild) p.appendChild(div.firstChild);
      div.replaceWith(p);
    });

    // 6. Promote bold-only paragraphs to <h3>. Notes save model-generated
    //    section titles ("Mechanism and Goals", "Psychological Impact", …)
    //    as <p><strong>Title</strong></p> rather than real headings.
    const isBoldOnly = (el) => {
      const kids = [...el.childNodes].filter(n =>
        !(n.nodeType === Node.TEXT_NODE && !n.textContent.trim())
      );
      if (kids.length !== 1) return false;
      const k = kids[0];
      if (k.nodeType !== Node.ELEMENT_NODE) return false;
      const tag = k.tagName.toLowerCase();
      if (tag !== "strong" && tag !== "b") return false;
      const txt = (k.textContent || "").trim();
      return txt.length > 0 && txt.length < 200;
    };
    clone.querySelectorAll("p").forEach(p => {
      if (!isBoldOnly(p)) return;
      const h = clone.ownerDocument.createElement("h3");
      h.textContent = (p.textContent || "").trim();
      p.replaceWith(h);
    });

    // 7. Lists. NotebookLM emits <ul>/<ol> whose direct children are
    //    <labs-tailwind-structural-element-view-v2>, not <li>. Without
    //    this fix html-to-md's list handler finds zero <li> children and
    //    drops the entire list silently.
    clone.querySelectorAll("ul, ol").forEach(list => {
      [...list.children].forEach(c => {
        if (c.tagName === "LI") return;
        const li = clone.ownerDocument.createElement("li");
        while (c.firstChild) li.appendChild(c.firstChild);
        c.replaceWith(li);
      });
    });

    return clone;
  }

  // Citation chips carry a screen-reader span with
  //   aria-label="<N>: <Source title>"
  // (Angular renders these for accessibility; they sit adjacent to the
  // clickable chip button.) We harvest them BEFORE preprocessing strips
  // the chips, so the export can include a "Sources" section listing
  // [N] → title for every citation that appears in the artifact.
  function harvestSources(host) {
    const map = new Map();
    host.querySelectorAll("[aria-label]").forEach(el => {
      const label = el.getAttribute("aria-label") || "";
      const m = label.match(/^\s*(\d+)\s*[:：]\s*(.+?)\s*$/);
      if (!m) return;
      const n = parseInt(m[1], 10);
      if (!Number.isFinite(n) || n < 1 || n > 999) return;
      if (!map.has(n)) map.set(n, m[2]);
    });
    return map;
  }

  function renderSourcesSection(sourcesMap, excerptsMap) {
    if (!sourcesMap.size) return "";
    const lines = ["", "", "## Sources", ""];
    const sorted = [...sourcesMap.entries()].sort((a, b) => a[0] - b[0]);
    for (const [n, title] of sorted) {
      // Inline HTML anchor - passes through markdown unchanged, and
      // md-to-html restores it verbatim when it sees the
      // `data-adx-anchor` opt-in marker (otherwise inline `<a>` would
      // be HTML-escaped, since we don't allow arbitrary inline HTML).
      lines.push(`### <a id="src-${n}" data-adx-anchor></a>[${n}] ${title}`);
      lines.push("");
      const excerpt = excerptsMap?.get(n);
      if (excerpt) {
        // Quote each line so the excerpt is visually distinct from the
        // surrounding text in the rendered markdown.
        const quoted = excerpt.split("\n").map(l => l ? `> ${l}` : ">").join("\n");
        lines.push(quoted);
        lines.push("");
      }
    }
    return lines.join("\n");
  }

  // Wrap every `[N]` / `[N, M]` / `[N-M]` citation in the body text so
  // each individual source number is its own clickable link to the
  // matching `### [N] Title` entry at the bottom. Renders as:
  //   [1]      → [1]                    (one link)
  //   [3, 4]   → [3, 4]                 (two links, comma kept literal)
  //   [6-8]    → [6, 7, 8]              (range expanded so every number is clickable)
  //
  // Uses inline HTML anchors rather than `[text](#anchor)` markdown link
  // syntax - the latter trips up most parsers when the link text itself
  // contains brackets (`[\[3\]](#src-3)`) or when links are nested
  // (`[[3](#src-3), [4](#src-4)]`). Inline HTML passes through cleanly
  // in both the markdown export and md-to-html.
  function linkifyCitations(md) {
    return md.replace(/\[(\d+(?:\s*[,\-\u2013]\s*\d+)*)\]/g, (full, content) => {
      const nums = [];
      for (const part of content.split(",")) {
        const p = part.trim();
        const range = p.match(/^(\d+)\s*[-\u2013]\s*(\d+)$/);
        if (range) {
          const a = +range[1], b = +range[2];
          for (let n = Math.min(a, b); n <= Math.max(a, b); n++) nums.push(n);
        } else if (/^\d+$/.test(p)) {
          nums.push(+p);
        }
      }
      if (!nums.length) return full;
      if (nums.length === 1) {
        return `<a href="#src-${nums[0]}" data-adx-anchor>[${nums[0]}]</a>`;
      }
      return "[" + nums.map(n => `<a href="#src-${n}" data-adx-anchor>${n}</a>`).join(", ") + "]";
    });
  }

  // Hover each unique citation chip, wait for the popup, scrape its
  // content, then dispatch leave events. Returns a Map<N, excerptMarkdown>.
  //
  // The popup still renders to the DOM (we need that to read it), but we
  // inject a stylesheet that makes the popup overlay visually invisible
  // for the duration of the harvest - so the user doesn't see chips
  // flashing tooltips on/off across the screen during an export.
  async function harvestSourceExcerpts(host) {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    // Hide the citation popup overlay layer while we scrape. The popup
    // still renders to the DOM (we need that to read it) but is visually
    // invisible to the user. `:has()` keeps the wrapper hidden too on
    // browsers that support it; the plain selector is the fallback.
    const hideStyle = document.createElement("style");
    hideStyle.setAttribute("data-adx", "nlm-citation-hide");
    hideStyle.textContent =
      ".cdk-overlay-pane.citation-tooltip-panel," +
      ".cdk-overlay-popover:has(.citation-tooltip-panel)" +
      "{opacity:0!important;pointer-events:none!important;}";
    document.head.appendChild(hideStyle);

    // Build N → chip-button map. The chip button itself has no number
    // text - the number is in an adjacent <span>. We look at the
    // accessible "<N>: <Title>" span that sits as a sibling.
    const chipsByN = new Map();
    host.querySelectorAll("button.citation-marker, button.xap-inline-dialog").forEach(btn => {
      let n = null;
      // Look for sibling spans with aria-label="N: title"
      const probes = [
        btn.previousElementSibling,
        btn.nextElementSibling,
        btn.parentElement?.querySelector("span[aria-label]"),
      ].filter(Boolean);
      for (const p of probes) {
        const m = (p.getAttribute?.("aria-label") || "").match(/^\s*(\d+)\s*[:：]/);
        if (m) { n = parseInt(m[1], 10); break; }
      }
      if (n == null) {
        // Fallback: visible number span next to the button
        const numSpan = btn.parentElement?.querySelector("span:not([aria-label])");
        const t = (numSpan?.textContent || "").trim();
        if (/^\d+$/.test(t)) n = parseInt(t, 10);
      }
      if (n != null && !chipsByN.has(n)) chipsByN.set(n, btn);
    });

    // The popup is opened by HOVER, not click. We dispatch synthetic
    // mouseenter/mouseover/pointerenter on the chip, wait for the tooltip
    // to render, then dispatch mouseleave on chip + tooltip to close.
    const hoverIn = (el) => {
      const opts = { bubbles: true, cancelable: true, composed: true, view: window };
      el.dispatchEvent(new PointerEvent("pointerover", opts));
      el.dispatchEvent(new PointerEvent("pointerenter", opts));
      el.dispatchEvent(new MouseEvent("mouseover", opts));
      el.dispatchEvent(new MouseEvent("mouseenter", opts));
    };
    const hoverOut = (el) => {
      const opts = { bubbles: true, cancelable: true, composed: true, view: window };
      el.dispatchEvent(new MouseEvent("mouseleave", opts));
      el.dispatchEvent(new MouseEvent("mouseout", opts));
      el.dispatchEvent(new PointerEvent("pointerleave", opts));
      el.dispatchEvent(new PointerEvent("pointerout", opts));
    };

    const excerpts = new Map();
    try {
    for (const [n, btn] of chipsByN) {
      hoverIn(btn);
      let popup = null;
      for (let i = 0; i < 40; i++) {
        popup = document.querySelector(".citation-tooltip");
        if (popup) break;
        await sleep(40);
      }
      if (popup) {
        // Tiny extra wait so Angular fills the .citation-tooltip-text body
        // (the header and text render in separate ticks on some builds).
        await sleep(80);
        const textEl = popup.querySelector(".citation-tooltip-text");
        if (textEl) {
          const clean = preprocessNotebookLMStudio(textEl);
          let md = (NS.htmlToMarkdown(clean) || "").trim();
          if (md) {
            md = compactCitations(md);
            // Demote any heading in the excerpt to a bold paragraph and
            // ensure a blank line follows it. Excerpts live inside a
            // blockquote under `### [N]`; leaving headings as `##`/`###`
            // would pollute the doc's heading hierarchy, and without the
            // forced blank line the bold "section title" runs visually
            // into its body inside the quoted block.
            md = md.replace(/^#{1,6}\s+(.+?)\s*#*\s*$/gm, "**$1**\n");
            md = md.replace(/\n{3,}/g, "\n\n");
            excerpts.set(n, md);
          }
        }
      }
      // Close by hover-leaving both chip and tooltip, and pressing Escape
      // as a belt-and-braces fallback.
      hoverOut(btn);
      if (popup) hoverOut(popup);
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27, bubbles: true }));
      for (let i = 0; i < 40; i++) {
        if (!document.querySelector(".citation-tooltip")) break;
        await sleep(30);
      }
    }
    } finally {
      hideStyle.remove();
    }
    return excerpts;
  }

  async function extractStudioArtifact(host) {
    const body =
      host.querySelector("labs-tailwind-doc-viewer") ||
      host.querySelector(".artifact-content") ||
      host;
    const sources = harvestSources(body);
    // Harvest excerpts BEFORE preprocessing strips the live chip buttons.
    // Runs against the LIVE host (not the clone) because we need to click
    // real chips and read the resulting popup from the page overlay.
    let excerpts = new Map();
    try { excerpts = await harvestSourceExcerpts(body); }
    catch (e) { console.warn(NS.TAG, "source-excerpt harvest failed", e); }
    const clean = preprocessNotebookLMStudio(body);
    const title = artifactTitleFromHeader(host);

    // Reports embed their own title as the first <h1> in the body, which
    // would otherwise appear directly after the artifact title we wrote
    // as the filename. Drop the duplicate.
    if (title) {
      const norm = (s) => (s || "").replace(/\s+/g, " ").trim().toLowerCase();
      const wantedTitle = norm(title);
      // Skip text-only whitespace nodes between the body start and the first
      // structural element to find the first heading.
      let first = clean.firstElementChild;
      if (first && /^h[1-6]$/i.test(first.tagName) && norm(first.textContent) === wantedTitle) {
        first.remove();
      }
    }

    let md = NS.htmlToMarkdown(clean);
    if (!md) return null;
    md = compactCitations(md);
    md = linkifyCitations(md);
    md += renderSourcesSection(sources, excerpts);
    const out = { role: "assistant", markdown: md };
    if (title) out.title = title;
    return out;
  }

  function findStudioMountPoints() {
    const out = [];
    // Reports - toolbar is .artifact-header inside <artifact-viewer>.
    document.querySelectorAll("artifact-viewer").forEach(av => {
      const bar = av.querySelector(".artifact-header");
      if (!bar) return;
      const r = bar.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      out.push({ bar, msg: av });
    });
    // Notes - toolbar is .note-title-container inside <note-editor>.
    document.querySelectorAll("note-editor").forEach(ne => {
      const bar = ne.querySelector(".note-title-container");
      if (!bar) return;
      const r = bar.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      out.push({ bar, msg: ne });
    });
    return out;
  }

  sites["google-notebooklm"] = {
    id: "google-notebooklm",
    label: "Gemini Notebook",
    matches(host) { return host === "notebooklm.google.com"; },

    title() {
      // Strip the site's own tab-title suffix. Google's page title still says
      // "NotebookLM"; match both in case the branding switches to "Gemini Notebook".
      return document.title.replace(/\s*[-|]\s*(Gemini\s*Notebook|NotebookLM).*$/i, "").trim() || "Gemini Notebook chat";
    },

    getConversationId() {
      return location.pathname.match(/\/notebook\/([^/?#]+)/)?.[1] || null;
    },

    async extract() {
      const title = this.title();
      let convo = null;
      try {
        const api = await extractViaApi(title);
        if (api && api.messages.length) convo = api;
      } catch (e) {
        console.warn(NS.TAG, "NotebookLM API extraction failed, falling back to DOM", e);
      }
      if (!convo) convo = extractViaDom(title);

      // Harvest sources + excerpts from the live Discussion DOM and
      // append them as a single Sources section to the last assistant
      // message. The chat container holds every assistant turn's chips;
      // we scan all of them in one pass so a given source appears only
      // once in the final list (deduped by N inside the harvest helpers).
      try {
        const chatRoot =
          document.querySelector("chat-panel") ||
          document.querySelector("mat-tab-body[aria-labelledby*='chat' i]") ||
          document.body;
        const sources = harvestSources(chatRoot);
        let excerpts = new Map();
        try { excerpts = await harvestSourceExcerpts(chatRoot); }
        catch (e) { console.warn(NS.TAG, "discussion excerpt harvest failed", e); }
        const section = renderSourcesSection(sources, excerpts);
        // Linkify every assistant message's body BEFORE we append the
        // Sources section - otherwise we'd also linkify "[N]" inside the
        // source headings themselves.
        for (const m of convo.messages) {
          if (m.role === "assistant" && m.markdown) m.markdown = linkifyCitations(m.markdown);
        }
        if (section) {
          const lastAsst = [...convo.messages].reverse().find(m => m.role === "assistant");
          if (lastAsst) lastAsst.markdown = (lastAsst.markdown || "") + section;
          else convo.messages.push({ role: "assistant", markdown: section.trimStart() });
        }
      } catch (e) {
        console.warn(NS.TAG, "discussion sources section failed", e);
      }

      return convo;
    },

    // Inline-button support keeps using DOM nodes - same as before.
    findMessages() {
      return document.querySelectorAll("chat-message");
    },

    extractOne(el) {
      // Studio artifact (open note / report) takes priority - when the user
      // clicks the inline button in `.artifact-header`, `msg` is the
      // surrounding <artifact-viewer>.
      if (isStudioArtifact(el)) {
        const host = (el.tagName === "ARTIFACT-VIEWER" || el.tagName === "NOTE-EDITOR")
          ? el
          : el.closest(STUDIO_HOSTS);
        return extractStudioArtifact(host);
      }

      const role = detectRoleDom(el);
      const body = el.querySelector(
        '[class*="markdown" i], .message-content, [class*="message-text" i], [class*="response-content" i], [class*="rich-text" i]'
      ) || el;
      const clean = preprocessDom(body);
      let md = NS.htmlToMarkdown(clean);
      if (!md) return null;
      md = compactCitations(md);
      const out = { role, markdown: md };
      const time = NS.findMessageTime?.(el);
      if (time) out.time = time;
      return out;
    },

    findMountPoints() {
      const out = [];
      const seen = new Set();

      // Chat: existing mounts.
      const bars = document.querySelectorAll(
        "chat-panel mat-card-actions chat-actions, mat-card-actions chat-actions, chat-actions"
      );
      for (const bar of bars) {
        if (seen.has(bar)) continue;
        seen.add(bar);
        const msg = bar.closest("chat-message") || bar.parentElement || bar;
        out.push({ bar, msg });
      }

      // Studio: every open artifact-viewer with a visible .artifact-header.
      for (const m of findStudioMountPoints()) {
        if (seen.has(m.bar)) continue;
        seen.add(m.bar);
        out.push(m);
      }

      return out;
    }
  };
})();
