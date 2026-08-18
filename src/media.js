// Media view - every image in the extracted conversation, as a selectable grid.
//
// Modelled on chat-clipper's media.js (cheap grid -> select -> download), but
// deliberately WITHOUT the machinery that page carries. WhatsApp forced it into
// a permanent per-chat index, message-id-keyed download records and a history
// walk, because its media outlives any single scan and a scan takes minutes.
// Here the whole conversation is already extracted before this page opens, so
// the extraction IS the index: there is nothing to remember between visits, and
// no reason to invent a second source of truth.
//
// The images themselves need no fetching to preview. By the time the convo
// reaches storage, html-to-md.js has already inlined every session-bound image
// (blob:, googleusercontent, ChatGPT estuary, ...) as a base64 data URI - the
// same work the HTML/DOCX exporters rely on - so a tile's src is either a public
// URL or self-contained bytes. That is why there is no thumbnail pipeline here.

(() => {
  const NS = globalThis.AiDoc;
  const i18n = NS.i18n;

  const gridEl = document.getElementById("grid");
  const metaEl = document.getElementById("meta");
  const selectAllBtn = document.getElementById("select-all");
  const selectNoneBtn = document.getElementById("select-none");
  const downloadBtn = document.getElementById("download-selected");

  // Markdown image: ![alt](url). A data: URI contains no ")" or whitespace and
  // neither does a normal image URL, so the lazy character class is safe here
  // and avoids dragging in a markdown parser for one pattern.
  const IMG_RE = /!\[([^\]]*)\]\(([^)\s]+)\)/g;

  const MIME_EXT = {
    "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp",
    "image/gif": "gif", "image/svg+xml": "svg", "image/avif": "avif",
    "image/bmp": "bmp", "image/x-icon": "ico",
  };

  let items = [];   // { url, alt, role, index, el }
  let convoInfo = { site: "", messages: 0 };

  // ⚠ A tile CANNOT just be <img src="<the url>">. Several sites' image URLs are
  // bound to the chat's own session (Gemini's are), and this page runs on the
  // chrome-extension:// origin, so the browser sends no cookie and the server
  // answers 403 — 224 broken tiles, verified 2026-08-05. Every image therefore
  // goes through the background fetch, which holds host_permissions and retries
  // credentialed on 401/403 (see background.js). One cache serves both the tile
  // and its download, so a downloaded image is never fetched twice.
  const bytesCache = new Map();   // url -> data: URL

  async function resolveImage(url) {
    if (bytesCache.has(url)) return bytesCache.get(url);
    if (url.startsWith("data:")) { bytesCache.set(url, url); return url; }
    let out = null;
    try {
      const res = await chrome.runtime.sendMessage({ type: "adx:fetch-as-data-url", url });
      if (res?.ok) out = res.dataUrl;
      else console.warn("[adx] media: could not fetch", url, res?.error);
    } catch (e) { console.warn("[adx] media: fetch threw", url, e); }
    bytesCache.set(url, out);
    return out;
  }

  // Fill the tiles a few at a time. Sequential-ish on purpose: a library can be
  // 200+ full-size originals, and resolving them all at once would hold every
  // one in memory as base64 before the first is drawn.
  async function fillTiles(list) {
    const queue = list.slice();
    const worker = async () => {
      while (queue.length) {
        const it = queue.shift();
        const data = await resolveImage(it.url);
        const img = it.el?.querySelector("img");
        if (!img) continue;
        if (data) img.src = data;
        else it.el.classList.add("is-error");
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, queue.length) }, worker));
  }

  /** Filesystem-safe stem for the downloaded files, from the conversation title. */
  function baseName(convo) {
    const raw = (convo?.title || "conversation").trim();
    return raw.replace(/[\\/:*?"<>|]+/gu, "-").replace(/\s+/gu, " ").slice(0, 80) || "conversation";
  }

  /** Every distinct image in the conversation, in reading order. */
  function collectImages(convo) {
    const seen = new Set();
    const out = [];
    for (const msg of convo?.messages || []) {
      for (const m of String(msg.markdown || "").matchAll(IMG_RE)) {
        const url = m[2];
        if (seen.has(url)) continue;
        seen.add(url);
        out.push({ url, alt: m[1] || "", role: msg.role, index: out.length + 1 });
      }
    }
    return out;
  }

  function selectedItems() {
    return items.filter(it => it.el.classList.contains("is-selected"));
  }

  function updateMeta() {
    const n = selectedItems().length;
    metaEl.textContent = i18n.t("mediaMeta", { selected: n, count: items.length });
    downloadBtn.disabled = n === 0;
  }

  function render() {
    gridEl.replaceChildren();
    if (!items.length) {
      const empty = document.createElement("p");
      empty.className = "ya-status";
      empty.textContent = i18n.t("mediaEmpty");
      // Same reason as the log above: put the shape of what arrived on screen,
      // so a screenshot of the empty state is itself the diagnosis.
      metaEl.textContent = `${convoInfo.site || "?"} · ${convoInfo.messages} message(s) · 0 images`;
      gridEl.appendChild(empty);
      updateMeta();
      return;
    }
    for (const it of items) {
      const tile = document.createElement("div");
      tile.className = "ya-media-tile";

      const img = document.createElement("img");
      img.loading = "lazy";
      img.alt = it.alt;   // src arrives from fillTiles() — see bytesCache above
      tile.appendChild(img);

      const meta = document.createElement("div");
      meta.className = "ya-media-tile-meta";
      const left = document.createElement("span");
      left.textContent = it.role === "user" ? i18n.t("mediaRoleUser") : i18n.t("mediaRoleAssistant");
      const right = document.createElement("span");
      right.textContent = String(it.index);
      meta.append(left, right);
      tile.appendChild(meta);

      tile.addEventListener("click", () => {
        tile.classList.toggle("is-selected");
        updateMeta();
      });

      it.el = tile;
      gridEl.appendChild(tile);
    }
    updateMeta();
    fillTiles(items);
  }

  /**
   * Fetch one image and hand it to the shared download helper.
   *
   * ⚠ Goes through NS.downloadFile (lib/download.js) rather than
   * chrome.downloads.download, and that file's header explains why in detail:
   * with a data: or blob: URL Chrome ignores the `filename` you pass and
   * substitutes its own, so every image would land as "download (1).png".
   * fetch() handles data: URIs as happily as https:, so one path covers both.
   */
  async function downloadOne(it, stem) {
    const data = await resolveImage(it.url);
    if (!data) throw new Error("image unavailable");
    const res = await fetch(data);          // data: URL — always same-origin
    const blob = await res.blob();
    const ext = MIME_EXT[blob.type] || "png";
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const num = String(it.index).padStart(2, "0");
    const out = await NS.downloadFile({
      filename: `${stem}-${num}.${ext}`,
      content: NS.bytesToBase64(bytes),
      mime: blob.type || "application/octet-stream",
      base64: true,
    });
    if (!out?.ok) throw new Error(out?.error || "download failed");
  }

  async function downloadSelected(convo) {
    const chosen = selectedItems();
    if (!chosen.length) return;
    downloadBtn.disabled = true;
    const stem = baseName(convo);
    let failed = 0;
    for (const it of chosen) {
      it.el.classList.remove("is-done", "is-error");
      it.el.classList.add("is-busy");
      try {
        await downloadOne(it, stem);
        it.el.classList.replace("is-busy", "is-done");
      } catch (e) {
        failed++;
        it.el.classList.replace("is-busy", "is-error");
        console.warn("[adx] image download failed:", it.url, e);
      }
    }
    metaEl.textContent = i18n.t("mediaDownloadDone", { done: chosen.length - failed, failed });
    downloadBtn.disabled = false;
  }

  (async () => {
    await i18n.init();
    i18n.applyDom();

    // The popup stashes the convo here, exactly as it does for select.html, and
    // we drop it immediately so it cannot outlive this page load.
    const stash = await new Promise(resolve =>
      chrome.storage.local.get("adx_pending_media", r => resolve(r?.adx_pending_media)));
    chrome.storage.local.remove("adx_pending_media");

    if (!stash?.convo) {
      metaEl.textContent = i18n.t("mediaLoadError");
      return;
    }
    document.title = stash.convo.title || i18n.t("mediaPageTitle");
    convoInfo = { site: stash.convo.site, messages: stash.convo.messages?.length ?? 0 };
    items = collectImages(stash.convo);
    // ⚠ Log what actually arrived. "No images" alone cannot distinguish
    // "extraction returned nothing" from "extraction returned text-only turns",
    // and that ambiguity already cost two wrong diagnoses.
    console.log(`[adx] media: site=${stash.convo.site} url=${stash.convo.url} messages=${stash.convo.messages?.length ?? 0} images=${items.length}`);
    render();

    selectAllBtn.addEventListener("click", () => {
      for (const it of items) it.el.classList.add("is-selected");
      updateMeta();
    });
    selectNoneBtn.addEventListener("click", () => {
      for (const it of items) it.el.classList.remove("is-selected");
      updateMeta();
    });
    downloadBtn.addEventListener("click", () => downloadSelected(stash.convo));
  })();
})();
