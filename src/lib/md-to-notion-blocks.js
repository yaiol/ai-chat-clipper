// markdown → Notion block schema.
//
// Notion's API accepts a strict block tree, not HTML. This converter handles
// the subset of markdown the AI sites actually produce:
//
//   #/##/### headings → heading_1/2/3 (h4-h6 fold to h3)
//   paragraphs with bold / italic / inline code / strike / links
//   - * + bullets → bulleted_list_item (one nesting level supported)
//   1. 2. … numbered → numbered_list_item
//   ``` fenced code with language → code block
//   > blockquote → quote block
//   --- *** ___ → divider
//   <thinking>blockquote pattern from html.js stays as quote
//
// API limits we respect:
//   - rich_text element.text.content max 2000 chars → split
//   - rich_text annotations are bool flags + color
//   - top-level children max 100 per request → batched by caller
//
// Out of scope (v1):
//   - tables (would need recursive children construction)
//   - images (need public URL or upload API; Notion blocks accept external URL)
//   - inline math ($…$) - passed through as text; would need equation block
//
// Public:
//   NS.markdownToBlocks(md: string) → block[]

(() => {
  const NS = (globalThis.AiDoc ||= {});

  const RT_LIMIT = 1900; // a hair under Notion's 2000 to be safe with escapes

  // ── inline parsing ───────────────────────────────────────────────────────

  // Order matters - code first so its content isn't re-parsed for **/_/etc.
  // Each entry: regex (g, no anchors), build(match) → token { text, ann?, link? }
  // The walker below splits the input around all matches in left-to-right order.
  const INLINE_PATTERNS = [
    { name: "code",   re: /`([^`\n]+)`/g,                build: m => ({ text: m[1], ann: { code: true } }) },
    { name: "bold",   re: /\*\*([^*\n]+)\*\*/g,          build: m => ({ text: m[1], ann: { bold: true } }) },
    { name: "italic", re: /(?<!\*)\*([^*\n]+)\*(?!\*)/g, build: m => ({ text: m[1], ann: { italic: true } }) },
    { name: "ital2",  re: /(?<!_)_([^_\n]+)_(?!_)/g,     build: m => ({ text: m[1], ann: { italic: true } }) },
    { name: "strike", re: /~~([^~\n]+)~~/g,              build: m => ({ text: m[1], ann: { strikethrough: true } }) },
    { name: "link",   re: /\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g,
                      build: m => ({ text: m[1], link: m[2] }) },
  ];

  function parseInline(text) {
    if (!text) return [];
    // Collect every non-overlapping match across all patterns, sort by index,
    // skip overlaps (longest non-overlapping wins, but pattern order biases
    // toward the more specific markers like ** before *).
    const matches = [];
    for (const p of INLINE_PATTERNS) {
      p.re.lastIndex = 0;
      let m;
      while ((m = p.re.exec(text)) !== null) {
        matches.push({ start: m.index, end: m.index + m[0].length, token: p.build(m) });
      }
    }
    matches.sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start));
    const chosen = [];
    let cursor = 0;
    for (const m of matches) {
      if (m.start < cursor) continue; // overlaps a previous chosen match
      chosen.push(m);
      cursor = m.end;
    }

    // Walk text emitting plain runs + chosen tokens.
    const out = [];
    let i = 0;
    for (const m of chosen) {
      if (m.start > i) out.push({ text: text.slice(i, m.start) });
      out.push(m.token);
      i = m.end;
    }
    if (i < text.length) out.push({ text: text.slice(i) });
    return out;
  }

  // Split a string into chunks ≤ RT_LIMIT chars on whitespace boundaries
  // when possible, hard-cutting otherwise.
  function chunkText(s) {
    if (s.length <= RT_LIMIT) return [s];
    const out = [];
    let i = 0;
    while (i < s.length) {
      let end = Math.min(i + RT_LIMIT, s.length);
      if (end < s.length) {
        const back = s.lastIndexOf(" ", end);
        if (back > i + RT_LIMIT * 0.5) end = back;
      }
      out.push(s.slice(i, end));
      i = end;
    }
    return out;
  }

  // Build Notion rich_text array from inline tokens. Empty text yields [].
  function buildRichText(text) {
    const tokens = parseInline(text);
    const rt = [];
    for (const t of tokens) {
      if (!t.text) continue;
      for (const chunk of chunkText(t.text)) {
        const item = { type: "text", text: { content: chunk } };
        if (t.link) item.text.link = { url: t.link };
        if (t.ann) item.annotations = { ...t.ann };
        rt.push(item);
      }
    }
    return rt;
  }

  // ── images ───────────────────────────────────────────────────────────────

  // Inline data: URLs blow Notion's rich_text size limit (each link.url is
  // kept whole, base64 images can be 100KB+ each). When an image markdown
  // sits inline inside other text, strip it down to a "[Image]" placeholder.
  // Standalone image lines are caught earlier and become real image blocks.
  function stripInlineDataImages(text) {
    return text.replace(/!\[([^\]]*)\]\(data:[^)]+\)/g, (_m, alt) =>
      alt ? `[Image: ${alt}]` : `[Image]`);
  }

  function imageBlock(alt, url) {
    if (url.startsWith("data:")) {
      // Placeholder - background.js uploads the data URL to Notion's
      // file-upload API and replaces this block in place before creating
      // the page. The two leading-underscore keys are stripped server-side
      // (they're not part of Notion's image schema; we use them as a
      // private channel between this module and the upload step).
      return {
        object: "block",
        type: "image",
        image: { type: "_pending_data_url", _pending_data_url: url, _alt: alt || "" },
      };
    }
    // Hosted URL - Notion accepts external images directly.
    return {
      object: "block",
      type: "image",
      image: { type: "external", external: { url } },
    };
  }

  // ── block parsing ────────────────────────────────────────────────────────

  function paragraph(text) {
    return { object: "block", type: "paragraph", paragraph: { rich_text: buildRichText(text) } };
  }

  function heading(level, text) {
    const t = `heading_${Math.min(3, level)}`;
    return { object: "block", type: t, [t]: { rich_text: buildRichText(text) } };
  }

  function bullet(text) {
    return { object: "block", type: "bulleted_list_item",
             bulleted_list_item: { rich_text: buildRichText(text) } };
  }

  function numbered(text) {
    return { object: "block", type: "numbered_list_item",
             numbered_list_item: { rich_text: buildRichText(text) } };
  }

  function quote(text) {
    return { object: "block", type: "quote", quote: { rich_text: buildRichText(text) } };
  }

  function divider() {
    return { object: "block", type: "divider", divider: {} };
  }

  // Notion code blocks: rich_text content (no inline markdown), language enum.
  // Language must match Notion's allowed list - fall back to "plain text" for
  // unknown ones to avoid 400s.
  const NOTION_LANGS = new Set([
    "abap","arduino","bash","basic","c","clojure","coffeescript","c++","c#","css","dart","diff",
    "docker","elixir","elm","erlang","flow","fortran","f#","gherkin","glsl","go","graphql","groovy",
    "haskell","html","java","javascript","json","julia","kotlin","latex","less","lisp","livescript",
    "lua","makefile","markdown","markup","matlab","mermaid","nix","objective-c","ocaml","pascal",
    "perl","php","plain text","powershell","prolog","protobuf","python","r","reason","ruby","rust",
    "sass","scala","scheme","scss","shell","solidity","sql","swift","typescript","vb.net","verilog",
    "vhdl","visual basic","webassembly","xml","yaml",
  ]);
  // Common short aliases AI sites emit that Notion's enum doesn't recognize.
  const LANG_ALIASES = {
    js: "javascript", jsx: "javascript", ts: "typescript", tsx: "typescript",
    py: "python", rb: "ruby", rs: "rust", sh: "shell", zsh: "shell", bash: "bash",
    md: "markdown", yml: "yaml", htm: "html", "c++": "c++", cpp: "c++",
    cs: "c#", "objective-c": "objective-c", objc: "objective-c",
    text: "plain text", txt: "plain text", "": "plain text",
  };
  function codeBlock(content, lang) {
    const lc = (lang || "").toLowerCase();
    const mapped = LANG_ALIASES[lc] || lc;
    const language = NOTION_LANGS.has(mapped) ? mapped : "plain text";
    // Code is plain text - no inline parsing - but still chunked to 2000.
    const rt = chunkText(content).map(c => ({ type: "text", text: { content: c } }));
    return { object: "block", type: "code", code: { rich_text: rt, language } };
  }

  // Walk markdown line by line. Slightly tolerant: trailing whitespace ignored,
  // blank lines flush paragraph buffers.
  NS.markdownToBlocks = function markdownToBlocks(md) {
    const lines = String(md || "").replace(/\r\n?/g, "\n").split("\n");
    const blocks = [];
    let para = []; // pending paragraph buffer

    const flushPara = () => {
      if (!para.length) return;
      const text = stripInlineDataImages(para.join("\n").trim());
      if (text) blocks.push(paragraph(text));
      para = [];
    };

    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      const line = raw.replace(/\s+$/, "");

      // Fenced code block - consume until closing fence
      const fence = /^```(\S*)/.exec(line);
      if (fence) {
        flushPara();
        const lang = fence[1] || "";
        const buf = [];
        i++;
        while (i < lines.length && !/^```/.test(lines[i])) { buf.push(lines[i]); i++; }
        blocks.push(codeBlock(buf.join("\n"), lang));
        continue;
      }

      // Standalone image line - emit as a real Notion image block. Inline
      // images (within other text on a line) are handled by stripInlineDataImages
      // when paragraphs flush.
      const imgMatch = /^\s*!\[([^\]]*)\]\(([^)]+)\)\s*$/.exec(line);
      if (imgMatch) {
        flushPara();
        blocks.push(imageBlock(imgMatch[1], imgMatch[2]));
        continue;
      }

      // Heading
      const h = /^(#{1,6})\s+(.+)$/.exec(line);
      if (h) {
        flushPara();
        blocks.push(heading(h[1].length, h[2].trim()));
        continue;
      }

      // Divider
      if (/^[-*_]{3,}$/.test(line.trim())) {
        flushPara();
        blocks.push(divider());
        continue;
      }

      // Blockquote - collect contiguous > lines as one quote
      if (/^>\s?/.test(line)) {
        flushPara();
        const buf = [line.replace(/^>\s?/, "")];
        while (i + 1 < lines.length && /^>\s?/.test(lines[i + 1])) {
          i++;
          buf.push(lines[i].replace(/^>\s?/, ""));
        }
        blocks.push(quote(buf.join("\n").trim()));
        continue;
      }

      // List items (bulleted / numbered) - flatten consecutive items, no nesting
      const bMatch = /^\s*[-*+]\s+(.+)$/.exec(line);
      const nMatch = /^\s*\d+\.\s+(.+)$/.exec(line);
      if (bMatch || nMatch) {
        flushPara();
        const item = bMatch ? bullet(bMatch[1]) : numbered(nMatch[1]);
        blocks.push(item);
        continue;
      }

      // Blank line → paragraph flush
      if (line === "") {
        flushPara();
        continue;
      }

      // Anything else: accumulate into paragraph
      para.push(line);
    }
    flushPara();

    return blocks;
  };
})();
