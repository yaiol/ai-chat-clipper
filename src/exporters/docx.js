(() => {
  const NS = (globalThis.AiDoc ||= {});

  // Real OOXML .docx - emits native WordprocessingML so the file opens
  // identically in Word, Google Docs, AND LibreOffice/Collabora (which
  // ignore the older <w:altChunk> HTML-import trick this exporter used
  // to rely on). Walks the canonical message list, converts each
  // message's markdown to HTML via NS.markdownToHtml, then maps the
  // resulting DOM to native paragraphs / runs / lists / tables.

  const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

  function esc(s) {
    return String(s).replace(/[&<>"]/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" })[c]);
  }

  function formatTime(t) {
    if (t == null || t === "") return "";
    const d = typeof t === "number" ? new Date(t * (t < 1e12 ? 1000 : 1)) : new Date(t);
    if (isNaN(d.getTime())) return "";
    try { return d.toLocaleString(); } catch { return d.toISOString(); }
  }

  // ── Inline (run) emission ───────────────────────────────────────────
  // ctx: { bold, italic, code, hyperlink } - formatting flags
  function emitInline(node, ctx, rels) {
    if (node.nodeType === 3) {
      const txt = node.nodeValue;
      if (!txt) return "";
      const rPr = [];
      if (ctx.hyperlink) rPr.push('<w:rStyle w:val="Hyperlink"/>');
      if (ctx.bold)     rPr.push("<w:b/>");
      if (ctx.italic)   rPr.push("<w:i/>");
      if (ctx.code) {
        rPr.push('<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/>');
        rPr.push('<w:shd w:val="clear" w:color="auto" w:fill="F4F6F8"/>');
      }
      const rPrXml = rPr.length ? `<w:rPr>${rPr.join("")}</w:rPr>` : "";
      return `<w:r>${rPrXml}<w:t xml:space="preserve">${esc(txt)}</w:t></w:r>`;
    }
    if (node.nodeType !== 1) return "";
    const tag = node.tagName.toLowerCase();
    if (tag === "br")     return '<w:r><w:br/></w:r>';
    if (tag === "strong" || tag === "b") return walkInline(node, { ...ctx, bold: true }, rels);
    if (tag === "em"     || tag === "i") return walkInline(node, { ...ctx, italic: true }, rels);
    if (tag === "code")   return walkInline(node, { ...ctx, code: true }, rels);
    if (tag === "a") {
      const href = node.getAttribute("href") || "";
      const id = `lnk${rels.length}`;
      rels.push({ id, target: href });
      const inner = walkInline(node, { ...ctx, hyperlink: true }, rels);
      return `<w:hyperlink r:id="${id}" w:history="1">${inner}</w:hyperlink>`;
    }
    return walkInline(node, ctx, rels);
  }

  function walkInline(parent, ctx, rels) {
    let out = "";
    for (const c of parent.childNodes) out += emitInline(c, ctx, rels);
    return out;
  }

  // ── Paragraph builder ───────────────────────────────────────────────
  // OOXML requires <w:pPr> children in a strict sequence - putting them
  // out of order makes Word render paragraph shading as text-width
  // instead of full-paragraph-width, among other quirks.
  // Order: pStyle → numPr → pBdr → shd → ind
  function para(content, opts = {}) {
    const pPr = [];
    if (opts.pStyle) pPr.push(`<w:pStyle w:val="${opts.pStyle}"/>`);
    if (opts.list != null) {
      pPr.push(`<w:numPr><w:ilvl w:val="${opts.level || 0}"/><w:numId w:val="${opts.list}"/></w:numPr>`);
    }
    if (opts.borderLeft) {
      pPr.push(`<w:pBdr><w:left w:val="single" w:sz="24" w:space="6" w:color="${opts.borderLeft}"/></w:pBdr>`);
    }
    if (opts.shade)  pPr.push(`<w:shd w:val="clear" w:color="auto" w:fill="${opts.shade}"/>`);
    if (opts.indent) pPr.push(`<w:ind w:left="${opts.indent}"/>`);
    const pPrXml = pPr.length ? `<w:pPr>${pPr.join("")}</w:pPr>` : "";
    return `<w:p>${pPrXml}${content || ""}</w:p>`;
  }

  // ── Block-level emission ────────────────────────────────────────────
  function emitBlock(node, ctx, rels) {
    if (node.nodeType === 3) {
      const txt = (node.nodeValue || "").trim();
      if (!txt) return "";
      return para(emitInline(node, ctx, rels));
    }
    if (node.nodeType !== 1) return "";
    const tag = node.tagName.toLowerCase();

    if (tag === "h1") return para(walkInline(node, ctx, rels), { pStyle: "Heading1" });
    if (tag === "h2") return para(walkInline(node, ctx, rels), { pStyle: "Heading2" });
    if (tag === "h3") return para(walkInline(node, ctx, rels), { pStyle: "Heading3" });
    if (tag === "h4" || tag === "h5" || tag === "h6") {
      return para(walkInline(node, ctx, rels), { pStyle: "Heading3" });
    }
    if (tag === "p") {
      return para(walkInline(node, ctx, rels), ctx.blockOpts || {});
    }
    if (tag === "blockquote") {
      let out = "";
      const opts = { indent: 720, shade: "FAFAFA", borderLeft: "CCCCCC" };
      for (const c of node.childNodes) {
        if (c.nodeType === 1) {
          const tt = c.tagName.toLowerCase();
          if (tt === "p") {
            out += para(walkInline(c, ctx, rels), opts);
          } else {
            // Recurse with blockOpts so nested paragraphs inherit the indent.
            out += emitBlock(c, { ...ctx, blockOpts: opts }, rels);
          }
        } else if (c.nodeType === 3 && c.nodeValue.trim()) {
          out += para(emitInline(c, ctx, rels), opts);
        }
      }
      return out;
    }
    if (tag === "ul" || tag === "ol") {
      const numId = tag === "ol" ? 2 : 1;
      const level = ctx.listLevel || 0;
      let out = "";
      for (const li of node.children) {
        if ((li.tagName || "").toLowerCase() !== "li") continue;
        // Inline content of the li becomes the list paragraph; nested
        // ul/ol/blockquote/pre are emitted as additional blocks after.
        let inlineXml = "";
        let nestedXml = "";
        for (const c of li.childNodes) {
          if (c.nodeType === 1 && /^(ul|ol|blockquote|pre|table)$/i.test(c.tagName)) {
            nestedXml += emitBlock(c, { ...ctx, listLevel: level + 1 }, rels);
          } else {
            inlineXml += emitInline(c, ctx, rels);
          }
        }
        out += para(inlineXml, { list: numId, level });
        out += nestedXml;
      }
      return out;
    }
    if (tag === "pre") {
      const text = node.textContent || "";
      const lines = text.replace(/\n+$/, "").split("\n");
      let out = "";
      for (const line of lines) {
        const run = line
          ? `<w:r><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/></w:rPr><w:t xml:space="preserve">${esc(line)}</w:t></w:r>`
          : "";
        out += para(run, { pStyle: "CodeBlock" });
      }
      return out;
    }
    if (tag === "hr") {
      return `<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="auto"/></w:pBdr></w:pPr></w:p>`;
    }
    if (tag === "table") return emitTable(node, ctx, rels);
    if (tag === "img") {
      const alt = node.getAttribute("alt") || "image";
      return para(`<w:r><w:rPr><w:i/><w:color w:val="6A7280"/></w:rPr><w:t xml:space="preserve">[${esc(alt)}]</w:t></w:r>`);
    }
    if (tag === "section" || tag === "div" || tag === "article" || tag === "main") {
      let out = "";
      for (const c of node.childNodes) out += emitBlock(c, ctx, rels);
      return out;
    }
    // Unknown / inline at block level → wrap in paragraph
    const inline = walkInline(node, ctx, rels);
    return inline ? para(inline) : "";
  }

  // ── Tables ──────────────────────────────────────────────────────────
  function emitTable(table, ctx, rels) {
    const rows = [];
    (function gather(parent) {
      for (const c of parent.children) {
        const t = c.tagName.toLowerCase();
        if (t === "thead" || t === "tbody" || t === "tfoot") gather(c);
        else if (t === "tr") rows.push(c);
      }
    })(table);
    if (!rows.length) return "";
    const colCount = Math.max(...rows.map(r => r.children.length));
    if (!colCount) return "";
    const totalW = 9000; // ~6.25 inches in twips
    const colW = Math.floor(totalW / colCount);
    const grid = Array(colCount).fill(`<w:gridCol w:w="${colW}"/>`).join("");
    let body = "";
    for (const tr of rows) {
      let cells = "";
      const tds = Array.from(tr.children);
      for (let i = 0; i < colCount; i++) {
        const td = tds[i];
        if (!td) {
          cells += `<w:tc><w:tcPr><w:tcW w:w="${colW}" w:type="dxa"/></w:tcPr><w:p/></w:tc>`;
          continue;
        }
        const isHeader = td.tagName.toLowerCase() === "th";
        // Cell content: collect block-level children as paragraphs; inline
        // content becomes a single paragraph. Cells MUST contain at least
        // one <w:p> per OOXML spec.
        let inlineBuf = "";
        let blockBuf = "";
        for (const c of td.childNodes) {
          if (c.nodeType === 1 && /^(p|ul|ol|blockquote|pre|table|h[1-6])$/i.test(c.tagName)) {
            if (inlineBuf) { blockBuf += para(inlineBuf, isHeader ? { shade: "F4F6F8" } : {}); inlineBuf = ""; }
            blockBuf += emitBlock(c, { ...ctx, bold: ctx.bold || isHeader }, rels);
          } else {
            inlineBuf += emitInline(c, { ...ctx, bold: ctx.bold || isHeader }, rels);
          }
        }
        if (inlineBuf || !blockBuf) {
          blockBuf += para(inlineBuf || "", isHeader ? { shade: "F4F6F8" } : {});
        }
        const tcPr = `<w:tcPr><w:tcW w:w="${colW}" w:type="dxa"/>${isHeader ? '<w:shd w:val="clear" w:color="auto" w:fill="F4F6F8"/>' : ""}</w:tcPr>`;
        cells += `<w:tc>${tcPr}${blockBuf}</w:tc>`;
      }
      body += `<w:tr>${cells}</w:tr>`;
    }
    const tblPr = '<w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders>'
      + '<w:top w:val="single" w:sz="4" w:color="DDDDDD"/>'
      + '<w:left w:val="single" w:sz="4" w:color="DDDDDD"/>'
      + '<w:bottom w:val="single" w:sz="4" w:color="DDDDDD"/>'
      + '<w:right w:val="single" w:sz="4" w:color="DDDDDD"/>'
      + '<w:insideH w:val="single" w:sz="4" w:color="DDDDDD"/>'
      + '<w:insideV w:val="single" w:sz="4" w:color="DDDDDD"/>'
      + '</w:tblBorders></w:tblPr>';
    // Word requires a paragraph after a table.
    return `<w:tbl>${tblPr}<w:tblGrid>${grid}</w:tblGrid>${body}</w:tbl><w:p/>`;
  }

  // ── Per-message HTML → blocks ───────────────────────────────────────
  // We deliberately don't reuse NS.toHtml here - it wraps everything in a
  // full HTML doc (style, scripts, headings) we'd just have to skip past.
  // Going straight markdown→HTML→DOM is simpler.
  function messageBodyToBlocks(markdown, ctx, rels) {
    const html = NS.markdownToHtml ? NS.markdownToHtml(markdown) : `<p>${esc(markdown)}</p>`;
    const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
    const wrap = doc.body.firstChild;
    if (!wrap) return "";
    let out = "";
    for (const c of wrap.childNodes) out += emitBlock(c, ctx, rels);
    return out;
  }

  // ── Document assembly ───────────────────────────────────────────────
  function buildDocumentXml(convo, opts) {
    const rels = []; // hyperlinks accumulated as we walk
    const aiName = NS.siteName?.(convo.site) || "Assistant";
    const showTime     = !!opts?.showTime;
    const showSource   = opts?.showSource   !== false;
    const showThinking = opts?.showThinking !== false;

    let body = "";

    // Title
    const title = convo.title || `${aiName} chat`;
    body += para(`<w:r><w:t xml:space="preserve">${esc(title)}</w:t></w:r>`, { pStyle: "Title" });

    // Source line
    if (showSource && convo.url) {
      const id = `lnk${rels.length}`;
      rels.push({ id, target: convo.url });
      const linkRun = `<w:hyperlink r:id="${id}" w:history="1"><w:r><w:rPr><w:rStyle w:val="Hyperlink"/></w:rPr><w:t xml:space="preserve">${esc(convo.site || convo.url)}</w:t></w:r></w:hyperlink>`;
      body += para(`<w:r><w:t xml:space="preserve">Source: </w:t></w:r>${linkRun}`, { pStyle: "SourceLine" });
    }

    // Messages
    for (const m of convo.messages) {
      const label = m.role === "user" ? "User"
                  : m.role === "assistant" ? aiName
                  : m.role;
      const role = m.role === "user" ? "user"
                 : m.role === "assistant" ? "assistant" : null;
      const timeStr = showTime ? formatTime(m.time) : "";
      let headerRuns = `<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${esc(label)}</w:t></w:r>`;
      if (timeStr) {
        headerRuns += `<w:r><w:rPr><w:color w:val="6A7280"/><w:sz w:val="18"/></w:rPr><w:t xml:space="preserve">    ${esc(timeStr)}</w:t></w:r>`;
      }
      const headerOpts = { pStyle: "RoleHeading" };
      if (role === "user") {
        headerOpts.shade = "EEF6FF";
        headerOpts.borderLeft = "4A9EFF";
      } else if (role === "assistant") {
        headerOpts.shade = "F0F9F0";
        headerOpts.borderLeft = "5AAA5A";
      }
      body += para(headerRuns, headerOpts);

      let md = m.markdown || "";
      if (!showThinking && NS.stripThinking) md = NS.stripThinking(md);
      body += messageBodyToBlocks(md, {}, rels);
    }

    // Final sectPr (page setup)
    body += `<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>`;

    const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document ${W_NS}><w:body>${body}</w:body></w:document>`;
    return { documentXml, rels };
  }

  // ── Static parts ────────────────────────────────────────────────────
  const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
  <Override PartName="/word/fontTable.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.fontTable+xml"/>
</Types>`;

  const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

  const NUMBERING_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:abstractNum w:abstractNumId="0">
    <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>
    <w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="◦"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="1440" w:hanging="360"/></w:pPr></w:lvl>
    <w:lvl w:ilvl="2"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="▪"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="2160" w:hanging="360"/></w:pPr></w:lvl>
  </w:abstractNum>
  <w:abstractNum w:abstractNumId="1">
    <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>
    <w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="%2."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="1440" w:hanging="360"/></w:pPr></w:lvl>
    <w:lvl w:ilvl="2"><w:start w:val="1"/><w:numFmt w:val="lowerRoman"/><w:lvlText w:val="%3."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="2160" w:hanging="360"/></w:pPr></w:lvl>
  </w:abstractNum>
  <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
  <w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>
</w:numbering>`;

  // Resolve user font picks to docx-friendly font objects. Falls back to a
  // generic sans-serif so the export still works if opts is missing keys.
  const DEFAULT_FONT = { docxName: "Calibri", docxAlt: "Arial", family: "sans" };
  function pickFont(f) {
    if (!f) return DEFAULT_FONT;
    return {
      docxName: f.docxName || f.label || "Calibri",
      docxAlt:  f.docxAlt  || (f.family === "serif" ? "Georgia" : "Arial"),
      family:   f.family   || "sans",
    };
  }

  function buildStylesXml(titleFont, textFont) {
    const tF = `<w:rFonts w:ascii="${esc(titleFont.docxName)}" w:hAnsi="${esc(titleFont.docxName)}" w:cs="${esc(titleFont.docxName)}"/>`;
    const bF = `<w:rFonts w:ascii="${esc(textFont.docxName)}" w:hAnsi="${esc(textFont.docxName)}" w:cs="${esc(textFont.docxName)}"/>`;
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault><w:rPr>${bF}<w:sz w:val="22"/></w:rPr></w:rPrDefault>
    <w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
  <w:style w:type="paragraph" w:styleId="Title">
    <w:name w:val="Title"/>
    <w:pPr><w:spacing w:before="0" w:after="240"/></w:pPr>
    <w:rPr>${tF}<w:b/><w:sz w:val="40"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:pPr><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr>
    <w:rPr>${tF}<w:b/><w:sz w:val="32"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading2">
    <w:name w:val="heading 2"/>
    <w:pPr><w:spacing w:before="200" w:after="80"/><w:outlineLvl w:val="1"/></w:pPr>
    <w:rPr>${tF}<w:b/><w:sz w:val="26"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading3">
    <w:name w:val="heading 3"/>
    <w:pPr><w:spacing w:before="160" w:after="80"/><w:outlineLvl w:val="2"/></w:pPr>
    <w:rPr>${tF}<w:b/><w:sz w:val="22"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="RoleHeading">
    <w:name w:val="Role Heading"/>
    <w:pPr><w:spacing w:before="280" w:after="80"/></w:pPr>
    <w:rPr>${tF}<w:b/><w:sz w:val="24"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="CodeBlock">
    <w:name w:val="Code Block"/>
    <w:pPr><w:shd w:val="clear" w:color="auto" w:fill="F6F8FA"/><w:spacing w:before="0" w:after="0"/><w:ind w:left="120"/></w:pPr>
    <w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/><w:sz w:val="20"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="SourceLine">
    <w:name w:val="Source"/>
    <w:pPr><w:spacing w:after="360"/></w:pPr>
    <w:rPr><w:color w:val="6A7280"/><w:sz w:val="18"/></w:rPr>
  </w:style>
  <w:style w:type="character" w:styleId="Hyperlink">
    <w:name w:val="Hyperlink"/>
    <w:rPr><w:color w:val="0A6BDC"/><w:u w:val="single"/></w:rPr>
  </w:style>
</w:styles>`;
  }

  // fontTable.xml: tells Word/LibreOffice/Collabora the family (swiss=sans,
  // roman=serif) and a substitution name to use when the primary font isn't
  // installed. Same-name entries collapse - emit Consolas once for code.
  function buildFontTableXml(titleFont, textFont) {
    const fonts = new Map();
    for (const f of [titleFont, textFont]) {
      if (!fonts.has(f.docxName)) fonts.set(f.docxName, f);
    }
    if (!fonts.has("Consolas")) fonts.set("Consolas", { docxName: "Consolas", docxAlt: "Courier New", family: "modern" });
    let body = "";
    for (const f of fonts.values()) {
      const famVal = f.family === "serif" ? "roman" : f.family === "modern" ? "modern" : "swiss";
      body += `<w:font w:name="${esc(f.docxName)}">`
            + `<w:altName w:val="${esc(f.docxAlt)}"/>`
            + `<w:family w:val="${famVal}"/>`
            + `<w:pitch w:val="${f.family === "modern" ? "fixed" : "variable"}"/>`
            + `</w:font>`;
    }
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:fonts xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${body}</w:fonts>`;
  }

  function buildDocRels(rels) {
    let body = '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>';
    body += '<Relationship Id="rIdNumbering" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>';
    body += '<Relationship Id="rIdFontTable" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/fontTable" Target="fontTable.xml"/>';
    for (const r of rels) {
      body += `<Relationship Id="${r.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${esc(r.target)}" TargetMode="External"/>`;
    }
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${body}</Relationships>`;
  }

  // ── Public entrypoint ───────────────────────────────────────────────
  NS.toDocx = async function toDocx(convo, opts) {
    if (!NS.createZip) throw new Error("zip module not loaded");

    const titleFont = pickFont(opts?.titleFont);
    const textFont  = pickFont(opts?.textFont);

    const { documentXml, rels } = buildDocumentXml(convo, opts);
    const docRels      = buildDocRels(rels);
    const stylesXml    = buildStylesXml(titleFont, textFont);
    const fontTableXml = buildFontTableXml(titleFont, textFont);

    const entries = [
      { name: "[Content_Types].xml",          data: CONTENT_TYPES },
      { name: "_rels/.rels",                  data: ROOT_RELS },
      { name: "word/_rels/document.xml.rels", data: docRels },
      { name: "word/document.xml",            data: documentXml },
      { name: "word/styles.xml",              data: stylesXml },
      { name: "word/numbering.xml",           data: NUMBERING_XML },
      { name: "word/fontTable.xml",           data: fontTableXml },
    ];
    return NS.createZip(entries);
  };

  NS.DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
})();
