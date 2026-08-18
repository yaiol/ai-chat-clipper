// font registry for HTML export.
//
// Two user-selectable fonts:
//   - Title: applied to <h1> (document title) and <h2> (role headings)
//   - Text:  applied to <body>, prose, lists, blockquotes
//
// Used by:
//   - options.js - renders the two dropdowns on the General page
//   - exporters/html.js - emits @import for any non-system family selected
//   - content.js - reads the user's choice before calling NS.toHtml()
//
// `googleFamily`, when present, is fetched from Google Fonts at the moment
// the exported HTML is opened. `system` and `georgia` are local fonts and
// produce no network requests.

(() => {
  const NS = (globalThis.AiDoc ||= {});

  const SYS_SANS  = `-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif`;
  const SYS_SERIF = `Georgia, "Times New Roman", serif`;

  // `family` drives the DOCX export: it's the OOXML <w:family> hint
  // ("swiss" = sans-serif, "roman" = serif) and selects the substitution
  // font name when the chosen face isn't installed on the reader's machine.
  // `docxName` is the primary face emitted into the .docx; `docxAlt` is
  // the universally-installed substitution font for the same category.
  NS.FONTS = [
    { key: "system",           label: "System (default)",  stack: SYS_SANS,                            family: "sans",  docxName: "Calibri",          docxAlt: "Arial"           },
    { key: "inter",            label: "Inter",             stack: `Inter, ${SYS_SANS}`,                family: "sans",  docxName: "Inter",            docxAlt: "Arial",            googleFamily: "Inter" },
    { key: "roboto",           label: "Roboto",            stack: `Roboto, ${SYS_SANS}`,               family: "sans",  docxName: "Roboto",           docxAlt: "Arial",            googleFamily: "Roboto" },
    { key: "source-sans",      label: "Source Sans 3",     stack: `"Source Sans 3", ${SYS_SANS}`,      family: "sans",  docxName: "Source Sans 3",    docxAlt: "Arial",            googleFamily: "Source Sans 3" },
    { key: "lora",             label: "Lora",              stack: `Lora, ${SYS_SERIF}`,                family: "serif", docxName: "Lora",             docxAlt: "Georgia",          googleFamily: "Lora" },
    { key: "merriweather",     label: "Merriweather",      stack: `Merriweather, ${SYS_SERIF}`,        family: "serif", docxName: "Merriweather",     docxAlt: "Georgia",          googleFamily: "Merriweather" },
    { key: "playfair-display", label: "Playfair Display",  stack: `"Playfair Display", ${SYS_SERIF}`,  family: "serif", docxName: "Playfair Display", docxAlt: "Georgia",          googleFamily: "Playfair Display" },
    { key: "georgia",          label: "Georgia",           stack: SYS_SERIF,                           family: "serif", docxName: "Georgia",          docxAlt: "Times New Roman" },
  ];

  NS.findFont = (key) => NS.FONTS.find(f => f.key === key) || NS.FONTS[0];

  // Body font size for HTML / PDF exports + the smart-view preview.
  // Three discrete steps so the UI stays compact (one dropdown).
  NS.FONT_SIZES = [
    { key: "small",  px: 13 },
    { key: "medium", px: 15 },
    { key: "large",  px: 17 },
  ];

  NS.findFontSize = (key) => NS.FONT_SIZES.find(s => s.key === key) || NS.FONT_SIZES[1];

  NS.STORAGE = Object.assign(NS.STORAGE || {}, {
    HTML_TITLE_FONT:  "adx_html_title_font",
    HTML_TEXT_FONT:   "adx_html_text_font",
    HTML_FONT_SIZE:   "adx_html_font_size",    // "small" | "medium" | "large", default "medium"
    HTML_MATH:        "adx_html_math",         // boolean - KaTeX on/off, default true
    HTML_SHOW_TIME:     "adx_html_show_time",     // boolean - render per-message timestamp, default false
    HTML_SHOW_SOURCE:   "adx_html_show_source",   // boolean - render "Source: <link>" line, default true
    HTML_SHOW_THINKING: "adx_html_show_thinking", // boolean - keep "> **Thinking**" blockquotes, default true
    FILENAME_PATTERN:   "adx_filename_pattern",   // string - exported filename template, default "{title}"
    // Per-message inline button visibility - General settings page exposes
    // each as a toggle. All default to true so a freshly installed
    // extension matches what users have always seen.
    INLINE_EXPORT_MENU: "adx_inline_export_menu", // boolean, default true
    INLINE_COPY_MD:     "adx_inline_copy_md",     // boolean, default true
    INLINE_COPY_HTML:   "adx_inline_copy_html",   // boolean, default true
  });

  // Returns { title, text } - both resolved Font objects, never null.
  NS.getHtmlFonts = async () => ({
    title: NS.findFont(await NS.getLocal(NS.STORAGE.HTML_TITLE_FONT, "system")),
    text:  NS.findFont(await NS.getLocal(NS.STORAGE.HTML_TEXT_FONT,  "system")),
  });

  NS.setHtmlFont = (kind, key) => {
    const storageKey = kind === "title"
      ? NS.STORAGE.HTML_TITLE_FONT
      : NS.STORAGE.HTML_TEXT_FONT;
    return NS.setLocal(storageKey, key);
  };

  // Math rendering toggle - default true. Returns/accepts a boolean.
  NS.getHtmlMath = async () => {
    const v = await NS.getLocal(NS.STORAGE.HTML_MATH, true);
    return v !== false;
  };
  NS.setHtmlMath = (on) => NS.setLocal(NS.STORAGE.HTML_MATH, !!on);

  // Body font size - returns/accepts a key from FONT_SIZES.
  NS.getHtmlFontSize = async () =>
    NS.findFontSize(await NS.getLocal(NS.STORAGE.HTML_FONT_SIZE, "medium"));
  NS.setHtmlFontSize = (key) => NS.setLocal(NS.STORAGE.HTML_FONT_SIZE, key);

  // Show per-message timestamp toggle - default false (most chats don't
  // surface time prominently in their own UI).
  NS.getHtmlShowTime = async () => {
    const v = await NS.getLocal(NS.STORAGE.HTML_SHOW_TIME, false);
    return v === true;
  };
  NS.setHtmlShowTime = (on) => NS.setLocal(NS.STORAGE.HTML_SHOW_TIME, !!on);

  // Show "Source: <link>" line at the top of the export - default true.
  NS.getHtmlShowSource = async () => {
    const v = await NS.getLocal(NS.STORAGE.HTML_SHOW_SOURCE, true);
    return v !== false;
  };
  NS.setHtmlShowSource = (on) => NS.setLocal(NS.STORAGE.HTML_SHOW_SOURCE, !!on);

  // Show / strip "> **Thinking**" blockquotes - default true.
  NS.getHtmlShowThinking = async () => {
    const v = await NS.getLocal(NS.STORAGE.HTML_SHOW_THINKING, true);
    return v !== false;
  };
  NS.setHtmlShowThinking = (on) => NS.setLocal(NS.STORAGE.HTML_SHOW_THINKING, !!on);

  // Default filename template - single placeholder, preserves the historical
  // "save as the chat title" behavior. Users tweak via Settings → General.
  NS.DEFAULT_FILENAME_PATTERN = "{title}";
  NS.getFilenamePattern = async () => {
    const v = await NS.getLocal(NS.STORAGE.FILENAME_PATTERN, NS.DEFAULT_FILENAME_PATTERN);
    return (typeof v === "string" && v.trim()) ? v : NS.DEFAULT_FILENAME_PATTERN;
  };
  NS.setFilenamePattern = (s) => NS.setLocal(NS.STORAGE.FILENAME_PATTERN, String(s ?? ""));

  // Per-message inline button visibility. All three default to true so an
  // existing install keeps showing what it always showed; users opt out via
  // Settings → General.
  NS.getInlineExportMenu = async () => {
    const v = await NS.getLocal(NS.STORAGE.INLINE_EXPORT_MENU, true);
    return v !== false;
  };
  NS.setInlineExportMenu = (on) => NS.setLocal(NS.STORAGE.INLINE_EXPORT_MENU, !!on);

  NS.getInlineCopyMd = async () => {
    const v = await NS.getLocal(NS.STORAGE.INLINE_COPY_MD, true);
    return v !== false;
  };
  NS.setInlineCopyMd = (on) => NS.setLocal(NS.STORAGE.INLINE_COPY_MD, !!on);

  NS.getInlineCopyHtml = async () => {
    const v = await NS.getLocal(NS.STORAGE.INLINE_COPY_HTML, true);
    return v !== false;
  };
  NS.setInlineCopyHtml = (on) => NS.setLocal(NS.STORAGE.INLINE_COPY_HTML, !!on);

  // Strip the "> **Thinking**" blockquote pattern that several adapters emit
  // (Claude, DeepSeek, Gemini). Used by the HTML exporter and the smart-view
  // preview when Show Thinking is off - single source of truth so both
  // surfaces filter identically.
  const THINKING_RE = /^>\s*\*\*Thinking\*\*[^\n]*\n(?:>[^\n]*(?:\n|$))*/gm;
  NS.stripThinking = function stripThinking(md) {
    if (!md) return md;
    return md.replace(THINKING_RE, "").replace(/\n{3,}/g, "\n\n").trim();
  };

  // Convert TeX-style delimiters to markdown math — \[…\] → $$…$$ (display),
  // \(…\) → $…$ (inline). ⚠ CLAUDE: ONLY outside fenced code (odd split
  // indices are ``` blocks) — inside code `\(` is literal (a regex, a string);
  // SaveAI converts there too and corrupts the code. Shared by the chatgpt +
  // copilot adapters, both of which emit \[ \] in prose.
  NS.normalizeLatexDelimiters = function normalizeLatexDelimiters(text) {
    if (!text) return text;
    return text.split(/(```[\s\S]*?```)/g).map((seg, i) => i % 2 === 1 ? seg : seg
      .replace(/\\\[([\s\S]*?)\\\]/g, (_, x) => "$$" + x.trim() + "$$")
      .replace(/\\\(([\s\S]*?)\\\)/g, (_, x) => "$" + x.trim() + "$")
    ).join("");
  };
})();
