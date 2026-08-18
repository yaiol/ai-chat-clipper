// shared download helper.
//
// Why not chrome.downloads.download:
//   - In MV3 service workers, URL.createObjectURL is unreliable across
//     Chrome versions (sometimes missing entirely).
//   - With a `data:` URL + saveAs:true, Chrome ignores the `filename`
//     suggestion and substitutes the locale default ("téléchargement.md"
//     on French Chrome).
//   - With a `blob:` URL + saveAs:true, Chrome derives the suggested
//     filename from the blob URL's UUID path, again ignoring the
//     `filename` parameter.
//
// The HTML <a download="…"> mechanism doesn't go through chrome.downloads
// at all - the browser uses the `download` attribute as the suggested
// filename, full stop. Works in every context where `document` exists
// (popup, options, select.html, content scripts). The file still appears
// in chrome://downloads exactly like a chrome.downloads.download() result.
//
// Trade-off: the OS Save As dialog appears according to the user's
// "Ask where to save each file" Chrome setting, not forced. We previously
// forced it via saveAs:true; now we respect the user's preference. With
// the filename template feature, users have a deterministic name anyway.

(() => {
  const NS = (globalThis.AiDoc ||= {});

  NS.downloadFile = function downloadFile(opts) {
    try {
      const { filename, content, mime, base64 } = opts || {};
      if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") {
        return Promise.resolve({ ok: false, error: "URL.createObjectURL not available" });
      }
      if (typeof document === "undefined") {
        return Promise.resolve({ ok: false, error: "document not available" });
      }

      const bytes = base64
        ? Uint8Array.from(atob(content), c => c.charCodeAt(0))
        : new TextEncoder().encode(content || "");
      const blob = new Blob([bytes], { type: mime || "application/octet-stream" });
      const url = URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = url;
      a.download = filename || "download";
      a.style.display = "none";
      // Some browsers require the anchor to be in the document for the
      // synthetic click to trigger a download. We add then immediately
      // remove - visually invisible.
      (document.body || document.documentElement).appendChild(a);
      a.click();
      a.remove();

      // Defer revocation so Chrome has time to read the blob.
      setTimeout(() => { try { URL.revokeObjectURL(url); } catch {} }, 1500);
      return Promise.resolve({ ok: true });
    } catch (err) {
      return Promise.resolve({ ok: false, error: String(err?.message || err) });
    }
  };
})();
