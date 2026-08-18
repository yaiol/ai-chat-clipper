(() => {
  const NS = (globalThis.AiDoc ||= {});

  function escapeHtml(s) {
    return s.replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
  }

  function escapeAttr(s) {
    return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  }

  // Inline transforms - applied to a single line of text.
  // Order matters: code spans first (their content shouldn't be re-formatted),
  // then images/links, then emphasis.
  function renderInline(text) {
    const placeholders = [];
    function park(html) {
      const i = placeholders.length;
      placeholders.push(html);
      return `\u0000${i}\u0000`;
    }

    // Inline code `…`
    text = text.replace(/`([^`\n]+)`/g, (_, code) => park(`<code>${escapeHtml(code)}</code>`));

    // Adapter-authored anchors - only parked when they carry the
    // `data-adx-anchor` opt-in attribute. We intentionally do NOT
    // un-escape arbitrary inline HTML found in the source markdown:
    // raw `<a>` example text in user documents must keep rendering as
    // literal text, not as live links. Adapters that need an inline
    // anchor (e.g. citation jump-links, heading targets) tag it with
    // the marker so this pass restores it verbatim into the HTML output.
    text = text.replace(/<a\b[^>]*\bdata-adx-anchor\b[^>]*>[^<]*<\/a>/gi, (m) => park(m));

    // Images ![alt](url)
    text = text.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, (_, alt, url, ttl) => {
      const t = ttl ? ` title="${escapeAttr(ttl)}"` : "";
      return park(`<img src="${escapeAttr(url)}" alt="${escapeAttr(alt)}"${t}>`);
    });

    // Links [text](url)
    text = text.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, (_, label, url, ttl) => {
      const t = ttl ? ` title="${escapeAttr(ttl)}"` : "";
      return park(`<a href="${escapeAttr(url)}"${t}>${escapeHtml(label)}</a>`);
    });

    // Bold **…** and italic *…* / _…_
    // Escape HTML on the remaining text first, then apply emphasis on the escaped string.
    text = escapeHtml(text);
    text = text.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
    text = text.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?:;]|$)/g, "$1<em>$2</em>");
    text = text.replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,!?:;]|$)/g, "$1<em>$2</em>");
    text = text.replace(/~~([^~\n]+)~~/g, "<del>$1</del>");

    // Restore parked placeholders
    text = text.replace(/\u0000(\d+)\u0000/g, (_, i) => placeholders[Number(i)]);
    return text;
  }

  function renderTable(lines) {
    // lines: ["| h1 | h2 |", "|---|---|", "| a | b |", ...]
    const cells = lines.map(l =>
      l.replace(/^\||\|$/g, "").split("|").map(c => c.trim())
    );
    if (cells.length < 2) return "";
    const header = cells[0];
    const body = cells.slice(2);
    const th = header.map(c => `<th>${renderInline(c)}</th>`).join("");
    const rows = body.map(r =>
      `<tr>${r.map(c => `<td>${renderInline(c)}</td>`).join("")}</tr>`
    ).join("\n");
    return `<table>\n<thead><tr>${th}</tr></thead>\n<tbody>\n${rows}\n</tbody>\n</table>`;
  }

  // Block-level converter: walks lines and produces HTML blocks.
  function markdownToHtml(md) {
    const src = (md || "").replace(/\r\n?/g, "\n");
    const lines = src.split("\n");
    const out = [];
    let i = 0;

    function flushParagraph(buf) {
      if (!buf.length) return;
      out.push(`<p>${renderInline(buf.join(" ").trim())}</p>`);
    }

    while (i < lines.length) {
      const line = lines[i];

      // Fenced code block ```lang
      const fence = line.match(/^```\s*([^\s`]*)\s*$/);
      if (fence) {
        const lang = fence[1];
        i++;
        const buf = [];
        while (i < lines.length && !/^```\s*$/.test(lines[i])) {
          buf.push(lines[i]);
          i++;
        }
        i++; // skip closing fence
        const cls = lang ? ` class="language-${escapeAttr(lang)}"` : "";
        out.push(`<pre><code${cls}>${escapeHtml(buf.join("\n"))}</code></pre>`);
        continue;
      }

      // Blank line
      if (/^\s*$/.test(line)) { i++; continue; }

      // ATX header
      const h = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
      if (h) {
        out.push(`<h${h[1].length}>${renderInline(h[2])}</h${h[1].length}>`);
        i++;
        continue;
      }

      // Horizontal rule
      if (/^\s*(-{3,}|_{3,}|\*{3,})\s*$/.test(line)) {
        out.push("<hr>");
        i++;
        continue;
      }

      // Blockquote (one or more contiguous "> " lines)
      if (/^\s*>/.test(line)) {
        const buf = [];
        while (i < lines.length && /^\s*>/.test(lines[i])) {
          buf.push(lines[i].replace(/^\s*>\s?/, ""));
          i++;
        }
        out.push(`<blockquote>\n${markdownToHtml(buf.join("\n"))}\n</blockquote>`);
        continue;
      }

      // Table (header line + separator line). The separator's first cell can
      // carry an alignment marker - `:---`, `:---:`, `---:` - so the regex
      // allows an optional leading colon before the dashes and an optional
      // trailing one. Without this, Gemini-style tables (which always emit
      // `:---`) silently fall through and each row gets paragraph-wrapped.
      if (/^\s*\|.+\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}:?/.test(lines[i + 1])) {
        const buf = [line];
        i++;
        while (i < lines.length && /^\s*\|.+\|\s*$/.test(lines[i])) {
          buf.push(lines[i]);
          i++;
        }
        out.push(renderTable(buf));
        continue;
      }

      // List (ordered or unordered, possibly nested via 2-space indent)
      if (/^(\s*)([-*+]|\d+\.)\s+/.test(line)) {
        const items = [];
        const baseIndent = line.match(/^(\s*)/)[1].length;
        const ordered = /^\s*\d+\./.test(line);
        while (i < lines.length) {
          const m = lines[i].match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/);
          if (!m) break;
          if (m[1].length !== baseIndent) break;
          // Gather continuation lines (indented or non-empty without new bullet)
          let content = m[3];
          i++;
          const nestedBuf = [];
          while (i < lines.length) {
            const next = lines[i];
            if (/^\s*$/.test(next)) { i++; continue; }
            const im = next.match(/^(\s*)/)[1].length;
            if (im > baseIndent) {
              nestedBuf.push(next.slice(baseIndent + 2));
              i++;
              continue;
            }
            break;
          }
          if (nestedBuf.length) {
            content += "\n\n" + nestedBuf.join("\n");
            items.push(`<li>${markdownToHtml(content)}</li>`);
          } else {
            items.push(`<li>${renderInline(content)}</li>`);
          }
        }
        out.push(`<${ordered ? "ol" : "ul"}>\n${items.join("\n")}\n</${ordered ? "ol" : "ul"}>`);
        continue;
      }

      // Paragraph: gather contiguous non-blank, non-special lines
      const buf = [line];
      i++;
      while (i < lines.length) {
        const n = lines[i];
        if (/^\s*$/.test(n)) break;
        if (/^```/.test(n)) break;
        if (/^#{1,6}\s+/.test(n)) break;
        if (/^\s*>/.test(n)) break;
        if (/^(\s*)([-*+]|\d+\.)\s+/.test(n)) break;
        if (/^\s*\|.+\|\s*$/.test(n)) break;
        buf.push(n);
        i++;
      }
      flushParagraph(buf);
    }
    return out.join("\n\n");
  }

  NS.markdownToHtml = markdownToHtml;
})();
