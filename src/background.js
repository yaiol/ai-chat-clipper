// Live product name for logs + fallback filenames — never hardcoded.
const APP_NAME = chrome.runtime.getManifest().name;
const TAG = "[" + APP_NAME + "]";

// Load auth helper into the service worker so token refresh + Graph upload
// can run from background.js. Notion's flow lives in popup/options pages,
// so it doesn't need to be importScripts'd here - only Microsoft does the
// upload from the SW.
try { importScripts("lib/microsoft-auth.js"); } catch (e) { console.warn(TAG, "microsoft-auth import failed", e); }
try { importScripts("lib/nextcloud-auth.js"); } catch (e) { console.warn(TAG, "nextcloud-auth import failed", e); }

// ── One-shot migration: aidoc_* → adx_* storage keys ────────────────────────
//
// The extension's internal namespace changed from `aidoc` to `adx` in this
// release. Existing installs have settings under `aidoc_*` keys (Notion
// tokens, Nextcloud config, font picks, language, etc.). This shim copies
// them across on first run after the update, then drops a flag so it never
// runs again. Migrates both chrome.storage.local AND chrome.storage.session.
//
// Safe to delete after a few release cycles - until then it's the only thing
// keeping installed users from losing their saved settings.
async function migrateAidocToAdx() {
  const FLAG = "adx_migrated_v1";
  const LEGACY_PREFIX = "ai" + "doc_"; // split so a future global rename can't accidentally hit it
  try {
    const flag = await chrome.storage.local.get(FLAG);
    if (flag?.[FLAG]) return;
    for (const area of ["local", "session"]) {
      const store = chrome.storage?.[area];
      if (!store) continue;
      const all = await store.get(null);
      const toWrite = {};
      const toRemove = [];
      for (const [k, v] of Object.entries(all || {})) {
        if (k.startsWith(LEGACY_PREFIX)) {
          toWrite["adx_" + k.slice(LEGACY_PREFIX.length)] = v;
          toRemove.push(k);
        }
      }
      if (Object.keys(toWrite).length) {
        await store.set(toWrite);
        await store.remove(toRemove);
        console.log(TAG, `migrated ${toRemove.length} key(s) in storage.${area} (aidoc → adx)`);
      }
    }
    await chrome.storage.local.set({ [FLAG]: true });
  } catch (e) {
    console.warn(TAG, "aidoc→adx migration failed:", e);
  }
}
chrome.runtime.onInstalled.addListener(migrateAidocToAdx);
// Defensive: also run on every SW startup until the flag is set. Cheap -
// the flag check is one storage.get and bails immediately on subsequent runs.
migrateAidocToAdx();

// ── NotebookLM session capture ──────────────────────────────────────────────
//
// NotebookLM's batchexecute RPC needs a per-session `at` (CSRF) token and a
// `conversationUuid` distinct from the URL slug. Both are only visible in
// requests the page makes against its own backend. We observe those requests
// via webRequest, parse the form-encoded body, and keep the most recent
// values per tab - content.js asks for them when the user triggers an export.
//
// We don't need webRequestBlocking: the listener is observe-only and the
// captured values persist in memory for as long as the SW lives. If the SW
// is evicted before the user exports, the content script falls back to DOM
// extraction (its own code path) - degrades gracefully.
// In-memory cache keyed by tabId. Mirrored to chrome.storage.session so the
// captured values survive service-worker eviction between user actions
// (Chrome puts MV3 SWs to sleep after ~30s idle - losing the Map would
// silently kick us back to DOM extraction on the next export).
const notebooklmSessions = new Map(); // tabId -> { atToken, conversationUuid, reqId, ts }
const NLM_STORAGE_KEY = "adx_nlm_sessions";

function persistNotebookLM() {
  try {
    const obj = {};
    for (const [tabId, v] of notebooklmSessions) obj[String(tabId)] = v;
    chrome.storage?.session?.set?.({ [NLM_STORAGE_KEY]: obj });
  } catch {}
}

async function loadNotebookLMSession(tabId) {
  const inMem = notebooklmSessions.get(tabId);
  if (inMem) return inMem;
  try {
    const data = await chrome.storage?.session?.get?.(NLM_STORAGE_KEY);
    const obj = data?.[NLM_STORAGE_KEY] || {};
    const v = obj[String(tabId)] || null;
    if (v) notebooklmSessions.set(tabId, v);
    return v;
  } catch { return null; }
}

function decodeFormBody(requestBody) {
  if (!requestBody) return null;
  if (requestBody.formData) {
    // Chrome parsed it for us.
    const out = {};
    for (const [k, v] of Object.entries(requestBody.formData)) {
      out[k] = Array.isArray(v) ? v[0] : v;
    }
    return out;
  }
  if (Array.isArray(requestBody.raw) && requestBody.raw[0]?.bytes) {
    try {
      const bytes = new Uint8Array(requestBody.raw[0].bytes);
      const text = new TextDecoder("utf-8").decode(bytes);
      const params = new URLSearchParams(text);
      const out = {};
      for (const [k, v] of params.entries()) out[k] = v;
      return out;
    } catch { return null; }
  }
  return null;
}

try {
  chrome.webRequest.onBeforeRequest.addListener(
    (details) => {
      if (details.method !== "POST") return;
      if (details.type !== "xmlhttprequest") return;
      const tabId = details.tabId;
      if (tabId == null || tabId < 0) return;

      const form = decodeFormBody(details.requestBody);
      if (!form) return;

      const atToken = form.at || form.At || null;
      // f.req = [[["khqZz", "[[],null,null,\"<uuid>\",100,null]", null, "generic"]]]
      let conversationUuid = null;
      if (form["f.req"]) {
        try {
          const outer = JSON.parse(form["f.req"]);
          const rpcid = outer?.[0]?.[0]?.[0];
          const inner = outer?.[0]?.[0]?.[1];
          if (rpcid && inner && typeof inner === "string") {
            const parsed = JSON.parse(inner);
            // For khqZz (list messages) the conversationUuid lives at index 3.
            // For VfAZjd (summary) the uuid is at index 0.
            if (rpcid === "khqZz" && typeof parsed?.[3] === "string") conversationUuid = parsed[3];
            else if (rpcid === "VfAZjd" && typeof parsed?.[0] === "string") conversationUuid = parsed[0];
          }
        } catch {}
      }

      const reqIdMatch = details.url.match(/[?&]_reqid=(\d+)/);
      const reqId = reqIdMatch ? reqIdMatch[1] : null;

      if (!atToken && !conversationUuid && !reqId) return;

      const prev = notebooklmSessions.get(tabId) || {};
      notebooklmSessions.set(tabId, {
        atToken:          atToken          || prev.atToken          || null,
        conversationUuid: conversationUuid || prev.conversationUuid || null,
        reqId:            reqId            || prev.reqId            || null,
        ts: Date.now(),
      });
      persistNotebookLM();
    },
    { urls: ["https://notebooklm.google.com/_/LabsTailwindUi/data/batchexecute*"] },
    ["requestBody"]
  );
} catch (e) {
  console.warn(TAG, "NotebookLM webRequest hook failed", e);
}

chrome.tabs?.onRemoved?.addListener?.((tabId) => {
  notebooklmSessions.delete(tabId);
  persistNotebookLM();
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // adx:download is no longer routed through the SW - callers now use
  // lib/download.js (NS.downloadFile) directly. The SW path was unusable
  // because URL.createObjectURL is not reliably available in MV3 service
  // workers, and the data: URL fallback breaks Chrome's Save As filename
  // suggestion (Chrome substitutes "téléchargement.md" / "download.md").

  if (msg?.type === "adx:fetch-as-data-url") {
    // Cross-origin fetch from a content script's page is CORS-blocked. The
    // background script has host_permissions and can fetch directly. Returns
    // the bytes as a base64 data URL.
    //
    // Credential-less FIRST: most of what we fetch (Google user-content CDN,
    // Copilot th/id, dall-e-images) is public, and a public URL that serves
    // `Access-Control-Allow-Origin: *` is rejected by the browser when combined
    // with credentials — so `omit` is the right default and must stay first.
    //
    // ⚠ But not everything is public. Gemini's /library images (and anything
    // else behind a Google session) answer 401/403 without the cookie, and an
    // extension background fetch covered by host_permissions is NOT a CORS
    // request, so the ACAO concern above simply does not apply to a retry.
    // Verified 2026-08-05: every one of 224 library images 403'd on `omit`.
    // So: try public, then retry credentialed. Never the other way round.
    const url = msg.url;
    (async () => {
      try {
        let r = await fetch(url, { credentials: "omit" });
        if (r.status === 401 || r.status === 403) {
          try {
            const withCreds = await fetch(url, { credentials: "include" });
            if (withCreds.ok) r = withCreds;
          } catch { /* keep the original response + its error below */ }
        }
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const blob = await r.blob();
        const dataUrl = await new Promise((res, rej) => {
          const fr = new FileReader();
          fr.onload = () => res(fr.result);
          fr.onerror = () => rej(fr.error);
          fr.readAsDataURL(blob);
        });
        sendResponse({ ok: true, dataUrl });
      } catch (err) {
        sendResponse({ ok: false, error: String(err?.message || err) });
      }
    })();
    return true;
  }

  if (msg?.type === "adx:open-print-tab") {
    const url = "data:text/html;charset=utf-8," + encodeURIComponent(msg.content || "");
    chrome.tabs.create({ url, active: true }).then((tab) => {
      sendResponse({ ok: true, tabId: tab?.id });
    }).catch((err) => {
      sendResponse({ ok: false, error: String(err?.message || err) });
    });
    return true;
  }

  if (msg?.type === "adx:upload-gdoc") {
    // Upload HTML to Drive and have it converted to a native Google Doc.
    // Uses chrome.identity.getAuthToken - silent after first consent.
    (async () => {
      const getToken = (interactive) => new Promise((resolve, reject) => {
        chrome.identity.getAuthToken({ interactive }, (t) => {
          const err = chrome.runtime.lastError;
          if (err || !t) reject(new Error(err?.message || "No token"));
          else resolve(t);
        });
      });
      const dropToken = (token) => new Promise((resolve) => {
        chrome.identity.removeCachedAuthToken({ token }, resolve);
      });
      const upload = async (token) => {
        const boundary = "adx-" + Math.random().toString(36).slice(2);
        const metadata = { name: msg.title || APP_NAME, mimeType: "application/vnd.google-apps.document" };
        const body =
          `--${boundary}\r\n` +
          `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
          JSON.stringify(metadata) + `\r\n` +
          `--${boundary}\r\n` +
          `Content-Type: text/html; charset=UTF-8\r\n\r\n` +
          (msg.html || "") + `\r\n` +
          `--${boundary}--`;
        return fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink", {
          method: "POST",
          headers: {
            Authorization: "Bearer " + token,
            "Content-Type": `multipart/related; boundary=${boundary}`,
          },
          body,
        });
      };
      try {
        let token = await getToken(true);
        let r = await upload(token);
        if (r.status === 401) {
          // Token revoked or scope changed since cache; refresh once.
          await dropToken(token);
          token = await getToken(true);
          r = await upload(token);
        }
        if (!r.ok) throw new Error(`Drive ${r.status}: ${(await r.text()).slice(0, 200)}`);
        const { id, webViewLink } = await r.json();
        const url = webViewLink || `https://docs.google.com/document/d/${id}/edit`;
        await chrome.tabs.create({ url, active: true });
        sendResponse({ ok: true, id, url });
      } catch (err) {
        sendResponse({ ok: false, error: String(err?.message || err) });
      }
    })();
    return true;
  }

  if (msg?.type === "adx:notion-create-page") {
    // Caller (content.js or popup.js) builds the page payload via
    // NS.toNotion(convo, parentId). Image blocks for `data:` URLs come in
    // as placeholders marked `_pending_data_url` - we upload each to
    // Notion's file-upload API and rewrite the placeholder to a proper
    // `file_upload` reference before the page is created.
    (async () => {
      try {
        const conn = await new Promise((res) =>
          chrome.storage.local.get("adx_notion", (o) => res(o.adx_notion || null)));
        const token = conn?.access_token;
        if (!token) throw new Error("Not connected to Notion");

        // 2025-09-03 is current at time of writing and supports both the
        // file-upload API and `file_upload` references in image blocks.
        // Older versions (2022-06-28) don't recognize either.
        const headers = {
          "Authorization": `Bearer ${token}`,
          "Content-Type":  "application/json",
          "Notion-Version": "2025-09-03",
        };

        // Walk a list of blocks, finding image placeholders, uploading
        // each data URL exactly once (memoized), and replacing the
        // placeholder in-place with a `file_upload` reference. Mutates
        // blocks. Returns nothing.
        const uploadCache = new Map(); // dataUrl -> file_upload_id
        async function resolveImageUploads(blocks) {
          for (const b of blocks) {
            if (b?.type === "image" && b.image?.type === "_pending_data_url") {
              const dataUrl = b.image._pending_data_url;
              let fileUploadId = uploadCache.get(dataUrl);
              if (!fileUploadId) {
                fileUploadId = await uploadDataUrlToNotion(dataUrl, token);
                uploadCache.set(dataUrl, fileUploadId);
              }
              b.image = { type: "file_upload", file_upload: { id: fileUploadId } };
            }
          }
        }

        // Single-part upload: ≤5 MB. Two-step API: create the upload
        // object, then POST the bytes to /send.
        async function uploadDataUrlToNotion(dataUrl, tok) {
          const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
          if (!m) throw new Error("Invalid data URL in image block");
          const mime = m[1];
          const bin = atob(m[2]);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          const ext = (mime.split("/")[1] || "png").replace(/[^a-z0-9]/gi, "");
          const filename = `image-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

          // Step 1 - create the upload object.
          const createRes = await fetch("https://api.notion.com/v1/file_uploads", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${tok}`,
              "Content-Type": "application/json",
              "Notion-Version": "2025-09-03",
            },
            body: JSON.stringify({ mode: "single_part", filename, content_type: mime }),
          });
          if (!createRes.ok) {
            const t = await createRes.text().catch(() => "");
            throw new Error(`Notion file_uploads create ${createRes.status}: ${t.slice(0, 200)}`);
          }
          const created = await createRes.json();

          // Step 2 - POST the bytes as multipart/form-data to /send.
          const fd = new FormData();
          fd.append("file", new Blob([bytes], { type: mime }), filename);
          const sendRes = await fetch(`https://api.notion.com/v1/file_uploads/${created.id}/send`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${tok}`,
              "Notion-Version": "2025-09-03",
              // No Content-Type - fetch sets multipart boundary automatically.
            },
            body: fd,
          });
          if (!sendRes.ok) {
            const t = await sendRes.text().catch(() => "");
            throw new Error(`Notion file_uploads send ${sendRes.status}: ${t.slice(0, 200)}`);
          }
          return created.id;
        }

        // Resolve images in the first batch + every extras batch.
        await resolveImageUploads(msg.children || []);
        for (const batch of (msg.extras || [])) {
          await resolveImageUploads(batch);
        }

        const createBody = {
          parent: msg.parent,
          properties: msg.properties,
          children: msg.children || [],
        };
        let r = await fetch("https://api.notion.com/v1/pages", {
          method: "POST", headers, body: JSON.stringify(createBody),
        });
        const created = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(created.message || `Create failed (${r.status})`);
        const pageId = created.id;
        const url = created.url || `https://www.notion.so/${pageId.replace(/-/g, "")}`;

        for (const batch of (msg.extras || [])) {
          const rr = await fetch(
            `https://api.notion.com/v1/blocks/${encodeURIComponent(pageId)}/children`,
            { method: "PATCH", headers, body: JSON.stringify({ children: batch }) }
          );
          if (!rr.ok) {
            const e = await rr.json().catch(() => ({}));
            throw new Error(`Append failed (${rr.status}): ${e.message || ""}`);
          }
        }

        await chrome.tabs.create({ url, active: true });
        sendResponse({ ok: true, id: pageId, url });
      } catch (err) {
        sendResponse({ ok: false, error: String(err?.message || err) });
      }
    })();
    return true;
  }

  if (msg?.type === "adx:upload-msword") {
    // Upload a .docx (built by content.js via NS.toMsWord) to OneDrive's
    // App Folder via Graph, then open the resulting file in Word Online
    // using the response's `webUrl`. Token is read + refreshed by
    // lib/microsoft-auth.js (loaded into the SW via importScripts below).
    (async () => {
      try {
        const NS = self.AiDoc;
        if (!NS?.microsoft) throw new Error("microsoft-auth not loaded");

        // Decode base64 → Uint8Array → Blob (Graph wants raw bytes).
        const b64 = msg.contentBase64 || "";
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const blob = new Blob([bytes], { type: msg.mime || "application/octet-stream" });

        // Sanitize filename for the Graph path. Drive disallows: \ / : * ? " < > |
        const safe = String(msg.filename || APP_NAME + ".docx").replace(/[\\/:*?"<>|]/g, "_");
        const path = `https://graph.microsoft.com/v1.0/me/drive/special/approot:/${encodeURIComponent(safe)}:/content`;

        const upload = async (token) => fetch(path, {
          method: "PUT",
          headers: { Authorization: "Bearer " + token, "Content-Type": msg.mime || "application/octet-stream" },
          body: blob,
        });

        let token = await NS.microsoft.getAccessToken();
        let r = await upload(token);
        if (r.status === 401) {
          // Force a refresh by clearing the cached expiry and retrying once.
          const conn = await NS.microsoft.getConnection();
          if (conn) { conn.expires_at = 0; await NS.microsoft.setConnection(conn); }
          token = await NS.microsoft.getAccessToken();
          r = await upload(token);
        }
        if (!r.ok) {
          const t = await r.text().catch(() => "");
          throw new Error(`Graph ${r.status}: ${t.slice(0, 200)}`);
        }
        const item = await r.json();
        const url = item.webUrl || `https://www.office.com/launch/word?ms=${encodeURIComponent(item.id || "")}`;
        await chrome.tabs.create({ url, active: true });
        sendResponse({ ok: true, id: item.id, url });
      } catch (err) {
        sendResponse({ ok: false, error: String(err?.message || err) });
      }
    })();
    return true;
  }

  if (msg?.type === "adx:upload-onenote") {
    // Create a new OneNote page in the default notebook's Quick Notes
    // section (no picker - Notes.Create scope only allows creation, not
    // listing). Body is a multipart/form-data with one "Presentation" part
    // carrying the HTML - same HTML the local HTML / Word / Drive exports
    // produce, so the OneNote page renders consistently with the rest.
    (async () => {
      try {
        const NS = self.AiDoc;
        if (!NS?.microsoft) throw new Error("microsoft-auth not loaded");

        const html = msg.html || "";
        const title = msg.title || APP_NAME;

        const upload = async (token) => {
          const boundary = "adx-" + Math.random().toString(36).slice(2);
          // /me/onenote/pages = default notebook's Quick Notes section.
          // No section ID needed; OneNote auto-routes.
          const body =
            `--${boundary}\r\n` +
            `Content-Disposition: form-data; name="Presentation"\r\n` +
            `Content-Type: text/html\r\n\r\n` +
            html + `\r\n` +
            `--${boundary}--`;
          return fetch("https://graph.microsoft.com/v1.0/me/onenote/pages", {
            method: "POST",
            headers: {
              Authorization: "Bearer " + token,
              "Content-Type": `multipart/form-data; boundary=${boundary}`,
            },
            body,
          });
        };

        let token = await NS.microsoft.getAccessToken();
        let r = await upload(token);
        if (r.status === 401) {
          const conn = await NS.microsoft.getConnection();
          if (conn) { conn.expires_at = 0; await NS.microsoft.setConnection(conn); }
          token = await NS.microsoft.getAccessToken();
          r = await upload(token);
        }
        if (!r.ok) {
          const t = await r.text().catch(() => "");
          // Surface the most common cause: scope not granted yet (the user
          // connected before Notes.Create was added). Tell them to reconnect.
          if (r.status === 403 && /Notes\.Create|scope/i.test(t)) {
            throw new Error("OneNote permission missing - disconnect Microsoft 365 in Settings and reconnect to grant the new scope.");
          }
          throw new Error(`OneNote ${r.status}: ${t.slice(0, 300)}`);
        }
        const page = await r.json();
        const url = page?.links?.oneNoteWebUrl?.href
                 || page?.links?.oneNoteClientUrl?.href
                 || `https://www.onenote.com/notebooks?id=${encodeURIComponent(page?.id || "")}`;
        await chrome.tabs.create({ url, active: true });
        sendResponse({ ok: true, id: page.id, url, title });
      } catch (err) {
        sendResponse({ ok: false, error: String(err?.message || err) });
      }
    })();
    return true;
  }

  if (msg?.type === "adx:nextcloud-test") {
    // Probe credentials from the service worker - extension pages
    // (options.html) are subject to CORS even with host_permissions, but
    // the SW bypasses CORS for any host_permissions-granted origin.
    (async () => {
      try {
        const NS = self.AiDoc;
        if (!NS?.nextcloud) throw new Error("nextcloud-auth not loaded");
        const conn = msg.conn || {};
        const res = await NS.nextcloud.testConnection({
          serverUrl:   NS.nextcloud.normaliseServerUrl(conn.serverUrl),
          username:    String(conn.username || "").trim(),
          appPassword: String(conn.appPassword || "").trim(),
        });
        sendResponse(res);
      } catch (err) {
        sendResponse({ ok: false, error: String(err?.message || err) });
      }
    })();
    return true;
  }

  if (msg?.type === "adx:upload-nextcloud") {
    // Upload bytes to the user's Nextcloud via WebDAV.
    //   1. Try MKCOL on the target folder (idempotent - 405 if it exists).
    //   2. PUT the file (201 created / 204 overwritten).
    //   3. Open the Nextcloud Files app focused on the new file (using the
    //      OC-FileId response header) so the user lands directly on it.
    (async () => {
      try {
        const NS = self.AiDoc;
        if (!NS?.nextcloud) throw new Error("nextcloud-auth not loaded");
        const conn = await NS.nextcloud.getConnection();
        if (!conn?.serverUrl) throw new Error("Not connected to Nextcloud");

        const auth = NS.nextcloud.basicAuth(conn.username, conn.appPassword);

        // Decode base64 → bytes (same shape as the Word / Drive uploads).
        const b64 = msg.contentBase64 || "";
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

        const folder = NS.nextcloud.normaliseFolder(conn.folder || NS.nextcloud.DEFAULT_FOLDER);
        const safeName = String(msg.filename || APP_NAME + ".md").replace(/[\\/:*?"<>|]/g, "_");
        const fullPath = `${folder}/${safeName}`;

        // 1. Ensure folder exists. MKCOL returns 201 (created) on success or
        // 405 (Method Not Allowed) when the collection already exists - both fine.
        if (folder) {
          const mk = await fetch(NS.nextcloud.davUrl(conn, folder), {
            method: "MKCOL",
            credentials: "omit", // avoid Nextcloud session/CSRF path
            headers: { Authorization: auth },
          });
          if (mk.status !== 201 && mk.status !== 405) {
            const t = await mk.text().catch(() => "");
            throw new Error(`MKCOL ${mk.status}: ${t.slice(0, 200)}`);
          }
        }

        // 2. PUT the file.
        const put = await fetch(NS.nextcloud.davUrl(conn, fullPath), {
          method: "PUT",
          credentials: "omit",
          headers: {
            Authorization: auth,
            "Content-Type": msg.mime || "application/octet-stream",
          },
          body: bytes,
        });
        if (put.status !== 201 && put.status !== 204) {
          const t = await put.text().catch(() => "");
          throw new Error(`PUT ${put.status}: ${t.slice(0, 200)}`);
        }

        // 3. Build the web URL. OC-FileId header → /f/<id> opens the file
        // viewer directly; falling back to the Files app at the folder.
        const fileId = put.headers.get("OC-FileId") || put.headers.get("oc-fileid");
        let url;
        if (fileId) {
          // Strip the trailing instance-id (Nextcloud returns e.g. "00012345ocxyz");
          // /f/<numeric> is what the web UI uses.
          const numeric = String(fileId).replace(/^0+/, "").replace(/[^0-9].*$/, "");
          url = `${conn.serverUrl}/f/${numeric || fileId}`;
        } else {
          url = `${conn.serverUrl}/apps/files/?dir=${encodeURIComponent(folder || "/")}`;
        }
        await chrome.tabs.create({ url, active: true });
        sendResponse({ ok: true, url });
      } catch (err) {
        sendResponse({ ok: false, error: String(err?.message || err) });
      }
    })();
    return true;
  }

  if (msg?.type === "adx:notebooklm-session") {
    const tabId = sender.tab?.id;
    if (tabId == null) { sendResponse({ ok: false, error: "no tab id" }); return false; }
    loadNotebookLMSession(tabId).then((s) => sendResponse({ ok: true, session: s }));
    return true;
  }

  if (msg?.type === "adx:capture-tab") {
    // Capture the visible portion of the sender's tab as a PNG data URL.
    // Used by the image exporter, which scrolls the chat container and
    // stitches multiple captures together. captureVisibleTab is a
    // background-only API; content scripts can't call it directly.
    const windowId = sender.tab?.windowId;
    chrome.tabs.captureVisibleTab(windowId, { format: "png" }, (dataUrl) => {
      const err = chrome.runtime.lastError;
      if (err || !dataUrl) {
        sendResponse({ ok: false, error: err?.message || "no dataUrl" });
      } else {
        sendResponse({ ok: true, dataUrl });
      }
    });
    return true;
  }

  if (msg?.type === "adx:read-page-globals") {
    // Execute in MAIN world to access window.* globals from the host page
    // (CSP-safe: doesn't inject inline <script>).
    const tabId = sender.tab?.id;
    if (!tabId) { sendResponse({ ok: false, error: "no tab id" }); return false; }
    const keys = Array.isArray(msg.keys) ? msg.keys : [];
    chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      args: [keys],
      func: (keys) => {
        const data = window.WIZ_global_data || {};
        const out = {};
        for (const k of keys) out[k] = data[k];
        return out;
      }
    }).then((results) => {
      sendResponse({ ok: true, payload: results?.[0]?.result || {} });
    }).catch((err) => {
      sendResponse({ ok: false, error: String(err?.message || err) });
    });
    return true;
  }
});
