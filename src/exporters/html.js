(() => {
  const NS = (globalThis.AiDoc ||= {});

  function escapeHtml(s) {
    return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  const SYS_SANS = `-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif`;

  // Build the @import rule for any selected font that lives on Google Fonts.
  // System fonts (system, georgia) produce no network request.
  function fontImports(opts) {
    const families = [];
    for (const f of [opts?.titleFont, opts?.textFont]) {
      if (f?.googleFamily && !families.includes(f.googleFamily)) families.push(f.googleFamily);
    }
    if (!families.length) return "";
    const url = "https://fonts.googleapis.com/css2?"
      + families.map(f => "family=" + encodeURIComponent(f) + ":wght@400;500;600;700").join("&")
      + "&display=swap";
    return `@import url("${url}");\n`;
  }

  function buildStyles(opts) {
    const titleStack = opts?.titleFont?.stack || SYS_SANS;
    const textStack  = opts?.textFont?.stack  || SYS_SANS;
    const sizePx     = opts?.fontSize?.px     || 15;
    // When the HTML is going to be embedded in a host that already provides
    // page margins (Word altChunk, Drive's html→Doc converter, OneNote),
    // strip our own body margin/padding/max-width so the host's page
    // margins aren't doubled up - and use a heading style that survives
    // those converters: no flexbox, no border-radius, plain block layout.
    const embedded = !!opts?.embedded;
    const bodyFrame = embedded
      ? `body { font: ${sizePx}px/1.55 var(--adx-text-font); margin: 0; padding: 0; color: #222; background: #fff; }`
      : `body { font: ${sizePx}px/1.55 var(--adx-text-font); max-width: 820px; margin: 32px auto; padding: 0 20px; color: #222; background: #fff; }`;
    const headingStyle = embedded
      // Word and Drive both keep CSS padding but apply background only to the
      // text run - the result looks like a small pill indented from the left
      // margin, not a styled heading. So in embedded mode we drop padding,
      // background, border-left, and section margins entirely. Heading is
      // plain bold flush-left; role distinction comes from font color only
      // (Drive preserves text color reliably). Time follows inline.
      ? `h2 { font-family: var(--adx-title-font); font-size: 1.2em; margin: 1em 0 .25em; color: #333; }
    h2.role-user { color: #0a4ea8; }
    h2.role-assistant { color: #1f6b1f; }
    .msg-time { font-size: .85em; font-weight: normal; color: #6a7280; font-family: var(--adx-text-font); margin-left: .8em; }
    .message { margin: 0; }
    .message-body { padding: 0; }`
      // Standalone HTML - flex makes the timestamp float to the right.
      : `h2 { font-family: var(--adx-title-font); font-size: 1.15em; margin: 1.5em 0 .3em; padding: .4em .8em; background: #f4f6f8; border-left: 4px solid #d0d7de; border-radius: 4px; display: flex; align-items: baseline; justify-content: space-between; gap: .8em; }
    .msg-time { font-size: .8em; font-weight: normal; color: #6a7280; font-family: var(--adx-text-font); }`;
    return fontImports(opts) + `
    :root { color-scheme: light dark; --adx-title-font: ${titleStack}; --adx-text-font: ${textStack}; }
    ${bodyFrame}
    h1 { font-family: var(--adx-title-font); font-size: 1.8em; margin: 0 0 .2em; }
    ${headingStyle}
    h2.role-user { background: #eef6ff; border-left-color: #4a9eff; }
    h2.role-assistant { background: #f0f9f0; border-left-color: #5aaa5a; }
    p { margin: .6em 0; }
    .source { color: #6a7280; font-size: .9em; margin-bottom: 2em; }
    .message { margin: 1.2em 0 1.6em; }
    .message-body { padding: 0 .2em; }
    pre { background: #f6f8fa; padding: 12px 14px; border-radius: 6px; overflow-x: auto; font: 13px/1.5 ui-monospace, SFMono-Regular, "Cascadia Code", Menlo, Consolas, monospace; }
    code { background: rgba(135,131,120,.15); padding: .15em .35em; border-radius: 3px; font: 13px/1.4 ui-monospace, SFMono-Regular, "Cascadia Code", Menlo, Consolas, monospace; }
    pre code { background: transparent; padding: 0; }
    blockquote { margin: .8em 0; padding: .2em 1em; border-left: 3px solid #ccc; color: #555; background: #fafafa; }
    table { border-collapse: collapse; margin: .8em 0; }
    th, td { border: 1px solid #ddd; padding: 6px 10px; text-align: left; }
    th { background: #f4f6f8; }
    img { max-width: 100%; height: auto; border-radius: 6px; margin: .4em 0; }
    a { color: #0a6bdc; }
    hr { border: none; border-top: 1px solid #e5e5e5; margin: 1.5em 0; }
    @media (prefers-color-scheme: dark) {
      body { background: #1b1d20; color: #e5e7eb; }
      h2 { background: #2a2d31; border-left-color: #444; }
      h2.role-user { background: #1e2a3d; border-left-color: #4a9eff; }
      h2.role-assistant { background: #1f2c1f; border-left-color: #5aaa5a; }
      pre, table th { background: #24272c; }
      code { background: rgba(255,255,255,.08); }
      blockquote { background: #24272c; border-left-color: #444; color: #b8bcc4; }
      th, td { border-color: #3a3d42; }
      .source { color: #8a929c; }
      .msg-time { color: #8a929c; }
      a { color: #6db1ff; }
      hr { border-top-color: #3a3d42; }
    }
  `;
  }

  // KaTeX CDN bundle - pinned to a known-good version. Loaded only when
  // math rendering is enabled. The auto-render extension scans the DOM for
  // common TeX delimiters at view time and replaces them with rendered
  // math (no extra markdown processing needed - `$…$`, `$$…$$`, `\(…\)`,
  // and `\[…\]` flow through the markdown→HTML pipeline untouched).
  const KATEX_VERSION = "0.16.11";
  function katexHead() {
    return `
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@${KATEX_VERSION}/dist/katex.min.css">
<script defer src="https://cdn.jsdelivr.net/npm/katex@${KATEX_VERSION}/dist/katex.min.js"></script>
<script defer src="https://cdn.jsdelivr.net/npm/katex@${KATEX_VERSION}/dist/contrib/auto-render.min.js"
  onload="renderMathInElement(document.body, { delimiters: [
    { left: '$$',  right: '$$',  display: true  },
    { left: '\\\\[', right: '\\\\]', display: true  },
    { left: '\\\\(', right: '\\\\)', display: false },
    { left: '$',   right: '$',   display: false }
  ], throwOnError: false });"></script>`;
  }

  // Format an ISO-8601 timestamp (or numeric Unix-seconds) using the user's
  // browser locale. Returns "" for missing / unparseable input so the caller
  // can simply concatenate the result.
  function formatTime(t) {
    if (t == null || t === "") return "";
    const d = typeof t === "number"
      ? new Date(t * (t < 1e12 ? 1000 : 1)) // accept Unix seconds OR ms
      : new Date(t);
    if (isNaN(d.getTime())) return "";
    try { return d.toLocaleString(); } catch { return d.toISOString(); }
  }

  NS.toHtml = function toHtml(convo, opts) {
    const aiName = NS.siteName?.(convo.site) || "Assistant";
    const showTime = !!opts?.showTime;
    const showThinking = opts?.showThinking !== false; // default ON
    const embedded = !!opts?.embedded;
    // `bare` = the message alone, no document apparatus: no <h1> title, no
    // Source line, no role heading. Used by the inline "Copy as HTML" button —
    // pasting ONE message into a mail or a doc should paste that message, not
    // a three-line header announcing where it came from.
    const bare = !!opts?.bare;
    const messages = convo.messages.map((m) => {
      const label = m.role === "user" ? "User"
                  : m.role === "assistant" ? aiName
                  : m.role;
      const cls = m.role === "user" ? "role-user"
                : m.role === "assistant" ? "role-assistant" : "";
      // Apply the thinking-block filter before markdown→HTML so the stripped
      // blockquote disappears completely (no empty <blockquote> shell).
      const md = showThinking || !NS.stripThinking ? m.markdown : NS.stripThinking(m.markdown);
      let body = NS.markdownToHtml ? NS.markdownToHtml(md) : `<pre>${escapeHtml(md)}</pre>`;
      // Word's altChunk and Drive's html→Doc converters ignore CSS
      // max-width on <img> - they only honor inline style + HTML width
      // attribute. Without this, large generated images overflow the
      // page. 600px ≈ 6.25" at 96 dpi, which fits a standard letter
      // page with 1" margins.
      if (embedded) {
        body = body.replace(/<img\b([^>]*?)>/gi, (m, attrs) => {
          if (/\s(width|style)=/i.test(attrs)) return m; // respect existing sizing
          return `<img${attrs} style="max-width:100%; height:auto;" width="600">`;
        });
      }
      const timeStr = showTime ? formatTime(m.time) : "";
      const timeMarkup = timeStr ? `<time class="msg-time">${escapeHtml(timeStr)}</time>` : "";
      // Embedded: skip the <section>/<div> wrappers - Word and Drive treat
      // each wrapper as an extra paragraph block, producing blank lines
      // between heading and body. Standalone HTML keeps the wrappers for
      // CSS scoping.
      if (bare) return body;
      if (embedded) {
        return `<h2 class="${cls}">${escapeHtml(label)}${timeMarkup}</h2>\n${body}`;
      }
      return `<section class="message">
  <h2 class="${cls}">${escapeHtml(label)}${timeMarkup}</h2>
  <div class="message-body">${body}</div>
</section>`;
    }).join("\n");

    const title = escapeHtml(convo.title || `${aiName} chat`);
    const showSource = !bare && opts?.showSource !== false; // default ON
    const sourceMarkup = showSource && convo.url
      ? `<p class="source">Source: <a href="${escapeHtml(convo.url)}">${escapeHtml(convo.site)}</a></p>`
      : "";
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>${buildStyles(opts)}</style>${opts?.math ? katexHead() : ""}
</head>
<body>
${bare ? "" : `<h1>${title}</h1>`}
${sourceMarkup}
${messages}
</body>
</html>
`;
  };
})();
