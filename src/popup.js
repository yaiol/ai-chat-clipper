const i18n = AiDoc.i18n;

const btnMd = document.getElementById("export-md");
const btnHtml = document.getElementById("export-html");
const btnTxt = document.getElementById("export-txt");
const btnDocx = document.getElementById("export-docx");
const btnOdt = document.getElementById("export-odt");
const btnPdf = document.getElementById("export-pdf");
const btnImage = document.getElementById("export-image");
const btnJson = document.getElementById("export-json");
const btnDebug = document.getElementById("export-debug");
// Developer mode reveals the Debug-bundle button (raw-capture diagnostic).
// ⚠ CLAUDE: guarded — this runs at top level, and an undefined helper here
// killed the ENTIRE popup once (getDevMode lives in lib/debug-capture.js,
// which popup.html must load; the manifest content_scripts list does NOT
// apply to popup/options pages — they load their own <script> tags).
if (AiDoc.getDevMode) AiDoc.getDevMode().then((on) => { if (on) btnDebug.hidden = false; });
const btnGdoc = document.getElementById("export-gdoc");
const btnMsword = document.getElementById("export-msword");
const btnNotion = document.getElementById("export-notion");
const btnNextcloud = document.getElementById("export-nextcloud");
const btnOnenote = document.getElementById("export-onenote");
const btnCopyMd = document.getElementById("copy-md");
const btnCopyHtml = document.getElementById("copy-html");
const exportBtns = [btnMd, btnHtml, btnTxt, btnDocx, btnOdt, btnPdf, btnImage, btnJson, btnDebug, btnGdoc, btnMsword, btnNotion, btnNextcloud, btnOnenote, btnCopyMd, btnCopyHtml];
const status = document.getElementById("status");
const sitesEl = document.getElementById("sites");

// ── Site launcher — paginated so the popup stays a constant height however
// many sites ship. 6 columns × LAUNCHER_ROWS rows per page, next/prev to flip.
// ⚠ CLAUDE: LAUNCHER_ROWS is tuned by eye (3 / 4 / 5) — the one knob here.
const LAUNCHER_COLS = 6;
const LAUNCHER_ROWS = 4;
const PAGE_SIZE = LAUNCHER_COLS * LAUNCHER_ROWS;
let orderedVisible = [];   // full visible list, across all pages
let currentPage = 0;
let currentHost = "";

// Site directory + storage helpers come from lib/sites.js (AiDoc.SITES).

// Is the active tab one of our supported AI sites? Drives the popup's mode:
// supported → export view is default (toggle to the launcher); unsupported →
// launcher only (no export to offer). Same host-match the error path uses.
function isSupportedHost(host) {
  if (!host) return false;
  return (AiDoc.SITES || []).some(s => (s.hosts || []).some(x => host === x || host.endsWith("." + x)));
}

async function loadOrderedVisible() {
  const SITES = AiDoc.SITES;
  const savedOrder = await AiDoc.getOrder();
  const hidden = new Set(await AiDoc.getHidden() || []);
  const byId = new Map(SITES.map(s => [s.id, s]));
  const ordered = [];

  if (Array.isArray(savedOrder)) {
    for (const id of savedOrder) {
      if (byId.has(id)) { ordered.push(byId.get(id)); byId.delete(id); }
    }
  }
  // Append any new sites the user hasn't reordered yet - keeps the grid
  // forward-compatible when new adapters land.
  for (const s of byId.values()) ordered.push(s);

  // Visibility is applied last so a hidden site still keeps its saved
  // position when the user re-enables it.
  return ordered.filter(s => !hidden.has(s.id));
}

function makeTile(s, currentHost) {
  const a = document.createElement("a");
  a.href = s.url;
  a.target = "_blank";
  a.rel = "noopener";
  a.title = s.label;
  a.setAttribute("aria-label", s.label);
  a.dataset.id = s.id;
  a.draggable = true;

  const img = document.createElement("img");
  // Bundled brand mark (assets/sites/<id>.svg, or .png where the site ships no
  // vector — Dola) — every SITES row carries one; no runtime favicon service
  // (offline, fast, and no Google ping per popup).
  img.src = s.icon;
  img.alt = s.label;
  img.loading = "lazy";
  a.appendChild(img);

  if (s.hosts.includes(currentHost)) a.classList.add("current");

  a.addEventListener("click", (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: s.url });
    window.close();
  });

  return a;
}

// Render the current launcher page + the pager. Called on load, on page flip,
// and after a drag. The container persists, so enableDnd() is attached once.
function renderLauncher() {
  const totalPages = Math.max(1, Math.ceil(orderedVisible.length / PAGE_SIZE));
  currentPage = Math.min(Math.max(currentPage, 0), totalPages - 1);
  const start = currentPage * PAGE_SIZE;
  sitesEl.innerHTML = "";
  for (const s of orderedVisible.slice(start, start + PAGE_SIZE)) {
    sitesEl.appendChild(makeTile(s, currentHost));
  }
  const pager = document.getElementById("pager");
  if (totalPages > 1) {
    pager.hidden = false;
    document.getElementById("page-prev").disabled = currentPage === 0;
    document.getElementById("page-next").disabled = currentPage === totalPages - 1;
    document.getElementById("page-indicator").textContent = `${currentPage + 1} / ${totalPages}`;
  } else {
    pager.hidden = true;
  }
}

// Persist a new VISIBLE order. The stored order is the FULL id list, so the
// hidden sites are appended back in their saved relative order — otherwise
// re-enabling a hidden site would drop it at the end instead of where it sat.
async function persistVisibleOrder(visibleIds) {
  const prev = (await AiDoc.getOrder()) || AiDoc.SITES.map(s => s.id);
  const merged = visibleIds.slice();
  for (const id of prev) if (!merged.includes(id)) merged.push(id);
  await AiDoc.setOrder(merged);
  const byId = new Map(AiDoc.SITES.map(s => [s.id, s]));
  orderedVisible = visibleIds.map(id => byId.get(id)).filter(Boolean);
}

// Move one tile ACROSS a page boundary — the one thing a drag cannot express,
// because a drag only reorders the tiles it can see and those are exactly one
// page. The visible order is a single flat list that pagination slices, so a
// page is always dense: moving a tile out means another slides in to fill the
// gap. `dir` is +1 (next) or -1 (previous).
//
// ⚠ CLAUDE: the tile lands at the FAR end of the target page — the last slot
// going forward, the first slot coming back — and that is load-bearing, not a
// detail. Aiming at the NEAR slot (first of the next page) looks more obvious
// and is wrong: the second tile you send takes that slot and pushes the first
// one back where it came from, so sending three in a row leaves two of them on
// the page you were trying to clear. Aiming far, repeated sends accumulate on
// the target page and each one displaces a different neighbour. Verified for
// both directions at two and three pages.
//
// The view deliberately does NOT follow the tile — clearing a page usually
// means sending several, one after another.
async function moveAcrossPage(id, dir) {
  const from = orderedVisible.findIndex(s => s.id === id);
  if (from < 0) return;
  const list = orderedVisible.slice();
  const [moved] = list.splice(from, 1);
  // Post-splice indices: everything after `from` has shifted down one.
  const at = dir > 0
    ? (currentPage + 2) * PAGE_SIZE - 1   // last slot of the next page
    : (currentPage - 1) * PAGE_SIZE;      // first slot of the previous page
  list.splice(Math.max(0, Math.min(at, list.length)), 0, moved);
  await persistVisibleOrder(list.map(s => s.id));
  renderLauncher();
}

function enableDnd() {
  // A drag reorders only the CURRENT page's tiles. Splice that new order back
  // into the full visible list so the other pages keep their positions.
  AiDoc.enableSiteDnd(sitesEl, "a[data-id]", async (pageIds) => {
    const start = currentPage * PAGE_SIZE;
    const before = orderedVisible.slice(0, start).map(s => s.id);
    const after = orderedVisible.slice(start + pageIds.length).map(s => s.id);
    await persistVisibleOrder([...before, ...pageIds, ...after]);
  }, [
    // Drop a tile on a pager arrow to send it to that page.
    { el: document.getElementById("page-prev"), onDrop: id => moveAcrossPage(id, -1) },
    { el: document.getElementById("page-next"), onDrop: id => moveAcrossPage(id, +1) },
  ]);
}

(async () => {
  // Load translations and apply data-i18n / data-i18n-title attributes
  // before rendering the dynamic site tiles.
  await i18n.init();
  i18n.applyDom();

  // Help → the user-selected UI language. The help site falls back to EN for
  // languages it doesn't publish, so any code is safe to send.
  const helpLink = document.getElementById("help-link");
  if (helpLink) {
    const lang = (i18n.getLang() || "en").replace(/_/g, "-"); // full tag (hyphen form, e.g. pt-BR); nginx falls back region→base→en
    if (lang && lang !== "en") helpLink.href = helpLink.href.replace("/en/p/", `/${lang}/p/`);
  }

  // App name + version - both in the header, read live from the manifest, the single source
  // of truth (info.json → app-info → manifest). The popup reads it at runtime so
  // there is no name literal in the HTML to drift out of sync.
  const manifest = chrome.runtime.getManifest();
  document.getElementById("app-name").textContent = manifest.name;
  document.title = manifest.name;
  document.getElementById("app-version").textContent = `v${manifest.version}`;

  // Settings gear → open the extension's options page in a new tab.
  document.getElementById("open-settings").addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
    window.close();
  });

  // Selection icon → extract the convo from the active tab, stash it in
  // chrome.storage.session, then open select.html. The selection page reads
  // the stash on load (and clears it). One round-trip; no tab-id juggling.
  document.getElementById("open-select").addEventListener("click", openSelect);

  // Images icon → same round-trip as the selection page above, into media.html:
  // extract once, stash, open. The media page needs no extra extraction pass —
  // every image is already inlined or URL-resolvable in the extracted convo.
  document.getElementById("open-media").addEventListener("click", openMedia);

  // View toggle (header) — swap export ↔ launcher on supported pages.
  const viewToggle = document.getElementById("view-toggle");
  viewToggle.addEventListener("click", () => {
    const open = document.body.classList.toggle("launcher-open");
    viewToggle.title = i18n.t(open ? "popupViewExportTitle" : "popupViewLauncherTitle");
  });

  // Pager — flip launcher pages.
  document.getElementById("page-prev").addEventListener("click", () => { currentPage--; renderLauncher(); });
  document.getElementById("page-next").addEventListener("click", () => { currentPage++; renderLauncher(); });

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try { currentHost = tab?.url ? new URL(tab.url).hostname : ""; } catch {}
  orderedVisible = await loadOrderedVisible();
  renderLauncher();
  enableDnd();

  // Pin the popup to the EXPORT view's height so the window never resizes as
  // you toggle to the launcher, flip pages (a short last page), or land on an
  // unsupported site. Measured now, while the export view is still the visible
  // one (before the `unsupported` class can hide it). ⚠ CLAUDE: this is why
  // the height is measured, not hardcoded — the export block grows as cloud
  // targets are added, and this tracks it automatically.
  document.getElementById("views").style.minHeight =
    document.getElementById("export-view").offsetHeight + "px";

  // Unsupported page → no conversation to export: launcher IS the popup.
  if (!isSupportedHost(currentHost)) document.body.classList.add("unsupported");
})();

function set(msg, cls) {
  status.textContent = msg;
  status.className = "status" + (cls ? " " + cls : "");
}

const EXPORT_MESSAGES = {
  markdown: "adx:export-markdown",
  html:     "adx:export-html",
  text:     "adx:export-text",
  docx:     "adx:export-docx",
  odt:      "adx:export-odt",
  pdf:      "adx:export-pdf",
  image:    "adx:export-image",
  json:     "adx:export-json",
  debug:    "adx:export-debug",
  gdoc:     "adx:export-gdoc",
  msword:    "adx:export-msword",
  notion:    "adx:export-notion",
  nextcloud: "adx:export-nextcloud",
  onenote:   "adx:export-onenote"
};

// "Receiving end does not exist" has TWO causes with opposite fixes: the tab
// predates the extension load (F5 fixes it) — or the site simply isn't
// supported (F5 will NEVER fix it; the domain isn't in the manifest, so no
// content script exists there). Telling users to refresh an unsupported page
// is a lie — distinguish via the SITES host list.
function contentScriptError(tabUrl) {
  let supported = false;
  try { supported = isSupportedHost(new URL(tabUrl || "").hostname); }
  catch { /* not a URL (chrome://, file://) -> unsupported */ }
  return new Error(i18n.t(supported ? "errorContentScriptNotLoaded" : "errorSiteNotSupported"));
}

async function runExport(format) {
  exportBtns.forEach(b => b && (b.disabled = true));
  set(i18n.t("statusExtracting"));
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error(i18n.t("errorNoActiveTab"));
    const type = EXPORT_MESSAGES[format] || EXPORT_MESSAGES.markdown;
    let res;
    try {
      res = await chrome.tabs.sendMessage(tab.id, { type });
    } catch (e) {
      const m = String(e?.message || e);
      if (/Receiving end does not exist/i.test(m)) {
        throw contentScriptError(tab.url);
      }
      throw e;
    }
    if (!res?.ok) throw new Error(res?.error || i18n.t("errorExtractionFailed"));

    // PDF: open the rendered HTML in a new tab and let Chrome's print dialog save the PDF.
    if (res.openPrintTab) {
      set(i18n.t("statusGotMessagesPrinting", { count: res.count, site: res.site }));
      const pt = await chrome.runtime.sendMessage({ type: "adx:open-print-tab", content: res.content });
      if (!pt?.ok) throw new Error(pt?.error || i18n.t("errorPrintTab"));
      set(i18n.t("statusOpenedPrintTab"), "ok");
      return;
    }

    // Google Doc: hand off to background, which uploads via Drive API.
    if (res.uploadGdoc) {
      set(i18n.t("statusGotMessagesUploadingGdoc", { count: res.count, site: res.site }));
      const up = await chrome.runtime.sendMessage({
        type: "adx:upload-gdoc", title: res.filename, html: res.content,
      });
      if (!up?.ok) throw new Error(up?.error || "Google Docs upload failed");
      set(i18n.t("statusOpenedGdoc"), "ok");
      return;
    }

    // Word Online: bytes were rendered in content.js (NS.toMsWord → docx);
    // background uploads to OneDrive App Folder via Graph and opens webUrl.
    if (res.uploadMsword) {
      set(i18n.t("statusGotMessagesUploadingMsword", { count: res.count, site: res.site }));
      const up = await chrome.runtime.sendMessage({
        type: "adx:upload-msword",
        filename: res.filename, contentBase64: res.content, mime: res.mime,
      });
      if (!up?.ok) throw new Error(up?.error || "Word Online upload failed");
      set(i18n.t("statusOpenedMsword"), "ok");
      return;
    }

    // Notion: payload built in content.js (so site-side libs can be used);
    // background does the API call with the stored token.
    // Nextcloud: bytes were rendered in content.js (default = markdown);
    // background does the WebDAV PUT to the user's server.
    // OneNote: HTML payload built in content.js, background calls Graph
    // and posts a new page in the default notebook's Quick Notes section.
    if (res.uploadOnenote) {
      set(i18n.t("statusGotMessagesUploadingOnenote", { count: res.count, site: res.site }));
      const up = await chrome.runtime.sendMessage({
        type: "adx:upload-onenote",
        title: res.filename, html: res.content,
      });
      if (!up?.ok) throw new Error(up?.error || "OneNote upload failed");
      set(i18n.t("statusOpenedOnenote"), "ok");
      return;
    }

    if (res.uploadNextcloud) {
      set(i18n.t("statusGotMessagesUploadingNextcloud", { count: res.count, site: res.site }));
      const up = await chrome.runtime.sendMessage({
        type: "adx:upload-nextcloud",
        filename: res.filename, contentBase64: res.content, mime: res.mime,
      });
      if (!up?.ok) throw new Error(up?.error || "Nextcloud upload failed");
      set(i18n.t("statusOpenedNextcloud"), "ok");
      return;
    }

    if (res.uploadNotion) {
      set(i18n.t("statusGotMessagesUploadingNotion", { count: res.count, site: res.site }));
      const up = await chrome.runtime.sendMessage({
        type: "adx:notion-create-page",
        parent: res.parent, properties: res.properties,
        children: res.children, extras: res.extras,
      });
      if (!up?.ok) throw new Error(up?.error || "Notion upload failed");
      set(i18n.t("statusOpenedNotion"), "ok");
      return;
    }

    set(i18n.t("statusGotMessagesSaving", { count: res.count, site: res.site }));
    const dl = await AiDoc.downloadFile({
      filename: res.filename,
      content: res.content,
      mime: res.mime,
      base64: !!res.base64,
    });
    if (!dl?.ok) throw new Error(dl?.error || i18n.t("errorDownloadFailed"));
    set(i18n.t("statusSaved", { filename: res.filename }), "ok");
  } catch (err) {
    set(String(err.message || err), "err");
  } finally {
    exportBtns.forEach(b => b && (b.disabled = false));
  }
}

// Open the media page. Deliberately a near-twin of openSelect(): same extract →
// stash → open round-trip, a different stash key and target page. The two are
// short and the shared middle is three lines of storage boilerplate, so folding
// them into one parameterised helper would hide the flow to save nothing.
async function openMedia() {
  exportBtns.forEach(b => b && (b.disabled = true));
  set(i18n.t("statusExtracting"));
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error(i18n.t("errorNoActiveTab"));

    let res;
    try {
      res = await chrome.tabs.sendMessage(tab.id, { type: "adx:extract-only" });
    } catch (e) {
      const m = String(e?.message || e);
      if (/Receiving end does not exist/i.test(m)) throw contentScriptError(tab.url);
      throw e;
    }
    if (!res?.ok) throw new Error(res?.error || i18n.t("errorExtractionFailed"));

    // chrome.storage.local, not session: session caps at 10MB and a conversation
    // full of inlined base64 images blows past that silently (same reason as
    // openSelect). The media page clears the key as soon as it has read it.
    await new Promise((resolve, reject) => {
      chrome.storage.local.set({
        adx_pending_media: { convo: res.convo, siteLabel: res.site }
      }, () => {
        const err = chrome.runtime.lastError;
        if (err) reject(new Error("Storage error: " + err.message));
        else resolve();
      });
    });

    await chrome.tabs.create({ url: chrome.runtime.getURL("media.html") });
    window.close();
  } catch (err) {
    set(String(err?.message || err), "err");
    exportBtns.forEach(b => b && (b.disabled = false));
  }
}

async function openSelect() {
  exportBtns.forEach(b => b && (b.disabled = true));
  set(i18n.t("statusExtracting"));
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error(i18n.t("errorNoActiveTab"));

    let res;
    try {
      res = await chrome.tabs.sendMessage(tab.id, { type: "adx:extract-only" });
    } catch (e) {
      const m = String(e?.message || e);
      if (/Receiving end does not exist/i.test(m)) {
        throw contentScriptError(tab.url);
      }
      throw e;
    }
    if (!res?.ok) throw new Error(res?.error || i18n.t("errorExtractionFailed"));

    // Stash the convo for the selection page. Using chrome.storage.local
    // with the `unlimitedStorage` manifest permission - session has a hard
    // 10MB cap that albums of inlined base64 images blow past silently.
    // We also drop the stash on the receiver side so it doesn't outlive
    // the open of the select page.
    await new Promise((resolve, reject) => {
      chrome.storage.local.set({
        adx_pending_select: { convo: res.convo, siteLabel: res.site }
      }, () => {
        const err = chrome.runtime.lastError;
        if (err) reject(new Error("Storage error: " + err.message));
        else resolve();
      });
    });

    await chrome.tabs.create({ url: chrome.runtime.getURL("select.html") });
    window.close();
  } catch (err) {
    set(String(err.message || err), "err");
    exportBtns.forEach(b => b && (b.disabled = false));
  }
}

// Copy-to-clipboard buttons (top row of the popup). Reuse the existing
// content-script export pipeline to render markdown / full HTML, then
// hand the result to navigator.clipboard. The HTML path writes a
// ClipboardItem with both text/html (for rich-paste targets like Gmail,
// Docs, Notion, Slack) AND a stripped-down text/plain fallback so a
// non-rich paste target still gets readable text.
async function runCopy(format) {
  exportBtns.forEach(b => b && (b.disabled = true));
  set(i18n.t("statusExtracting"));
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error(i18n.t("errorNoActiveTab"));
    const type = format === "html" ? "adx:export-html" : "adx:export-markdown";
    let res;
    try {
      res = await chrome.tabs.sendMessage(tab.id, { type });
    } catch (e) {
      const m = String(e?.message || e);
      if (/Receiving end does not exist/i.test(m)) {
        throw contentScriptError(tab.url);
      }
      throw e;
    }
    if (!res?.ok) throw new Error(res?.error || i18n.t("errorExtractionFailed"));

    if (format === "html") {
      // Strip <head>/<style>/<script>/all tags to derive a plain-text
      // fallback. Quick and dirty - anything that wants the formatted
      // version will pick text/html; anything that doesn't gets readable
      // text instead of a wall of HTML source.
      const plain = res.content
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
          "text/html":  new Blob([res.content], { type: "text/html" }),
          "text/plain": new Blob([plain],       { type: "text/plain" }),
        }),
      ]);
    } else {
      await navigator.clipboard.writeText(res.content);
    }
    set("Copied!", "ok");
  } catch (err) {
    set(String(err.message || err), "err");
  } finally {
    exportBtns.forEach(b => b && (b.disabled = false));
  }
}

btnCopyMd.addEventListener("click", () => runCopy("markdown"));
btnCopyHtml.addEventListener("click", () => runCopy("html"));

btnMd.addEventListener("click", () => runExport("markdown"));
btnHtml.addEventListener("click", () => runExport("html"));
btnTxt.addEventListener("click", () => runExport("text"));
btnDocx.addEventListener("click", () => runExport("docx"));
btnOdt.addEventListener("click", () => runExport("odt"));
btnPdf.addEventListener("click", () => runExport("pdf"));
btnImage.addEventListener("click", () => runExport("image"));
btnJson.addEventListener("click", () => runExport("json"));
btnDebug.addEventListener("click", () => runExport("debug"));
btnGdoc.addEventListener("click", () => runExport("gdoc"));
btnMsword.addEventListener("click", () => runExport("msword"));
btnNotion.addEventListener("click", () => runExport("notion"));
btnNextcloud.addEventListener("click", () => runExport("nextcloud"));
btnOnenote.addEventListener("click", () => runExport("onenote"));
