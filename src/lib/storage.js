// shared chrome.storage.local helpers.
//
// Promisified, swallow errors so callers can write linear async code without
// guarding every read/write. All settings (language, sites order, hidden
// sites, export fonts, …) go through these two functions so the persistence
// layer stays in exactly one place.

(() => {
  const NS = (globalThis.AiDoc ||= {});

  // The app's display name, read LIVE from the manifest — the single source of
  // identity (info.json -> app-info -> manifest name). ⚠ CLAUDE: never hardcode
  // the product name in any runtime string — use NS.APP_NAME / NS.TAG (logs),
  // or the {app} placeholder in i18n strings. Service-worker files (background,
  // microsoft-auth, nextcloud-auth) don't load this lib — they derive a local
  // const APP_NAME from the manifest instead.
  NS.APP_NAME = (() => { try { return chrome.runtime.getManifest().name; } catch { return "extension"; } })();
  NS.TAG = "[" + NS.APP_NAME + "]";

  NS.getLocal = (key, fallback) => new Promise(resolve => {
    try { chrome.storage.local.get([key], r => resolve(r?.[key] ?? fallback)); }
    catch { resolve(fallback); }
  });

  NS.setLocal = (key, value) => new Promise(resolve => {
    try { chrome.storage.local.set({ [key]: value }, () => resolve()); }
    catch { resolve(); }
  });
})();
