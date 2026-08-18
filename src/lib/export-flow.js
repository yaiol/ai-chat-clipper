// shared export-flow helpers.
//
// Both content.js and the selection page (select.html) take a canonical
// `convo` and emit a `{ content, filename, mime, base64?, openPrintTab? }`
// payload that background.js downloads or opens for printing. Centralizing
// the format dispatch and the print-tab wrapper keeps the two surfaces in
// lock-step - no risk of drift between the popup's "export everything"
// path and the selection page's "export some messages" path.

(() => {
  const NS = (globalThis.AiDoc ||= {});

  // Append print-friendly styles + auto-print script so a new tab opens directly
  // into Chrome's print dialog where the user can pick "Save as PDF".
  NS.wrapForPrint = function wrapForPrint(html) {
    const inject = `<style>
      @media print {
        body { background: white !important; max-width: none !important; padding: 0 18px !important; }
        h2, pre, code, table th { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        img { max-width: 100% !important; page-break-inside: avoid; }
        section.message { page-break-inside: avoid; break-inside: avoid; }
        a { color: inherit; text-decoration: underline; }
      }
      @page { margin: 14mm; }
    </style>
    <script>window.addEventListener("load", () => setTimeout(() => window.print(), 400));</script>
    `;
    return html.replace(/<\/head>/i, inject + "</head>");
  };

  // Filename template expansion. Placeholders: {title}, {site}, {date},
  // {year}, {month}, {day}, {time}, {hour}, {min}, {datetime}.
  // - {date}     YYYY-MM-DD
  // - {time}     HH-MM      (hyphen because ":" is illegal in filenames)
  // - {datetime} YYYY-MM-DD HH-MM   (space between date and time)
  // The result is then run through safeFilename for OS-illegal chars.
  function pad2(n) { return String(n).padStart(2, "0"); }
  function siteLabel(siteId) {
    const found = NS.SITES?.find(s => s.id === siteId);
    return (found && found.label) || siteId || "";
  }
  NS.expandFilename = async function expandFilename(convo, template) {
    const pattern = template != null ? template : await NS.getFilenamePattern();
    const d = new Date();
    const yyyy = String(d.getFullYear());
    const MM   = pad2(d.getMonth() + 1);
    const DD   = pad2(d.getDate());
    const HH   = pad2(d.getHours());
    const mm   = pad2(d.getMinutes());
    const date = `${yyyy}-${MM}-${DD}`;
    const time = `${HH}-${mm}`;
    const map = {
      title:    convo.title || "chat",
      site:     siteLabel(convo.site),
      date,     year:  yyyy,  month: MM,  day:  DD,
      time,     hour:  HH,    min:   mm,
      datetime: `${date} ${time}`,
    };
    let out = pattern;
    for (const [k, v] of Object.entries(map)) {
      out = out.split("{" + k + "}").join(v);
    }
    return NS.safeFilename(out);
  };

  // Convert a canonical { title, url, site, messages } into a download payload.
  // `format` is one of: markdown | html | text | docx | odt | pdf.
  // `extra` overrides the resolved HTML options — the inline "Copy as HTML"
  // button passes `{ bare: true }` to get the message alone, with no title /
  // Source / role heading.
  NS.renderConvo = async function renderConvo(convo, format, extra) {
    const baseName = await NS.expandFilename(convo);

    // Resolve user-selected HTML fonts once per export - also used for PDF
    // since PDF goes through the HTML pipeline. (Image is now a live
    // screen capture and doesn't use the HTML pipeline at all.)
    let htmlOpts = null;
    if (format === "html" || format === "pdf" || format === "gdoc"
        || format === "docx" || format === "msword" || format === "nextcloud"
        || format === "onenote") {
      const f = await NS.getHtmlFonts();
      // `embedded` strips body margin/padding/max-width when the HTML is
      // going into a host with its own page margins - Word altChunk
      // (docx/msword), Drive's html→Doc converter (gdoc), OneNote - so
      // margins aren't doubled up. Standalone HTML and PDF keep the
      // centered web-page frame.
      const embedded = format === "docx" || format === "msword"
                    || format === "gdoc" || format === "onenote";
      htmlOpts = {
        titleFont:    f.title,
        textFont:     f.text,
        fontSize:     await NS.getHtmlFontSize(),
        math:         await NS.getHtmlMath(),
        showTime:     await NS.getHtmlShowTime(),
        showSource:   await NS.getHtmlShowSource(),
        showThinking: await NS.getHtmlShowThinking(),
        embedded,
        ...extra,
      };
    }

    switch (format) {
      case "html":
        return { content: NS.toHtml(convo, htmlOpts), filename: baseName + ".html", mime: "text/html" };
      case "text":
        return { content: NS.toText(convo), filename: baseName + ".txt", mime: "text/plain" };
      case "docx": {
        const bytes = await NS.toDocx(convo, htmlOpts);
        return { content: NS.bytesToBase64(bytes), filename: baseName + ".docx", mime: NS.DOCX_MIME, base64: true };
      }
      case "odt": {
        const bytes = await NS.toOdt(convo);
        return { content: NS.bytesToBase64(bytes), filename: baseName + ".odt", mime: NS.ODT_MIME, base64: true };
      }
      case "pdf":
        return {
          content: NS.wrapForPrint(NS.toHtml(convo, htmlOpts)),
          filename: baseName + ".pdf",
          mime: "text/html",
          openPrintTab: true,
        };
      case "image": {
        // Live screen capture of the chat - scrolls the chat container,
        // captures each viewport via chrome.tabs.captureVisibleTab, crops
        // to the chat region, stitches vertically. Bypasses the convo
        // entirely; needs the live DOM adapter.
        const adapter = NS.getAdapter?.();
        if (!adapter) throw new Error("No adapter for this site - can't capture.");
        const out = await NS.toImage(adapter);
        return {
          content: out.base64,
          filename: baseName + ".png",
          mime: NS.IMAGE_MIME,
          base64: true,
        };
      }
      case "gdoc": {
        // Upload HTML to Drive with mimeType=document so Drive converts
        // it to a native Google Doc on the fly.
        // We tried uploading the same .docx Word Online gets, expecting
        // higher fidelity, but Drive's docx→Doc converter ignores Word's
        // "altChunk" mechanism - and our docx puts ALL content in an
        // altChunk-referenced HTML file rather than in word/document.xml.
        // Result: Drive produced a perfectly empty Google Doc.
        // HTML→Doc is lower fidelity than Word's altChunk path but it
        // actually carries the content, which is the bare minimum.
        return {
          content: NS.toHtml(convo, htmlOpts),
          filename: baseName,
          mime: "text/html",
          uploadGdoc: true,
        };
      }
      case "msword": {
        // Build the same .docx the local download uses, hand the bytes to
        // background which uploads to OneDrive (App Folder) via Graph and
        // opens the resulting file in Word Online.
        const out = await NS.toMsWord(convo, htmlOpts);
        return {
          content: NS.bytesToBase64(out.bytes),
          filename: baseName + ".docx",
          mime: out.mime,
          base64: true,
          uploadMsword: true,
        };
      }
      case "onenote": {
        // OneNote accepts HTML directly - reuses the same toHtml pipeline as
        // the local HTML / Word / Drive exports so the resulting page mirrors
        // them. The page title comes from the <title> element.
        return {
          content: NS.toHtml(convo, htmlOpts),
          filename: baseName,
          mime: "text/html",
          uploadOnenote: true,
        };
      }
      case "nextcloud": {
        // Land the convo in the user's Nextcloud as Markdown by default -
        // Nextcloud's web UI has an inline Markdown editor so .md files
        // open natively. Background handles the WebDAV PUT.
        const conn = await new Promise((res) =>
          chrome.storage.local.get("adx_nextcloud", (o) => res(o.adx_nextcloud || null)));
        if (!conn?.serverUrl) throw new Error("nextcloud_not_connected");
        const fmt = conn.format || "markdown";
        const out = await NS.toNextcloud(convo, fmt, htmlOpts);
        return {
          content: NS.bytesToBase64(out.bytes),
          filename: baseName + "." + out.ext,
          mime: out.mime,
          base64: true,
          uploadNextcloud: true,
        };
      }
      case "notion": {
        // Apply Show Thinking before converting - Notion exporter has no
        // separate opt for this since it consumes plain markdown.
        const showThinking = NS.getHtmlShowThinking ? await NS.getHtmlShowThinking() : true;
        const showSource   = NS.getHtmlShowSource   ? await NS.getHtmlShowSource()   : true;
        const showTime     = NS.getHtmlShowTime     ? await NS.getHtmlShowTime()     : false;
        const cleanedConvo = (showThinking || !NS.stripThinking) ? convo : {
          ...convo,
          messages: convo.messages.map(m => ({ ...m, markdown: NS.stripThinking(m.markdown) })),
        };
        const conn = await new Promise((res) =>
          chrome.storage.local.get("adx_notion", (o) => res(o.adx_notion || null)));
        if (!conn?.access_token) throw new Error("notion_not_connected");
        if (!conn?.parent_page_id) throw new Error("notion_no_parent");
        const plan = NS.toNotion(
          { ...cleanedConvo, title: baseName },
          conn.parent_page_id,
          { showSource, showTime }
        );
        return { ...plan, filename: baseName, uploadNotion: true };
      }
      case "json":
        return { content: NS.toJson(convo), filename: baseName + ".json", mime: "application/json" };
      case "markdown":
      default:
        return { content: NS.toMarkdown(convo), filename: baseName + ".md", mime: "text/markdown" };
    }
  };
})();
