(() => {
  const NS = (globalThis.AiDoc ||= {});

  // Split one message's Markdown into an ordered, TYPED `contents` array — like
  // SaveAI's structured export — so consumers can grab or drop parts by type
  // (e.g. strip `thinking`, keep only `code`) without re-parsing prose.
  //
  // ⚠ CLAUDE: we split ONLY on conventions our adapters actually emit — the
  // `> **Thinking**` blockquote (the same THINKING_RE fonts.js strips), fenced
  // code, `![](…)` / `<img>` / `<Image>` images, and GFM tables. We deliberately
  // do NOT invent a `sources` type: citations arrive as inline links with no
  // dedicated block, so a `sources` segment would be fabricated data.
  //
  // The message keeps its flat `content` (full Markdown) for simple consumers,
  // AND gains `contents` (the typed split) for structured pipelines.
  const THINKING  = () => /^>\s*\*\*Thinking\*\*[^\n]*\n(?:>[^\n]*(?:\n|$))*/gm;
  const CODE      = () => /```([^\n`]*)\n([\s\S]*?)```/g;
  const IMAGE     = () => /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  // Also capture HTML/JSX image tags — `<img …>` and Gemini's `<Image … />` — so
  // an image in tag form becomes a typed `image` segment instead of leaking into
  // `text`. src may be a resolved URL or an unresolved placeholder.
  const IMAGE_TAG = () => /<(?:img|image)\b[^>]*?\/?>/gi;
  const tagAttr = (tag, name) =>
    (tag.match(new RegExp(name + '\\s*=\\s*"([^"]*)"', "i"))
      || tag.match(new RegExp(name + "\\s*=\\s*'([^']*)'", "i")) || [])[1] || "";
  // A GFM table: a header row, a `|---|` separator, then body rows. Parsed to
  // { headers, rows } (cells kept as raw markdown) so consumers get columns, not
  // a pipe blob. A block that doesn't cleanly parse falls back to a `text` segment.
  const TABLE = () => /^[ \t]*\|?.*\|.*\n[ \t]*\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*\n(?:[ \t]*\|?.*\|.*(?:\n|$))*/gm;
  // A `|` inside an inline-code span (`…`) is literal, NOT a column delimiter
  // (GFM). Mask those pipes to a sentinel token before splitting cells, then
  // restore — else a cell like `` `| A | B |` `` explodes into extra columns.
  const PIPE_SENT = "@@__PIPE__@@";
  function splitRow(line) {
    const masked = line.trim().replace(/(`+)([\s\S]+?)\1/g, (m) => m.split("|").join(PIPE_SENT));
    const cells = masked.split(/(?<!\\)\|/);                       // split on unescaped pipes
    if (cells.length && cells[0].trim() === "") cells.shift();     // drop leading-pipe empty
    if (cells.length && cells[cells.length - 1].trim() === "") cells.pop();  // drop trailing-pipe empty
    return cells.map((c) => c.trim().replace(/\\\|/g, "|").split(PIPE_SENT).join("|"));
  }
  function parseTable(block) {
    const lines = block.replace(/\n+$/, "").split("\n");
    if (lines.length < 2) return null;
    if (!/^\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?$/.test(lines[1].trim())) return null;  // separator row
    const headers = splitRow(lines[0]);
    if (!headers.length) return null;
    const rows = lines.slice(2).filter((l) => l.trim()).map(splitRow);
    return { headers, rows };
  }

  function mdToContents(md) {
    const src = md || "";
    const segs = [];
    const pushText = (text) => {
      const t = text.replace(/^\n+|\n+$/g, "");
      if (t.trim()) segs.push({ type: "text", text: t });
    };
    // Return the next match of `re` at/after `from`, as {start,end,seg}, or null.
    const nextOf = (make, from, toSeg) => {
      const re = make(); re.lastIndex = from;
      const m = re.exec(src);
      if (!m) return null;
      const seg = toSeg(m);   // toSeg may return null (e.g. a table block that won't parse) -> skip it
      return seg ? { start: m.index, end: m.index + m[0].length, seg } : null;
    };
    let pos = 0;
    while (pos < src.length) {
      const cands = [
        nextOf(THINKING, pos, (m) => ({
          type: "thinking",
          text: m[0].replace(/^>\s*\*\*Thinking\*\*[^\n]*\n?/, "").replace(/^>\s?/gm, "").trim(),
        })),
        nextOf(CODE, pos, (m) => {
          const lang = (m[1] || "").trim();
          const seg = { type: "code", text: m[2].replace(/\n$/, "") };
          if (lang) seg.language = lang;
          return seg;
        }),
        nextOf(IMAGE, pos, (m) => ({ type: "image", url: m[2], alt: m[1] || "" })),
        nextOf(IMAGE_TAG, pos, (m) => {
          const tag = m[0];
          const seg = { type: "image", url: tagAttr(tag, "src"), alt: tagAttr(tag, "alt") };
          const cap = tagAttr(tag, "caption");
          if (cap) seg.caption = cap;
          return seg;
        }),
        nextOf(TABLE, pos, (m) => {
          const t = parseTable(m[0]);
          return t ? { type: "table", headers: t.headers, rows: t.rows } : null;
        }),
      ].filter(Boolean);
      if (!cands.length) { pushText(src.slice(pos)); break; }
      cands.sort((a, b) => a.start - b.start);
      const next = cands[0];
      if (next.start > pos) pushText(src.slice(pos, next.start));
      segs.push(next.seg);
      pos = next.end;
    }
    return segs;
  }

  // Serialize a canonical convo to a flat, developer-friendly JSON document:
  // source metadata + a flat `messages` array. Each message carries both the
  // full Markdown (`content`) and the typed split (`contents`). Pretty-printed.
  NS.toJson = function toJson(convo) {
    const doc = {
      schema: "ai-chat-extractor/conversation@2",
      site: convo.site || "",
      title: convo.title || "",
      url: convo.url || "",
      exported_at: new Date().toISOString(),
      content_format: "markdown",
      message_count: (convo.messages || []).length,
      messages: (convo.messages || []).map((m, i) => ({
        index: i,
        role: m.role,
        content: m.markdown || "",
        contents: mdToContents(m.markdown || ""),
      })),
    };
    return JSON.stringify(doc, null, 2);
  };
})();
