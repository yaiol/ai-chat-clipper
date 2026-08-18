// selection page.
//
// Flow (entry: adx:select-show in popup.js):
//   1. popup.js sends `adx:extract-only` to the active tab → gets back the
//      canonical { title, url, site, messages } (resolveBlobUrls already done).
//   2. popup.js stashes it in chrome.storage.session under PENDING_KEY and
//      opens this page in a new tab.
//   3. This page reads the stash, renders one row per message with a checkbox,
//      and lets the user pick a subset + a format.
//   4. Export reuses NS.renderConvo (same path as the popup's export-everything
//      flow) - the only difference is convo.messages is filtered to checked rows.

(async () => {
  const i18n = AiDoc.i18n;
  await i18n.init();
  i18n.applyDom();

  const PENDING_KEY = "adx_pending_select";
  const titleEl    = document.getElementById("title");
  const sourceEl   = document.getElementById("source");
  const statusEl   = document.getElementById("status");
  const messagesEl = document.getElementById("messages");
  const noticeEl   = document.getElementById("notice");

  // ── Read the stashed conversation from chrome.storage.local ────────────
  // (popup.js writes there because session has a 10MB cap that breaks on
  // image-heavy Reve / ChatGPT convos. `unlimitedStorage` permission in
  // the manifest removes the local cap.)
  function loadPending() {
    return new Promise(resolve => {
      try { chrome.storage.local.get([PENDING_KEY], r => resolve(r?.[PENDING_KEY] || null)); }
      catch { resolve(null); }
    });
  }
  function clearPending() {
    return new Promise(resolve => {
      try { chrome.storage.local.remove([PENDING_KEY], () => resolve()); }
      catch { resolve(); }
    });
  }

  const pending = await loadPending();
  if (!pending || !pending.convo) {
    noticeEl.textContent = i18n.t("selectErrorLoadFailed");
    return;
  }
  const { convo, siteLabel } = pending;
  // We only need the stash for this page-open. Clear it so a stale convo
  // doesn't leak into a future selection from a different tab.
  clearPending();

  if (!convo.messages.length) {
    noticeEl.textContent = i18n.t("selectErrorNoMessages");
    return;
  }

  // ── Render header ──────────────────────────────────────────────────────
  if (convo.title) titleEl.textContent = convo.title;
  function renderSourceLink() {
    sourceEl.textContent = "";
    if (!convo.url) return;
    const a = document.createElement("a");
    a.href = convo.url;
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = siteLabel || convo.site || convo.url;
    sourceEl.append("Source: ", a);
  }
  renderSourceLink();

  // ── Render rows ────────────────────────────────────────────────────────
  // `selected` holds indices into convo.messages.
  const selected = new Set(convo.messages.map((_, i) => i)); // default: everything checked

  function formatTime(t) {
    if (t == null || t === "") return "";
    const d = typeof t === "number"
      ? new Date(t * (t < 1e12 ? 1000 : 1))
      : new Date(t);
    if (isNaN(d.getTime())) return "";
    try { return d.toLocaleString(); } catch { return d.toISOString(); }
  }

  // Show-time toggle is reflected by a class on <body>; CSS hides .msg-time
  // when the class is absent. Same trick for show-source on the source line.
  function applyVisibility() {
    document.body.classList.toggle("show-time",   showTimeToggle.checked);
    document.body.classList.toggle("show-source", showSourceToggle.checked);
  }

  function renderRows() {
    messagesEl.innerHTML = "";
    convo.messages.forEach((m, i) => {
      const row = document.createElement("label");
      row.className = "msg" + (selected.has(i) ? " selected" : "");
      row.dataset.idx = String(i);

      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = selected.has(i);

      const right = document.createElement("div");

      const head = document.createElement("div");
      head.className = "msg-head";
      const role = document.createElement("span");
      role.className = "role " + (m.role === "user" ? "user" : "assistant");
      role.textContent = m.role === "user" ? i18n.t("selectRoleUser") : i18n.t("selectRoleAssistant");
      const idx = document.createElement("span");
      idx.className = "index";
      idx.textContent = "#" + (i + 1);
      head.append(role, idx);
      const timeStr = formatTime(m.time);
      if (timeStr) {
        const t = document.createElement("span");
        t.className = "msg-time";
        t.textContent = timeStr;
        head.append(t);
      }

      const body = document.createElement("div");
      body.className = "msg-body";
      // Thinking blockquotes are stripped from the preview when the toggle
      // is off - same filter the HTML exporter applies.
      let displayMd = showThinkingToggle?.checked === false && AiDoc.stripThinking
        ? AiDoc.stripThinking(m.markdown)
        : m.markdown;
      // Hide base64 image payloads in the preview - they spam the panel
      // with hundreds of KB of unreadable junk. The export still carries
      // the full data URL; this transform is display-only.
      displayMd = displayMd.replace(
        /!\[([^\]]*)\]\(data:[^)]+\)/g,
        (_full, alt) => alt ? `🖼 [${alt}]` : `🖼 [Image]`
      );
      body.textContent = displayMd;

      right.append(head, body);
      row.append(cb, right);
      messagesEl.appendChild(row);
    });
    refreshStatus();
  }

  function refreshStatus() {
    statusEl.textContent = i18n.t("selectStatusCount", {
      n: selected.size, total: convo.messages.length
    });
    refreshSelectToggle();
  }

  // Tri-state header checkbox:
  //   all selected   → checked,        tooltip "Select none"
  //   none selected  → unchecked,      tooltip "Select all"
  //   some selected  → indeterminate,  tooltip "Select all" (clicking selects all)
  function refreshSelectToggle() {
    const total = convo.messages.length;
    const n = selected.size;
    if (n === 0) {
      selectToggle.checked = false;
      selectToggle.indeterminate = false;
      selectToggle.title = i18n.t("optionsSelectAll");
    } else if (n === total) {
      selectToggle.checked = true;
      selectToggle.indeterminate = false;
      selectToggle.title = i18n.t("optionsSelectNone");
    } else {
      selectToggle.checked = false;
      selectToggle.indeterminate = true;
      selectToggle.title = i18n.t("optionsSelectAll");
    }
    selectToggle.setAttribute("aria-label", selectToggle.title);
  }

  // Checkbox toggle (event delegation on the list).
  messagesEl.addEventListener("change", (e) => {
    const cb = e.target.closest('input[type="checkbox"]');
    if (!cb) return;
    const row = cb.closest(".msg");
    const idx = Number(row?.dataset.idx);
    if (Number.isNaN(idx)) return;
    if (cb.checked) selected.add(idx); else selected.delete(idx);
    row.classList.toggle("selected", cb.checked);
    refreshStatus();
  });

  // Click on the body text expands/collapses the message preview without
  // toggling the checkbox.
  messagesEl.addEventListener("click", (e) => {
    const body = e.target.closest(".msg-body");
    if (!body) return;
    e.preventDefault();
    body.classList.toggle("expanded");
  });

  // ── Live preview typography (size + title + text fonts) ────────────────
  // The three toolbar dropdowns are persisted to the same chrome.storage.local
  // keys the HTML exporter reads - so picking fonts here previews exactly what
  // the export will look like.
  const sizeSelect      = document.getElementById("size-select");
  const titleFontSelect = document.getElementById("title-font-select");
  const textFontSelect  = document.getElementById("text-font-select");

  // Keeps a single <link rel="stylesheet"> in <head> for the currently-needed
  // Google Fonts families. Replaced atomically when the selection changes so
  // we never accumulate stale font fetches.
  let fontLinkEl = null;
  function applyFontLink(fonts) {
    const families = [];
    for (const f of fonts) {
      if (f?.googleFamily && !families.includes(f.googleFamily)) families.push(f.googleFamily);
    }
    if (!families.length) {
      if (fontLinkEl) { fontLinkEl.remove(); fontLinkEl = null; }
      return;
    }
    const url = "https://fonts.googleapis.com/css2?"
      + families.map(f => "family=" + encodeURIComponent(f) + ":wght@400;500;600;700").join("&")
      + "&display=swap";
    if (!fontLinkEl) {
      fontLinkEl = document.createElement("link");
      fontLinkEl.rel = "stylesheet";
      document.head.appendChild(fontLinkEl);
    }
    fontLinkEl.href = url;
  }

  function applyPreview() {
    const title = AiDoc.findFont(titleFontSelect.value);
    const text  = AiDoc.findFont(textFontSelect.value);
    const size  = AiDoc.findFontSize(sizeSelect.value);
    document.body.style.setProperty("--preview-title-font", title.stack);
    document.body.style.setProperty("--preview-text-font",  text.stack);
    document.body.style.setProperty("--preview-text-size",  size.px + "px");
    applyFontLink([title, text]);
  }

  // Populate dropdowns. Explicit key map keeps every i18n key greppable -
  // dynamic concatenation hides them from the audit script.
  const SIZE_LABEL_KEYS = {
    small:  "selectFontSizeSmall",
    medium: "selectFontSizeMedium",
    large:  "selectFontSizeLarge",
  };
  for (const s of AiDoc.FONT_SIZES) {
    const opt = document.createElement("option");
    opt.value = s.key;
    opt.textContent = i18n.t(SIZE_LABEL_KEYS[s.key]);
    sizeSelect.appendChild(opt);
  }
  for (const sel of [titleFontSelect, textFontSelect]) {
    for (const f of AiDoc.FONTS) {
      const opt = document.createElement("option");
      opt.value = f.key;
      opt.textContent = f.key === "system" ? i18n.t("optionsFontSystem") : f.label;
      sel.appendChild(opt);
    }
  }

  // Initial values from storage, then live preview.
  const initialFonts = await AiDoc.getHtmlFonts();
  const initialSize  = await AiDoc.getHtmlFontSize();
  titleFontSelect.value = initialFonts.title.key;
  textFontSelect.value  = initialFonts.text.key;
  sizeSelect.value      = initialSize.key;
  applyPreview();

  sizeSelect.addEventListener("change", async () => {
    await AiDoc.setHtmlFontSize(sizeSelect.value);
    applyPreview();
  });
  titleFontSelect.addEventListener("change", async () => {
    await AiDoc.setHtmlFont("title", titleFontSelect.value);
    applyPreview();
  });
  textFontSelect.addEventListener("change", async () => {
    await AiDoc.setHtmlFont("text", textFontSelect.value);
    applyPreview();
  });

  // ── Show-time / show-source / show-thinking toggles ──────────────────
  const showTimeToggle     = document.getElementById("show-time");
  const showSourceToggle   = document.getElementById("show-source");
  const showThinkingToggle = document.getElementById("show-thinking");
  showTimeToggle.checked     = await AiDoc.getHtmlShowTime();
  showSourceToggle.checked   = await AiDoc.getHtmlShowSource();
  showThinkingToggle.checked = await AiDoc.getHtmlShowThinking();
  applyVisibility();
  showTimeToggle.addEventListener("change", async () => {
    await AiDoc.setHtmlShowTime(showTimeToggle.checked);
    applyVisibility();
  });
  showSourceToggle.addEventListener("change", async () => {
    await AiDoc.setHtmlShowSource(showSourceToggle.checked);
    applyVisibility();
  });
  showThinkingToggle.addEventListener("change", async () => {
    await AiDoc.setHtmlShowThinking(showThinkingToggle.checked);
    // Re-render rows so previews reflect the new filter immediately.
    renderRows();
  });

  // ── Bulk action: single tri-state checkbox ───────────────────────────
  // Click rules:
  //   - all selected   → deselect all
  //   - any other      → select all (treat indeterminate as "not all", so a
  //                      click promotes the partial selection to full)
  const selectToggle = document.getElementById("select-toggle");
  selectToggle.addEventListener("click", () => {
    const total = convo.messages.length;
    if (selected.size === total) {
      selected.clear();
    } else {
      for (let i = 0; i < total; i++) selected.add(i);
    }
    renderRows();
  });

  // ── Export ────────────────────────────────────────────────────────────
  function flashNotice(msg, ok) {
    noticeEl.textContent = msg;
    noticeEl.className = "notice" + (ok ? " ok" : "");
  }

  async function doExport(format) {
    if (selected.size === 0) {
      flashNotice(i18n.t("selectErrorNoSelection"), false);
      return;
    }
    flashNotice("", false);
    const indices = [...selected].sort((a, b) => a - b);
    const filtered = {
      ...convo,
      messages: indices.map(i => convo.messages[i]),
    };

    try {
      const out = await AiDoc.renderConvo(filtered, format);

      if (out.openPrintTab) {
        const res = await chrome.runtime.sendMessage({
          type: "adx:open-print-tab", content: out.content
        });
        if (!res?.ok) throw new Error(res?.error || i18n.t("errorPrintTab"));
        flashNotice(i18n.t("statusOpenedPrintTab"), true);
        return;
      }

      // Cloud uploads - payload is built by NS.renderConvo, the actual API
      // call happens in background.js (which has the host_permissions and
      // the auth helpers loaded into the SW).
      if (out.uploadGdoc) {
        const res = await chrome.runtime.sendMessage({
          type: "adx:upload-gdoc", title: out.filename, html: out.content,
        });
        if (!res?.ok) throw new Error(res?.error || "Google Docs upload failed");
        flashNotice(i18n.t("statusOpenedGdoc"), true);
        return;
      }
      if (out.uploadMsword) {
        const res = await chrome.runtime.sendMessage({
          type: "adx:upload-msword",
          filename: out.filename, contentBase64: out.content, mime: out.mime,
        });
        if (!res?.ok) throw new Error(res?.error || "Word Online upload failed");
        flashNotice(i18n.t("statusOpenedMsword"), true);
        return;
      }
      if (out.uploadNotion) {
        const res = await chrome.runtime.sendMessage({
          type: "adx:notion-create-page",
          parent: out.parent, properties: out.properties,
          children: out.children, extras: out.extras,
        });
        if (!res?.ok) throw new Error(res?.error || "Notion upload failed");
        flashNotice(i18n.t("statusOpenedNotion"), true);
        return;
      }
      if (out.uploadNextcloud) {
        const res = await chrome.runtime.sendMessage({
          type: "adx:upload-nextcloud",
          filename: out.filename, contentBase64: out.content, mime: out.mime,
        });
        if (!res?.ok) throw new Error(res?.error || "Nextcloud upload failed");
        flashNotice(i18n.t("statusOpenedNextcloud"), true);
        return;
      }
      if (out.uploadOnenote) {
        const res = await chrome.runtime.sendMessage({
          type: "adx:upload-onenote",
          title: out.filename, html: out.content,
        });
        if (!res?.ok) throw new Error(res?.error || "OneNote upload failed");
        flashNotice(i18n.t("statusOpenedOnenote"), true);
        return;
      }

      const dl = await AiDoc.downloadFile({
        filename: out.filename,
        content: out.content,
        mime: out.mime,
        base64: !!out.base64,
      });
      if (!dl?.ok) throw new Error(dl?.error || i18n.t("errorDownloadFailed"));
      flashNotice(i18n.t("statusSaved", { filename: out.filename }), true);
    } catch (err) {
      flashNotice(String(err?.message || err), false);
    }
  }

  const FORMATS = {
    "export-md":     "markdown",
    "export-html":   "html",
    "export-txt":    "text",
    "export-docx":   "docx",
    "export-odt":    "odt",
    "export-pdf":    "pdf",
    "export-image":  "image",
    "export-gdoc":   "gdoc",
    "export-msword":    "msword",
    "export-notion":    "notion",
    "export-nextcloud": "nextcloud",
    "export-onenote":   "onenote",
  };
  for (const [id, fmt] of Object.entries(FORMATS)) {
    document.getElementById(id).addEventListener("click", () => doExport(fmt));
  }

  // ── Copy-to-clipboard buttons ────────────────────────────────────────
  // Same shape as doExport, but the rendered content goes to the system
  // clipboard instead of a file download. HTML writes a ClipboardItem
  // carrying both text/html (rich-paste targets like Gmail, Docs, Notion,
  // Slack) and a stripped text/plain fallback for non-rich targets.
  async function doCopy(format) {
    if (selected.size === 0) {
      flashNotice(i18n.t("selectErrorNoSelection"), false);
      return;
    }
    flashNotice("", false);
    const indices = [...selected].sort((a, b) => a - b);
    const filtered = { ...convo, messages: indices.map(i => convo.messages[i]) };
    try {
      const out = await AiDoc.renderConvo(filtered, format);
      if (format === "html") {
        const html = out.content || "";
        const plain = html
          .replace(/<head[\s\S]*?<\/head>/gi, "")
          .replace(/<style[\s\S]*?<\/style>/gi, "")
          .replace(/<script[\s\S]*?<\/script>/gi, "")
          .replace(/<[^>]+>/g, "")
          .replace(/&nbsp;/g, " ")
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .replace(/[ \t]+\n/g, "\n")
          .replace(/\n{3,}/g, "\n\n")
          .trim();
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/html":  new Blob([html],  { type: "text/html" }),
            "text/plain": new Blob([plain], { type: "text/plain" }),
          }),
        ]);
      } else {
        await navigator.clipboard.writeText(out.content || "");
      }
      flashNotice("Copied!", true);
    } catch (err) {
      flashNotice(String(err?.message || err), false);
    }
  }
  document.getElementById("copy-md").addEventListener("click", () => doCopy("markdown"));
  document.getElementById("copy-html").addEventListener("click", () => doCopy("html"));

  renderRows();
})();
