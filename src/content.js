(() => {
  const NS = globalThis.AiDoc;
  if (!NS) return;

  // Inline button uses the actual extension icon (blue rounded-square + white
  // sparkle document) for brand consistency with the toolbar / popup. The SVG
  // is referenced via chrome.runtime.getURL - exposed through the manifest's
  // web_accessible_resources so host pages can load it.
  const ICON_DOWNLOAD = `<img src="${chrome.runtime.getURL('assets/app.svg')}" alt="" draggable="false">`;
  const ICON_MD   = `<svg viewBox="0 -960 960 960" fill="currentColor"><path d="M220-80q-24 0-42-18t-18-42v-680q0-24 18-42t42-18h361l219 219v521q0 24-18 42t-42 18H220Zm331-554v-186H220v680h520v-494H551ZM220-820v186-186 680-680Z"/><path d="M348.5-280h50v-190h53v127h50v-127h60v190h50v-200q0-14-13-27t-27-13H388.5q-14 0-27 13t-13 27z"/></svg>`;
  const ICON_HTML = `<svg viewBox="0 -960 960 960" fill="currentColor"><path d="M220-80q-24 0-42-18t-18-42v-680q0-24 18-42t42-18h361l219 219v521q0 24-18 42t-42 18H220Zm331-554v-186H220v680h520v-494H551ZM220-820v186-186 680-680Z"/><path d="m398.5-275.98-122.24-122.25 123.26-123.26 21.9 21.9-101.36 101.36 100.34 100.34zm161.97 1.02-21.9-21.9 101.36-101.36-100.34-100.34 21.9-21.9 122.24 122.24z"/></svg>`;
  // Material "description" doc icon (lines inside a document). TXT uses
  // the black variant (no letter overlay); DOCX/ODT/PDF fill the doc shape
  // grey and put a big bold brand-coloured letter on top - same family as
  // the popup buttons.
  const DOC_PATH = `M320-460h320v-60H320v60Zm0 120h320v-60H320v60Zm0 120h200v-60H320v60ZM220-80q-24 0-42-18t-18-42v-680q0-24 18-42t42-18h361l219 219v521q0 24-18 42t-42 18H220Zm331-554v-186H220v680h520v-494H551ZM220-820v186-186 680-680Z`;
  // Image / picture frame (rectangle with a sun + mountain) - for the
  // "Image (.png)" export entry.
  const ICON_IMG  = `<svg data-icon="lucide:image" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`;
  const docIcon = (letter, color) => `<svg viewBox="0 -960 960 960"><path fill="#9ca3af" d="${DOC_PATH}"/><text x="480" y="-265" text-anchor="middle" font-family="system-ui, sans-serif" font-size="720" font-weight="800" fill="${color}">${letter}</text></svg>`;
  const ICON_TXT  = `<svg viewBox="0 -960 960 960"><path fill="#000" d="${DOC_PATH}"/></svg>`;
  const ICON_DOC  = docIcon("W", "#2B579A");
  const ICON_ODT  = docIcon("O", "#000");
  const ICON_PDF  = docIcon("P", "#B30B00");
  // Cloud uploads - Material outlined cloud filled grey, big bold brand
  // letter on top. Nextcloud uses the official three-circle logo instead.
  const CLOUD_PATH = `M251-160q-88 0-149.5-61.5T40-371q0-78 50-137t127-71q20-97 94-158.5T482-799q112 0 189 81.5T748-522v24q72-2 122 46.5T920-329q0 69-50 119t-119 50H251Zm0-60h500q45 0 77-32t32-77q0-45-32-77t-77-32h-63v-84q0-91-61-154t-149-63q-88 0-149.5 63T267-522h-19q-62 0-105 43.5T100-371q0 63 44 107t107 44Zm229-260Z`;
  const cloudIcon = (letter, color) => `<svg viewBox="0 -960 960 960"><path fill="#9ca3af" d="${CLOUD_PATH}"/><text x="480" y="-265" text-anchor="middle" font-family="system-ui, sans-serif" font-size="720" font-weight="800" fill="${color}">${letter}</text></svg>`;
  const ICON_GDOC      = cloudIcon("G", "#4285F4");
  const ICON_MSWORD    = cloudIcon("W", "#2B579A");
  const ICON_ONENOTE   = cloudIcon("O", "#80397B");
  const ICON_NOTION    = cloudIcon("N", "#000000");
  const ICON_NEXTCLOUD = `<svg data-icon="yaiol:nextcloud" viewBox="15 10 120 120"><path fill="#0082C9" d="M 75.091,47.685 C 62.653,47.685 52.11,56.118 48.843,67.542 46.003,61.482 39.849,57.237 32.761,57.237 23.013,57.237 15,65.25 15,74.998 c 0,9.748 8.013,17.765 17.761,17.765 7.088,0 13.242,-4.248 16.082,-10.309 3.268,11.426 13.81,19.861 26.248,19.861 12.346,0 22.835,-8.308 26.186,-19.605 2.892,5.924 8.97,10.053 15.958,10.053 9.748,0 17.765,-8.017 17.765,-17.765 0,-9.748 -8.017,-17.761 -17.765,-17.761 -6.988,0 -13.065,4.127 -15.958,10.05 C 97.925,55.991 87.437,47.686 75.091,47.686 v 0 z m 0,10.425 c 9.39,0 16.89,7.497 16.89,16.887 0,9.39 -7.501,16.89 -16.89,16.89 -9.389,0 -16.887,-7.501 -16.887,-16.89 0,-9.389 7.497,-16.887 16.887,-16.887 z m -42.329,9.553 c 4.114,0 7.338,3.221 7.338,7.335 0,4.114 -3.225,7.338 -7.338,7.338 -4.113,0 -7.335,-3.225 -7.335,-7.338 0,-4.113 3.221,-7.335 7.335,-7.335 z m 84.472,0 c 4.114,0 7.338,3.221 7.338,7.335 0,4.114 -3.225,7.338 -7.338,7.338 -4.113,0 -7.335,-3.225 -7.335,-7.338 0,-4.113 3.221,-7.335 7.335,-7.335 z"/></svg>`;
  // Copy-to-clipboard glyphs - two overlapping rectangles with the format
  // letterform inside the top rect, matching the popup's "Copy as MD" /
  // "Copy as HTML" buttons. Used by the inline per-message copy buttons.
  const ICON_COPY_MD   = `<svg data-icon="yaiol:copy-markdown" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/><path d="M12.025 18.025h1.25v-4.75H14.6v3.175h1.25v-3.175h1.5v4.75h1.25v-5q0-.35-.325-.675T17.6 12.025h-4.575q-.35 0-.675.325t-.325.675z" fill="currentColor" stroke="none"/></svg>`;
  const ICON_COPY_HTML = `<svg data-icon="yaiol:copy-html" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/><path d="m12.99 18.114-3.056-3.056 3.082-3.082.547.548-2.534 2.534 2.509 2.509zm4.049.025-.547-.547 2.534-2.534-2.509-2.509.548-.547 3.056 3.056z" fill="currentColor" stroke="none"/></svg>`;

  function makeButton(title, icon) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "adx-btn";
    b.title = title;
    b.setAttribute("aria-label", title);
    b.innerHTML = icon || ICON_DOWNLOAD;
    return b;
  }

  // Single-click copy of the message's markdown to the system clipboard.
  // Honors the user's Show Thinking setting so what gets copied matches what
  // would be exported from the smart view with the same toggle state.
  async function copyAsMarkdown(adapter, msgEl, btn) {
    try {
      const one = await adapter.extractOne?.(msgEl);
      if (!one) throw new Error("Empty message");
      if (NS.resolveBlobUrls) one.markdown = await NS.resolveBlobUrls(one.markdown);
      const showThinking = NS.getHtmlShowThinking ? await NS.getHtmlShowThinking() : true;
      const md = (showThinking || !NS.stripThinking) ? one.markdown : NS.stripThinking(one.markdown);
      await navigator.clipboard.writeText(md);
      flash(btn, "adx-ok", "Copy as Markdown");
    } catch (err) {
      console.warn(NS.TAG, err);
      btn.title = String(err.message || err);
      flash(btn, "adx-err", "Copy as Markdown");
    }
  }

  // Single-click copy of the message rendered as HTML - writes a
  // ClipboardItem carrying both text/html (for rich-paste targets like
  // Gmail / Docs / Notion / Slack) and a stripped text/plain fallback.
  // Reuses the standard HTML render so the result looks like the file
  // export's <body> (fonts, role badges, lists, tables all carry over).
  async function copyAsHtml(adapter, msgEl, btn) {
    try {
      const one = await adapter.extractOne?.(msgEl);
      if (!one) throw new Error("Empty message");
      if (NS.resolveBlobUrls) one.markdown = await NS.resolveBlobUrls(one.markdown);
      const showThinking = NS.getHtmlShowThinking ? await NS.getHtmlShowThinking() : true;
      if (!showThinking && NS.stripThinking) one.markdown = NS.stripThinking(one.markdown);
      const adapterTitle = adapter.title();
      const convo = {
        title: one.title || (adapterTitle + " - " + one.role),
        url: location.href,
        site: adapter.id,
        messages: [one],
      };
      // `bare` — one message pasted into a mail or a doc should be that
      // message, not a header announcing its title, its source and its role.
      const out = await NS.renderConvo(convo, "html", { bare: true });
      const html = out.content || "";
      // Plain-text fallback - strip tags + decode the most common entities so
      // pasting into a plain-text target lands as readable prose, not HTML
      // source.
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
      flash(btn, "adx-ok", "Copy as HTML");
    } catch (err) {
      console.warn(NS.TAG, err);
      btn.title = String(err.message || err);
      flash(btn, "adx-err", "Copy as HTML");
    }
  }

  // Single shared menu: hover the button to open, hover the menu to keep it,
  // leave both for HIDE_DELAY to close. Keeps ESC and click-outside as fallbacks.
  let openMenu = null;
  let openAnchor = null;
  let hideTimer = null;
  const HIDE_DELAY = 220;

  function cancelHide() { if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; } }
  function scheduleHide() { cancelHide(); hideTimer = setTimeout(closeMenu, HIDE_DELAY); }

  function closeMenu() {
    cancelHide();
    if (openMenu) { openMenu.remove(); openMenu = null; }
    openAnchor = null;
    document.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("scroll", closeMenu, true);
    window.removeEventListener("resize", closeMenu);
  }
  function onKeyDown(e) { if (e.key === "Escape") closeMenu(); }

  function showMenu(anchor, items) {
    cancelHide();
    if (openAnchor === anchor && openMenu) return; // already showing for this anchor
    closeMenu();

    const menu = document.createElement("div");
    menu.className = "adx-menu";
    menu.innerHTML = `<div class="adx-menu-title">Export this message</div>`;
    for (const it of items) {
      const b = document.createElement("button");
      b.type = "button";
      b.innerHTML = `<span class="adx-menu-icon">${it.icon}</span><span>${it.label}</span>`;
      b.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        closeMenu();
        it.onSelect();
      });
      menu.appendChild(b);
    }
    menu.addEventListener("mouseenter", cancelHide);
    menu.addEventListener("mouseleave", scheduleHide);
    document.body.appendChild(menu);

    // Position near the anchor
    const r = anchor.getBoundingClientRect();
    const mw = menu.offsetWidth;
    const mh = menu.offsetHeight;
    let left = r.left;
    let top = r.bottom + 4;
    if (left + mw > window.innerWidth - 8) left = window.innerWidth - mw - 8;
    if (top + mh > window.innerHeight - 8) top = r.top - mh - 4;
    menu.style.left = `${Math.max(8, left)}px`;
    menu.style.top = `${Math.max(8, top)}px`;

    openMenu = menu;
    openAnchor = anchor;
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("scroll", closeMenu, true);
    window.addEventListener("resize", closeMenu);
  }

  function flash(btn, cls, revertTitle) {
    btn.classList.add(cls);
    setTimeout(() => { btn.classList.remove(cls); btn.title = revertTitle; }, 1500);
  }

  async function download(filename, content, mime = "text/markdown", base64 = false) {
    // Goes through NS.downloadFile (lib/download.js). Content scripts don't
    // have chrome.downloads access, so the helper falls back to an <a download>
    // click against the host page document.
    const res = await NS.downloadFile({ filename, content, mime, base64 });
    if (!res?.ok) throw new Error(res?.error || "Download failed");
  }

  async function exportMessage(adapter, msgEl, btn, format) {
    try {
      // Image is a live screen capture of just this message - bypasses
      // the convo / renderConvo pipeline entirely.
      if (format === "image") {
        if (!NS.toImageOne) throw new Error("Image exporter not loaded");
        const out = await NS.toImageOne(msgEl);
        const adapterTitle = adapter.title();
        const filename = (NS.safeFilename?.(adapterTitle + " - message") || "message") + ".png";
        const dl = await NS.downloadFile({
          filename, content: out.base64, mime: "image/png", base64: true,
        });
        if (!dl?.ok) throw new Error(dl?.error || "Download failed");
        flash(btn, "adx-ok", "Export message");
        return;
      }

      const one = await adapter.extractOne?.(msgEl);
      if (!one) throw new Error("Empty message");
      if (NS.resolveBlobUrls) one.markdown = await NS.resolveBlobUrls(one.markdown);

      const showThinking = NS.getHtmlShowThinking ? await NS.getHtmlShowThinking() : true;
      if (!showThinking && NS.stripThinking) one.markdown = NS.stripThinking(one.markdown);

      // Build a one-message convo whose "title" embeds the role so the
      // resulting filename comes out as "<chat title> - user.md" etc.
      // This routes through NS.renderConvo, the same format dispatch the
      // popup and selection page use - single source of truth.
      //
      // An adapter may set `one.title` to override the default filename
      // (used by NotebookLM Studio so a note exports as its own title,
      // not "<notebook> - assistant.md").
      const convo = {
        title: one.title || (adapter.title() + " - " + one.role),
        url: location.href,
        site: adapter.id,
        messages: [one],
      };
      const out = await NS.renderConvo(convo, format);

      if (out.openPrintTab) {
        const res = await chrome.runtime.sendMessage({ type: "adx:open-print-tab", content: out.content });
        if (!res?.ok) throw new Error(res?.error || "Could not open print tab");
        flash(btn, "adx-ok", "Export message");
        return;
      }
      if (out.uploadGdoc) {
        const res = await chrome.runtime.sendMessage({
          type: "adx:upload-gdoc", title: out.filename, html: out.content,
        });
        if (!res?.ok) throw new Error(res?.error || "Google Docs upload failed");
        flash(btn, "adx-ok", "Export message");
        return;
      }
      if (out.uploadMsword) {
        const res = await chrome.runtime.sendMessage({
          type: "adx:upload-msword",
          filename: out.filename, contentBase64: out.content, mime: out.mime,
        });
        if (!res?.ok) throw new Error(res?.error || "Word Online upload failed");
        flash(btn, "adx-ok", "Export message");
        return;
      }
      if (out.uploadNotion) {
        const res = await chrome.runtime.sendMessage({
          type: "adx:notion-create-page",
          parent: out.parent, properties: out.properties,
          children: out.children, extras: out.extras,
        });
        if (!res?.ok) throw new Error(res?.error || "Notion upload failed");
        flash(btn, "adx-ok", "Export message");
        return;
      }
      if (out.uploadOnenote) {
        const res = await chrome.runtime.sendMessage({
          type: "adx:upload-onenote",
          title: out.filename, html: out.content,
        });
        if (!res?.ok) throw new Error(res?.error || "OneNote upload failed");
        flash(btn, "adx-ok", "Export message");
        return;
      }
      if (out.uploadNextcloud) {
        const res = await chrome.runtime.sendMessage({
          type: "adx:upload-nextcloud",
          filename: out.filename, contentBase64: out.content, mime: out.mime,
        });
        if (!res?.ok) throw new Error(res?.error || "Nextcloud upload failed");
        flash(btn, "adx-ok", "Export message");
        return;
      }
      await download(out.filename, out.content, out.mime, out.base64);
      flash(btn, "adx-ok", "Export message");
    } catch (err) {
      console.warn(NS.TAG, err);
      btn.title = String(err.message || err);
      flash(btn, "adx-err", "Export message");
    }
  }

  // Cached visibility settings - refreshed on init and whenever the
  // options page broadcasts `adx:inline-settings-changed`. Reading
  // chrome.storage on every inject() pass would be wasteful since
  // MutationObserver fires constantly on a live chat page.
  let inlineSettings = { exportMenu: true, copyMd: true, copyHtml: true };
  async function reloadInlineSettings() {
    try {
      inlineSettings = {
        exportMenu: NS.getInlineExportMenu ? await NS.getInlineExportMenu() : true,
        copyMd:     NS.getInlineCopyMd     ? await NS.getInlineCopyMd()     : true,
        copyHtml:   NS.getInlineCopyHtml   ? await NS.getInlineCopyHtml()   : true,
      };
    } catch {}
  }

  // Remove any inline buttons we previously injected. Called when the user
  // toggles visibility off (or before re-injecting after a settings flip).
  function clearInlineButtons() {
    document.querySelectorAll(".adx-btn").forEach(el => el.remove());
  }

  function mountInlineButtons(adapter) {
    if (!adapter.findMountPoints) return;
    const inject = () => {
      // Nothing to render if all three toggles are off.
      if (!inlineSettings.exportMenu && !inlineSettings.copyMd && !inlineSettings.copyHtml) return;

      for (const { bar, msg } of adapter.findMountPoints()) {
        // Use button presence (not a data-flag) so we re-inject if React or
        // a similar framework removes our buttons on its next render cycle.
        if (bar.querySelector(":scope > .adx-btn")) continue;

        // Build the buttons honouring the three visibility toggles. We
        // insert each one at the bar's front edge in reverse visual order
        // so the final layout reads, left → right:
        //   [export-menu] [copy-md] [copy-html] (original native buttons)
        const nodes = [];

        if (inlineSettings.exportMenu) {
          const btn = makeButton("Export message");
          const ICON_JSON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5a2 2 0 0 0 2 2h1"/><path d="M16 3h1a2 2 0 0 1 2 2v5a2 2 0 0 0 2 2 2 2 0 0 0-2 2v5a2 2 0 0 1-2 2h-1"/></svg>`;
          const items = [
            { label: "Markdown (.md)",    icon: ICON_MD,   onSelect: () => exportMessage(adapter, msg, btn, "markdown") },
            { label: "HTML (.html)",      icon: ICON_HTML, onSelect: () => exportMessage(adapter, msg, btn, "html") },
            { label: "Plain text (.txt)", icon: ICON_TXT,  onSelect: () => exportMessage(adapter, msg, btn, "text") },
            { label: "JSON (.json)",      icon: ICON_JSON, onSelect: () => exportMessage(adapter, msg, btn, "json") },
            { label: "Word (.docx)",      icon: ICON_DOC,  onSelect: () => exportMessage(adapter, msg, btn, "docx") },
            { label: "OpenDocument (.odt)", icon: ICON_ODT, onSelect: () => exportMessage(adapter, msg, btn, "odt") },
            { label: "PDF (via print)",   icon: ICON_PDF,  onSelect: () => exportMessage(adapter, msg, btn, "pdf") },
            { label: "Image (.png)",      icon: ICON_IMG,  onSelect: () => exportMessage(adapter, msg, btn, "image") },
            { label: "Google Docs",       icon: ICON_GDOC,      onSelect: () => exportMessage(adapter, msg, btn, "gdoc") },
            { label: "Word Online",       icon: ICON_MSWORD,    onSelect: () => exportMessage(adapter, msg, btn, "msword") },
            { label: "OneNote",           icon: ICON_ONENOTE,   onSelect: () => exportMessage(adapter, msg, btn, "onenote") },
            { label: "Notion",            icon: ICON_NOTION,    onSelect: () => exportMessage(adapter, msg, btn, "notion") },
            { label: "Nextcloud",         icon: ICON_NEXTCLOUD, onSelect: () => exportMessage(adapter, msg, btn, "nextcloud") }
          ];
          btn.addEventListener("mouseenter", () => showMenu(btn, items));
          btn.addEventListener("mouseleave", scheduleHide);
          btn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation?.();
            showMenu(btn, items);
          }, true);
          nodes.push(btn);
        }

        if (inlineSettings.copyMd) {
          const copyMdBtn = makeButton("Copy as Markdown", ICON_COPY_MD);
          copyMdBtn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation?.();
            copyAsMarkdown(adapter, msg, copyMdBtn);
          }, true);
          nodes.push(copyMdBtn);
        }

        if (inlineSettings.copyHtml) {
          const copyHtmlBtn = makeButton("Copy as HTML", ICON_COPY_HTML);
          copyHtmlBtn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation?.();
            copyAsHtml(adapter, msg, copyHtmlBtn);
          }, true);
          nodes.push(copyHtmlBtn);
        }

        // Insert each in reverse order at the bar's start so they appear
        // left → right in declaration order above.
        for (let i = nodes.length - 1; i >= 0; i--) bar.insertBefore(nodes[i], bar.firstChild);
      }
    };
    // Expose for the settings-change listener so we can wipe + re-inject
    // without waiting for the next MutationObserver tick.
    mountInlineButtons._inject = inject;
    inject();
    const obs = new MutationObserver(() => {
      clearTimeout(mountInlineButtons._t);
      mountInlineButtons._t = setTimeout(inject, 200);
    });
    obs.observe(document.body, { childList: true, subtree: true });
    mountInlineButtons._obs = obs;
  }

  // Tear down a previous mount before adopting another adapter (an SPA that
  // swaps surfaces, e.g. Google's Tous ↔ Mode IA) — otherwise the old
  // observer keeps re-injecting buttons wired to the wrong adapter.
  mountInlineButtons.dispose = function dispose() {
    mountInlineButtons._obs?.disconnect();
    mountInlineButtons._obs = null;
    clearTimeout(mountInlineButtons._t);
    mountInlineButtons._inject = null;
    clearInlineButtons();
  };

  // Full-conversation export (from popup) - supports markdown, html, txt, doc
  const EXPORT_TYPES = {
    "adx:export-markdown": "markdown",
    "adx:export-debug":    "debug",
    "adx:export-json":     "json",
    "adx:export-html":     "html",
    "adx:export-text":     "text",
    "adx:export-docx":     "docx",
    "adx:export-odt":      "odt",
    "adx:export-pdf":      "pdf",
    "adx:export-image":    "image",
    "adx:export-gdoc":     "gdoc",
    "adx:export-msword":   "msword",
    "adx:export-notion":   "notion",
    "adx:export-nextcloud":"nextcloud",
    "adx:export-onenote":  "onenote"
  };

  // wrapForPrint + the format dispatch live in lib/export-flow.js so the
  // selection page (select.html) can reuse them.

  async function extractConvo(adapter) {
    const convo = await adapter.extract();
    // Resolve blob: URLs in each message so images render everywhere.
    //
    // ⚠ An adapter can opt OUT with `inlineImages: false`, and Gemini's /library
    // does. Inlining rewrites every image as a base64 data URI, which is right
    // for a chat (a saved file stays viewable offline) and catastrophic for a
    // gallery: 226 library originals at 1280x720 came to tens of MB, which the
    // popup could not pass in a message or stash, so the media page never
    // opened at all. Opting out keeps the URLs; the media page resolves each
    // image through the background fetch when it actually needs the bytes.
    if (convo.inlineImages !== false && NS.resolveBlobUrls) {
      await Promise.all(convo.messages.map(async (m) => {
        m.markdown = await NS.resolveBlobUrls(m.markdown);
      }));
    }
    return convo;
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    // ── adx:inline-settings-changed - refresh cached toggles + re-mount ──
    // Sent by the options page when the user flips any of the three
    // "in-chat buttons" checkboxes. We re-read the settings, wipe the
    // currently injected buttons, and re-inject in one tick so the
    // change is visible without a page reload.
    if (msg?.type === "adx:inline-settings-changed") {
      (async () => {
        await reloadInlineSettings();
        clearInlineButtons();
        mountInlineButtons._inject?.();
        sendResponse({ ok: true });
      })();
      return true;
    }

    // ── adx:extract-only - return canonical convo for the selection page ──
    if (msg?.type === "adx:extract-only") {
      (async () => {
        try {
          const adapter = NS.getAdapter();
          if (!adapter) { sendResponse({ ok: false, error: "No adapter for this site." }); return; }
          const convo = await extractConvo(adapter);
          if (!convo.messages.length) { sendResponse({ ok: false, error: "No messages found." }); return; }
          sendResponse({ ok: true, convo, site: adapter.label });
        } catch (err) {
          sendResponse({ ok: false, error: String(err?.message || err) });
        }
      })();
      return true;
    }

    // ── adx:export-* - extract + render in one round-trip (popup path) ────
    const format = EXPORT_TYPES[msg?.type];
    if (!format) return;
    (async () => {
      try {
        const adapter = NS.getAdapter();
        if (!adapter) { sendResponse({ ok: false, error: "No adapter for this site." }); return; }
        // Debug bundle: three-stage diagnostic (raw API bytes -> canonical
        // convo -> rendered outputs); stage diffs localize a bug (raw!=convo:
        // adapter; convo!=output: exporter). DOM-only sites have no fetches,
        // so the live page HTML ships as their raw stage instead.
        // ⚠ CLAUDE: the debug export must SURVIVE a failed or EMPTY extraction
        // — that is exactly when the bundle matters most (tuning a new site's
        // adapter from its captures/page_html). Only regular formats refuse.
        if (format === "debug") {
          NS.debug?.reset();
          let convo = null, extractError = null;
          try { convo = await extractConvo(adapter); } catch (e) { extractError = String(e?.message || e); }
          const hasMsgs = !!(convo && convo.messages && convo.messages.length);
          const bundle = {
            schema: "ai-chat-extractor/debug-bundle@1",
            site: adapter.id,
            title: (convo && convo.title) || document.title,
            url: location.href,
            exported_at: new Date().toISOString(),
            extension_version: chrome.runtime.getManifest().version,
            captures: NS.debug ? NS.debug.captures() : [],
            convo,
            outputs: hasMsgs ? { markdown: NS.toMarkdown(convo), json: JSON.parse(NS.toJson(convo)) } : null,
          };
          if (extractError) bundle.extract_error = extractError;
          if (!bundle.captures.length || NS.debug?.domUsed) bundle.page_html = document.documentElement.outerHTML;
          const baseName = hasMsgs ? await NS.expandFilename(convo) : NS.safeFilename(bundle.title);
          sendResponse({
            ok: true, content: JSON.stringify(bundle, null, 2),
            filename: baseName + "-debug.json", mime: "application/json",
            site: adapter.label, count: hasMsgs ? convo.messages.length : 0,
          });
          return;
        }
        const convo = await extractConvo(adapter);
        if (!convo.messages.length) { sendResponse({ ok: false, error: "No messages found." }); return; }
        const out = await NS.renderConvo(convo, format);
        sendResponse({ ok: true, ...out, site: adapter.label, count: convo.messages.length });
      } catch (err) {
        sendResponse({ ok: false, error: String(err?.message || err) });
      }
    })();
    return true;
  });

  // ⚠ CLAUDE: the adapter CANNOT be resolved once at document_idle. Google is
  // the proof, and it cost the whole "AI Mode has no inline buttons" hunt:
  // both google-* adapters match on page CONTENT, not just the host — the AI
  // Overview streams in after idle, and the "Mode IA" tab is an SPA swap that
  // never re-runs the content script. So the page ends up in AI Mode with
  // `getAdapter()` having answered `null` seconds earlier, and no amount of
  // findMountPoints() in the adapter can help. Re-resolve until one matches,
  // and re-init when the surface changes underneath us (Tous ↔ Mode IA).
  let current = null;
  let lastUrl = location.href;

  function resolveAdapter() {
    const next = NS.getAdapter();
    if (next === current) return;
    mountInlineButtons.dispose();
    current = next;
    // Load the persisted visibility toggles BEFORE the first inject so
    // we don't briefly flash buttons the user has hidden.
    if (next) reloadInlineSettings().then(() => mountInlineButtons(next));
  }

  resolveAdapter();
  setInterval(() => {
    if (location.href !== lastUrl) { lastUrl = location.href; current = null; mountInlineButtons.dispose(); }
    resolveAdapter();
  }, 1000);
})();
