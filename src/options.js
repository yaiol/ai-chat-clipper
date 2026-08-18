// settings page logic.
// Two pages, switched via the left-side nav:
//   - General  → language picker (chrome.storage.local: adx_lang)
//   - AI Sites → visibility + drag-sort (chrome.storage.local: adx_hidden_sites,
//                                                              adx_site_order)
// All settings auto-save on change.

(async () => {
  const i18n = AiDoc.i18n;
  await i18n.init();
  i18n.applyDom();

  const notice = document.getElementById("notice");
  let noticeTimer = 0;
  function flashNotice() {
    notice.textContent = i18n.t("optionsSavedNotice");
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => { notice.textContent = ""; }, 1800);
  }

  // ── Tab nav ──────────────────────────────────────────────────────────
  // Active tab is reflected in the URL hash so reloads / bookmarks land on
  // the same page the user was viewing.
  const navButtons = Array.from(document.querySelectorAll(".nav button[data-page]"));
  const pages = {
    general:   document.getElementById("page-general"),
    style:     document.getElementById("page-style"),
    sites:     document.getElementById("page-sites"),
    notion:    document.getElementById("page-notion"),
    microsoft: document.getElementById("page-microsoft"),
    nextcloud: document.getElementById("page-nextcloud"),
  };
  function showPage(name) {
    if (!pages[name]) name = "general";
    for (const btn of navButtons) btn.classList.toggle("active", btn.dataset.page === name);
    for (const [key, el] of Object.entries(pages)) el.classList.toggle("active", key === name);
    if (location.hash.slice(1) !== name) {
      // Preserve scroll position while updating the hash.
      history.replaceState(null, "", "#" + name);
    }
  }
  for (const btn of navButtons) {
    btn.addEventListener("click", () => showPage(btn.dataset.page));
  }
  showPage((location.hash.slice(1) || "general").trim());

  // ── Language picker ──────────────────────────────────────────────────
  const langSelect = document.getElementById("lang");

  const auto = document.createElement("option");
  auto.value = "auto";
  auto.textContent = i18n.t("optionsLanguageAuto");
  langSelect.appendChild(auto);

  for (const code of i18n.SUPPORTED) {
    const opt = document.createElement("option");
    opt.value = code;
    opt.textContent = i18n.NAMES[code] || code;
    langSelect.appendChild(opt);
  }

  // Show the user's stored choice (not the resolved language) so the dropdown
  // round-trips faithfully - picking "auto" today and reopening tomorrow still
  // shows "auto", not the auto-resolved language.
  const storedLang = await i18n.getStored();
  langSelect.value = i18n.SUPPORTED.includes(storedLang) || storedLang === "auto" ? storedLang : "auto";

  langSelect.addEventListener("change", async () => {
    await i18n.setLang(langSelect.value);

    // Re-init this page in the new language so all translated text and the
    // "auto" label flip immediately, then refresh the labels we rendered
    // dynamically above.
    await i18n.init();
    i18n.applyDom();
    auto.textContent = i18n.t("optionsLanguageAuto");
    refreshFontDropdownLabels();
    flashNotice();
  });

  // ── HTML export font pickers ─────────────────────────────────────────
  const titleSelect = document.getElementById("title-font");
  const textSelect  = document.getElementById("text-font");

  function fillFontSelect(selectEl) {
    selectEl.innerHTML = "";
    for (const f of AiDoc.FONTS) {
      const opt = document.createElement("option");
      opt.value = f.key;
      // The "system" entry uses a translated label; named fonts (Inter, Lora,
      // …) keep their proper names in every language.
      opt.textContent = f.key === "system" ? i18n.t("optionsFontSystem") : f.label;
      selectEl.appendChild(opt);
    }
  }
  function refreshFontDropdownLabels() {
    // Translate just the "System (default)" entries; keep the user's choice.
    for (const sel of [titleSelect, textSelect]) {
      const sys = sel.querySelector('option[value="system"]');
      if (sys) sys.textContent = i18n.t("optionsFontSystem");
    }
  }

  fillFontSelect(titleSelect);
  fillFontSelect(textSelect);

  const fonts = await AiDoc.getHtmlFonts();
  titleSelect.value = fonts.title.key;
  textSelect.value  = fonts.text.key;

  // ── Live chat preview ─────────────────────────────────────────────────
  // Single fake-chat block reflects every General-page setting: fonts,
  // body size, show-time, show-source, show-thinking. Google fonts load
  // on demand (only once per family).
  const previewEl    = document.getElementById("chat-preview");
  const cpSourceEl   = previewEl.querySelector(".cp-source");
  const cpTimeEls    = previewEl.querySelectorAll(".cp-time");
  const cpThinkingEl = previewEl.querySelector(".cp-thinking");
  const loadedFontFamilies = new Set();
  function ensureFontLoaded(font) {
    if (!font || !font.googleFamily || loadedFontFamilies.has(font.googleFamily)) return;
    loadedFontFamilies.add(font.googleFamily);
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?family="
      + encodeURIComponent(font.googleFamily)
      + ":wght@400;500;600;700&display=swap";
    document.head.appendChild(link);
  }
  function renderPreview() {
    const titleFont = AiDoc.FONTS.find(f => f.key === titleSelect.value) || AiDoc.FONTS[0];
    const textFont  = AiDoc.FONTS.find(f => f.key === textSelect.value)  || AiDoc.FONTS[0];
    ensureFontLoaded(titleFont);
    ensureFontLoaded(textFont);
    previewEl.style.setProperty("--cp-title-font", titleFont.stack);
    previewEl.style.setProperty("--cp-text-font",  textFont.stack);
    previewEl.dataset.size = sizeSelectOpt.value || "medium";
    cpSourceEl.style.display   = showSourceToggle.checked   ? "" : "none";
    cpThinkingEl.style.display = showThinkingToggle.checked ? "" : "none";
    for (const t of cpTimeEls) t.style.display = showTimeToggle.checked ? "" : "none";
  }

  titleSelect.addEventListener("change", async () => {
    await AiDoc.setHtmlFont("title", titleSelect.value);
    renderPreview();
    flashNotice();
  });
  textSelect.addEventListener("change", async () => {
    await AiDoc.setHtmlFont("text", textSelect.value);
    renderPreview();
    flashNotice();
  });

  // ── Body text size ───────────────────────────────────────────────────
  // Same FONT_SIZES catalog the smart-view toolbar uses; same i18n keys.
  const SIZE_LABEL_KEYS = {
    small:  "selectFontSizeSmall",
    medium: "selectFontSizeMedium",
    large:  "selectFontSizeLarge",
  };
  const sizeSelectOpt = document.getElementById("size-select-opt");
  for (const s of AiDoc.FONT_SIZES) {
    const opt = document.createElement("option");
    opt.value = s.key;
    opt.textContent = i18n.t(SIZE_LABEL_KEYS[s.key]);
    sizeSelectOpt.appendChild(opt);
  }
  sizeSelectOpt.value = (await AiDoc.getHtmlFontSize()).key;
  sizeSelectOpt.addEventListener("change", async () => {
    await AiDoc.setHtmlFontSize(sizeSelectOpt.value);
    renderPreview();
    flashNotice();
  });

  // ── Show chat time toggle ────────────────────────────────────────────
  const showTimeToggle = document.getElementById("show-time-toggle");
  showTimeToggle.checked = await AiDoc.getHtmlShowTime();
  showTimeToggle.addEventListener("change", async () => {
    await AiDoc.setHtmlShowTime(showTimeToggle.checked);
    renderPreview();
    flashNotice();
  });

  // ── Show source link toggle ──────────────────────────────────────────
  const showSourceToggle = document.getElementById("show-source-toggle");
  showSourceToggle.checked = await AiDoc.getHtmlShowSource();
  showSourceToggle.addEventListener("change", async () => {
    await AiDoc.setHtmlShowSource(showSourceToggle.checked);
    renderPreview();
    flashNotice();
  });

  // ── Show thinking toggle ─────────────────────────────────────────────
  const showThinkingToggle = document.getElementById("show-thinking-toggle");
  showThinkingToggle.checked = await AiDoc.getHtmlShowThinking();
  showThinkingToggle.addEventListener("change", async () => {
    await AiDoc.setHtmlShowThinking(showThinkingToggle.checked);
    renderPreview();
    flashNotice();
  });

  // First paint - all controls are initialized at this point.
  renderPreview();

  // ── Math rendering toggle ────────────────────────────────────────────
  const mathToggle = document.getElementById("math-toggle");
  mathToggle.checked = await AiDoc.getHtmlMath();
  mathToggle.addEventListener("change", async () => {
    await AiDoc.setHtmlMath(mathToggle.checked);
    flashNotice();
  });

  // ── Developer mode toggle - reveals the popup's Debug-bundle export ──
  const devToggle = document.getElementById("dev-mode-toggle");
  devToggle.checked = await AiDoc.getDevMode();
  devToggle.addEventListener("change", async () => {
    await AiDoc.setDevMode(devToggle.checked);
    flashNotice();
  });

  // ── Filename pattern ─────────────────────────────────────────────────
  // Saves on blur (or Enter). An empty value resets to the default pattern.
  const filenameInput = document.getElementById("filename-pattern");
  filenameInput.value = await AiDoc.getFilenamePattern();
  async function commitFilename() {
    const v = filenameInput.value.trim();
    await AiDoc.setFilenamePattern(v);
    // Re-read to pick up the default fallback when v was empty.
    filenameInput.value = await AiDoc.getFilenamePattern();
    flashNotice();
  }
  filenameInput.addEventListener("change", commitFilename);

  // ── Inline-button visibility ──────────────────────────────────────────
  // Three per-message toggles. Changes notify any open AI-site tabs via
  // chrome.tabs.sendMessage so content scripts re-render their inline
  // buttons immediately rather than requiring a page reload.
  async function broadcastInlineSettings() {
    try {
      const tabs = await chrome.tabs.query({});
      for (const t of tabs) {
        if (!t.id) continue;
        chrome.tabs.sendMessage(t.id, { type: "adx:inline-settings-changed" }).catch(() => {});
      }
    } catch {}
  }
  function wireInlineToggle(id, getter, setter) {
    const el = document.getElementById(id);
    getter().then(v => { el.checked = v; });
    el.addEventListener("change", async () => {
      await setter(el.checked);
      await broadcastInlineSettings();
      flashNotice();
    });
  }
  wireInlineToggle("inline-export-toggle",   AiDoc.getInlineExportMenu, AiDoc.setInlineExportMenu);
  wireInlineToggle("inline-copy-md-toggle",  AiDoc.getInlineCopyMd,     AiDoc.setInlineCopyMd);
  wireInlineToggle("inline-copy-html-toggle",AiDoc.getInlineCopyHtml,   AiDoc.setInlineCopyHtml);
  filenameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); commitFilename(); }
  });

  // ── Visible sites checklist (drag-sortable) ──────────────────────────
  const sitesEl = document.getElementById("sites-check");
  const SITES = AiDoc.SITES;
  const byId = new Map(SITES.map(s => [s.id, s]));
  const hidden = new Set(await AiDoc.getHidden() || []);

  // Resolve the user's saved order; append any new sites (forward-compat
  // when adapters are added in a later release).
  function resolveOrderedSites(savedOrder) {
    const remaining = new Map(byId);
    const ordered = [];
    if (Array.isArray(savedOrder)) {
      for (const id of savedOrder) {
        if (remaining.has(id)) { ordered.push(remaining.get(id)); remaining.delete(id); }
      }
    }
    for (const s of remaining.values()) ordered.push(s);
    return ordered;
  }
  let orderedSites = resolveOrderedSites(await AiDoc.getOrder());

  function makeRow(s) {
    const row = document.createElement("label");
    row.dataset.id = s.id;
    row.draggable = true;
    row.title = s.label;

    // Drag grip - purely visual; the whole row is draggable.
    const grip = document.createElement("span");
    grip.className = "grip";
    grip.setAttribute("aria-hidden", "true");
    grip.textContent = "⋮⋮";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.dataset.id = s.id;
    cb.checked = !hidden.has(s.id);

    const img = document.createElement("img");
    img.src = s.icon;   // bundled brand SVG - every SITES row carries one
    img.alt = "";

    const txt = document.createElement("span");
    txt.className = "txt";
    txt.textContent = s.label;

    row.append(grip, cb, img, txt);
    return row;
  }

  function renderChecklist() {
    sitesEl.innerHTML = "";
    for (const s of orderedSites) sitesEl.appendChild(makeRow(s));
  }
  renderChecklist();

  async function persistHidden() {
    await AiDoc.setHidden([...hidden]);
    flashNotice();
  }

  sitesEl.addEventListener("change", (e) => {
    const cb = e.target.closest('input[type="checkbox"][data-id]');
    if (!cb) return;
    if (cb.checked) hidden.delete(cb.dataset.id);
    else hidden.add(cb.dataset.id);
    persistHidden();
  });

  // Drag-and-drop reorders both the in-memory list and the saved order;
  // the popup will pick the new order up next time it opens.
  AiDoc.enableSiteDnd(sitesEl, "label[data-id]", async (idsInNewOrder) => {
    orderedSites = idsInNewOrder.map(id => byId.get(id)).filter(Boolean);
    await AiDoc.setOrder(idsInNewOrder);
    flashNotice();
  });

  document.getElementById("select-all").addEventListener("click", () => {
    hidden.clear();
    renderChecklist();
    persistHidden();
  });
  document.getElementById("select-none").addEventListener("click", () => {
    for (const s of SITES) hidden.add(s.id);
    renderChecklist();
    persistHidden();
  });

  // ── Notion connection panel ──────────────────────────────────────────
  const notionDisconnectedEl = document.getElementById("notion-disconnected");
  const notionConnectedEl    = document.getElementById("notion-connected");
  const notionWorkspaceEl    = document.getElementById("notion-workspace-name");
  const notionParentSelect   = document.getElementById("notion-parent");
  const notionStatusEl       = document.getElementById("notion-status");
  const notionConnectBtn     = document.getElementById("notion-connect-btn");
  const notionDisconnectBtn  = document.getElementById("notion-disconnect-btn");
  const notionRefreshBtn     = document.getElementById("notion-refresh-btn");

  function setNotionStatus(text, kind) {
    notionStatusEl.textContent = text || "";
    notionStatusEl.style.color = kind === "err" ? "#b00020" : "#0a7a2f";
  }

  async function paintNotionConnected(conn) {
    notionDisconnectedEl.style.display = "none";
    notionConnectedEl.style.display = "block";
    notionWorkspaceEl.textContent = conn.workspace_name || "(unnamed workspace)";
    await populateNotionParents(conn);
  }
  function paintNotionDisconnected() {
    notionDisconnectedEl.style.display = "block";
    notionConnectedEl.style.display = "none";
  }

  async function populateNotionParents(conn) {
    notionParentSelect.innerHTML = `<option>${i18n.t("optionsNotionLoadingPages")}</option>`;
    notionParentSelect.disabled = true;
    try {
      const pages = await AiDoc.notion.listAccessiblePages(conn.access_token);
      notionParentSelect.innerHTML = "";
      if (!pages.length) {
        const opt = document.createElement("option");
        opt.textContent = i18n.t("optionsNotionNoPages");
        opt.disabled = true;
        notionParentSelect.appendChild(opt);
        notionParentSelect.disabled = true;
        return;
      }
      for (const p of pages) {
        const opt = document.createElement("option");
        opt.value = p.id;
        opt.textContent = p.title;
        opt.dataset.title = p.title;
        notionParentSelect.appendChild(opt);
      }
      notionParentSelect.disabled = false;
      // Restore saved selection or default to first.
      const want = conn.parent_page_id;
      if (want && [...notionParentSelect.options].some(o => o.value === want)) {
        notionParentSelect.value = want;
      } else {
        await AiDoc.notion.patchConnection({
          parent_page_id: notionParentSelect.value,
          parent_page_title: notionParentSelect.selectedOptions[0]?.dataset.title || "",
        });
      }
    } catch (err) {
      notionParentSelect.innerHTML = "";
      const opt = document.createElement("option");
      opt.textContent = i18n.t("optionsNotionPagesFailed");
      opt.disabled = true;
      notionParentSelect.appendChild(opt);
      setNotionStatus(String(err?.message || err), "err");
    }
  }

  notionParentSelect.addEventListener("change", async () => {
    const opt = notionParentSelect.selectedOptions[0];
    if (!opt) return;
    await AiDoc.notion.patchConnection({
      parent_page_id: opt.value,
      parent_page_title: opt.dataset.title || opt.textContent,
    });
    flashNotice();
  });

  notionConnectBtn.addEventListener("click", async () => {
    notionConnectBtn.disabled = true;
    setNotionStatus(i18n.t("optionsNotionConnecting"));
    try {
      const conn = await AiDoc.notion.connectInteractive();
      setNotionStatus("");
      await paintNotionConnected(conn);
    } catch (err) {
      setNotionStatus(String(err?.message || err), "err");
    } finally {
      notionConnectBtn.disabled = false;
    }
  });

  notionDisconnectBtn.addEventListener("click", async () => {
    await AiDoc.notion.clearConnection();
    setNotionStatus("");
    paintNotionDisconnected();
  });

  notionRefreshBtn.addEventListener("click", async () => {
    const conn = await AiDoc.notion.getConnection();
    if (conn) await populateNotionParents(conn);
  });

  // Initial paint based on stored state
  const initialConn = await AiDoc.notion.getConnection();
  if (initialConn?.access_token) {
    await paintNotionConnected(initialConn);
  } else {
    paintNotionDisconnected();
  }

  // ── Microsoft 365 connection panel ───────────────────────────────────
  const msDisconnectedEl = document.getElementById("ms-disconnected");
  const msConnectedEl    = document.getElementById("ms-connected");
  const msAccountEl      = document.getElementById("ms-account-name");
  const msStatusEl       = document.getElementById("ms-status");
  const msConnectBtn     = document.getElementById("ms-connect-btn");
  const msDisconnectBtn  = document.getElementById("ms-disconnect-btn");

  function setMsStatus(text, kind) {
    msStatusEl.textContent = text || "";
    msStatusEl.style.color = kind === "err" ? "#b00020" : "#0a7a2f";
  }
  function paintMsConnected(conn) {
    msDisconnectedEl.style.display = "none";
    msConnectedEl.style.display = "block";
    const a = conn.account || {};
    msAccountEl.textContent = a.email || a.name || "(connected)";
  }
  function paintMsDisconnected() {
    msDisconnectedEl.style.display = "block";
    msConnectedEl.style.display = "none";
  }

  msConnectBtn.addEventListener("click", async () => {
    msConnectBtn.disabled = true;
    setMsStatus(i18n.t("optionsMicrosoftConnecting"));
    try {
      const conn = await AiDoc.microsoft.connectInteractive();
      setMsStatus("");
      paintMsConnected(conn);
    } catch (err) {
      setMsStatus(String(err?.message || err), "err");
    } finally {
      msConnectBtn.disabled = false;
    }
  });

  msDisconnectBtn.addEventListener("click", async () => {
    await AiDoc.microsoft.clearConnection();
    setMsStatus("");
    paintMsDisconnected();
  });

  const initialMs = await AiDoc.microsoft.getConnection();
  if (initialMs?.access_token) paintMsConnected(initialMs);
  else paintMsDisconnected();

  // ── Nextcloud connection panel ───────────────────────────────────────
  const ncServerEl   = document.getElementById("nc-server");
  const ncUserEl     = document.getElementById("nc-user");
  const ncPassEl     = document.getElementById("nc-pass");
  const ncFolderEl   = document.getElementById("nc-folder");
  // Placeholder mirrors the live default folder ("/" + app name).
  ncFolderEl.placeholder = "/" + AiDoc.APP_NAME;
  const ncFormatEl   = document.getElementById("nc-format");
  const ncStatusEl   = document.getElementById("nc-status");
  const ncTestBtn    = document.getElementById("nc-test-btn");
  const ncSaveBtn    = document.getElementById("nc-save-btn");
  const ncClearBtn   = document.getElementById("nc-clear-btn");

  function setNcStatus(text, kind) {
    ncStatusEl.textContent = text || "";
    ncStatusEl.style.color = kind === "err" ? "#b00020" : "#0a7a2f";
  }
  function readNcInputs() {
    return {
      serverUrl:   ncServerEl.value,
      username:    ncUserEl.value,
      appPassword: ncPassEl.value,
      folder:      ncFolderEl.value || AiDoc.nextcloud.DEFAULT_FOLDER,
      format:      ncFormatEl.value,
    };
  }

  // Paint stored values on first open. App password stays in memory only -
  // we read it back so the user can edit, but never re-display it as plain
  // text (it's already in a type=password field).
  const initialNc = await AiDoc.nextcloud.getConnection();
  if (initialNc) {
    ncServerEl.value = initialNc.serverUrl || "";
    ncUserEl.value   = initialNc.username  || "";
    ncPassEl.value   = initialNc.appPassword || "";
    ncFolderEl.value = initialNc.folder    || AiDoc.nextcloud.DEFAULT_FOLDER;
    ncFormatEl.value = initialNc.format    || "markdown";
  } else {
    ncFolderEl.value = AiDoc.nextcloud.DEFAULT_FOLDER;
    ncFormatEl.value = "markdown";
  }

  ncTestBtn.addEventListener("click", async () => {
    const inputs = readNcInputs();
    if (!inputs.serverUrl || !inputs.username || !inputs.appPassword) {
      setNcStatus(i18n.t("optionsNextcloudFillFirst"), "err");
      return;
    }
    ncTestBtn.disabled = true;
    setNcStatus(i18n.t("optionsNextcloudTesting"));
    try {
      // 1. Get host permission (no-op if already granted).
      await AiDoc.nextcloud.requestHostPermission(inputs.serverUrl);
      // 2. Run the PROPFIND from the service worker - extension pages
      //    are blocked by CORS preflight even with host_permissions.
      const res = await chrome.runtime.sendMessage({
        type: "adx:nextcloud-test",
        conn: {
          serverUrl:   inputs.serverUrl,
          username:    inputs.username,
          appPassword: inputs.appPassword,
        },
      });
      if (res?.ok) setNcStatus(i18n.t("optionsNextcloudTestOk"));
      else         setNcStatus(res?.error || "Connection failed", "err");
    } catch (err) {
      setNcStatus(String(err?.message || err), "err");
    } finally {
      ncTestBtn.disabled = false;
    }
  });

  ncSaveBtn.addEventListener("click", async () => {
    const inputs = readNcInputs();
    if (!inputs.serverUrl || !inputs.username || !inputs.appPassword) {
      setNcStatus(i18n.t("optionsNextcloudFillFirst"), "err");
      return;
    }
    ncSaveBtn.disabled = true;
    try {
      await AiDoc.nextcloud.requestHostPermission(inputs.serverUrl);
      await AiDoc.nextcloud.setConnection(inputs);
      setNcStatus(i18n.t("optionsSavedNotice"));
    } catch (err) {
      setNcStatus(String(err?.message || err), "err");
    } finally {
      ncSaveBtn.disabled = false;
    }
  });

  ncClearBtn.addEventListener("click", async () => {
    await AiDoc.nextcloud.clearConnection();
    ncServerEl.value = "";
    ncUserEl.value   = "";
    ncPassEl.value   = "";
    ncFolderEl.value = AiDoc.nextcloud.DEFAULT_FOLDER;
    ncFormatEl.value = "markdown";
    setNcStatus(i18n.t("optionsNextcloudCleared"));
  });
})();
