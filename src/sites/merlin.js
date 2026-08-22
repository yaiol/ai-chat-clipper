(() => {
  const NS = (globalThis.AiDoc ||= {});
  const sites = (NS.sites ||= {});

  // Merlin AI (getmerlin.in) — confirmed live (2026-07-21).
  // Auth: Firebase web SDK — the access token lives in IndexedDB
  //   firebaseLocalStorageDb / firebaseLocalStorage, row whose fbase_key is
  //   "firebase:authUser:…" → value.stsTokenManager.accessToken. The API
  //   answers 401 MISSING_BEARER_TOKEN without `Authorization: Bearer <it>`.
  // Endpoint: GET /arcane/api/v1/user/history/<chatId>  (chat id from the
  //   /<locale>/chat/<uuid> path). Response:
  //   { data: { thread: { root, <id>: { parentId, childrenId[], role,
  //     content, contentV2, attachments[], timestamp } },
  //     metadata: { title } } }
  // `content` is the clean final markdown of the turn — the tool machinery
  // (contentV2 TEXT-with-toolCalls / PROGRESS / TOOL_RESULT segments) never
  // leaks into it, so contentV2 is deliberately ignored.
  // attachments type WEB_ACCESS_GEN_LINK = web citations { title, url }.
  // The thread is a TREE (edits branch); walk root → LAST childrenId each
  // step = the newest branch.

  async function firebaseToken() {
    try {
      const db = await new Promise((res, rej) => {
        const q = indexedDB.open("firebaseLocalStorageDb");
        q.onsuccess = () => res(q.result);
        q.onerror = () => rej(q.error);
      });
      if (!db.objectStoreNames.contains("firebaseLocalStorage")) { db.close(); return null; }
      const rows = await new Promise((res, rej) => {
        const tx = db.transaction("firebaseLocalStorage", "readonly").objectStore("firebaseLocalStorage").getAll();
        tx.onsuccess = () => res(tx.result);
        tx.onerror = () => rej(tx.error);
      });
      db.close();
      const row = rows.find(r => /authUser/.test(r?.fbase_key || ""));
      return row?.value?.stsTokenManager?.accessToken || null;
    } catch { return null; }
  }

  sites.merlin = {
    id: "merlin",
    label: "Merlin",
    matches(host) { return host === "www.getmerlin.in" || host === "getmerlin.in"; },

    title() {
      // document.title is a generic "Chat - Merlin AI"; the real title comes
      // from the API metadata in extract() - this is only the fallback.
      return document.title.replace(/\s*[-|·]\s*Merlin.*$/i, "").trim() || "Merlin chat";
    },

    getConversationId() {
      return location.pathname.match(/\/chat\/([0-9a-f-]{8,})/i)?.[1] || null;
    },

    async fetchHistory(id) {
      const token = await firebaseToken();
      const headers = { "Accept": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const r = await fetch(`/arcane/api/v1/user/history/${id}`, { credentials: "include", headers });
      if (!r.ok) throw new Error(`Merlin API ${r.status}`);
      return NS.debug.json(r, "merlin");
    },

    async extract() {
      let title = this.title();
      const id = this.getConversationId();
      const messages = [];
      if (id) {
        const data = (await this.fetchHistory(id))?.data || {};
        if (data.metadata?.title) title = data.metadata.title;
        const thread = data.thread || {};
        let node = thread.root;
        const guard = new Set();
        while (node) {
          const kids = node.childrenId || [];
          const nextId = kids[kids.length - 1];
          node = nextId && !guard.has(nextId) ? thread[nextId] : null;
          if (!node) break;
          guard.add(node.id);
          const content = (node.content || "").trim();
          if (!content) continue;
          const parts = [NS.normalizeLatexDelimiters(content)];
          // Web citations attached to the turn - append the ones the prose
          // doesn't already link, deduped by url.
          const seen = new Set();
          const cites = (node.attachments || []).filter(a =>
            a?.type === "WEB_ACCESS_GEN_LINK" && a.url && !content.includes(a.url) &&
            !seen.has(a.url) && seen.add(a.url));
          if (cites.length) parts.push(cites.map(a => `[${a.title || a.url}](${a.url})`).join("\n"));
          const entry = { role: node.role === "user" ? "user" : "assistant", markdown: parts.join("\n\n") };
          const t = Date.parse(node.timestamp);
          if (!isNaN(t)) entry.time = t / 1000;
          messages.push(entry);
        }
      }
      return { title, url: location.href, site: "merlin", messages };
    },

    // ── Inline buttons (DOM) ─────────────────────────────────────────────
    //
    // Merlin had no inline support, so the in-chat buttons never appeared.
    // Layout, confirmed live 2026-08-22 (20 turns, 10/10):
    //   article.group/message[data-message-id]     one turn
    //     div (assistant only)                       model name + relative time
    //     div.grid                                   content, then the action row
    //
    // ⚠ Role is layout-only: a user turn is right-aligned (`ml-auto`), an
    // assistant turn is not. Nothing else marks it — there is no data-role, the
    // header carries the MODEL name ("Gemini 2.5 Flash Lite") rather than a
    // role, and its timestamp is localized ("17 minutes ago" / "il y a 17
    // minutes"), so neither can be matched. Cross-check if this ever drifts:
    // only assistant turns render `[data-streamdown]` nodes.
    MERLIN_TURN_SEL: "article.group\\/message[data-message-id]",

    // The action row: `opacity-0` + `group-hover/message:opacity-100`, i.e.
    // revealed when the turn is hovered. `select-none` is what separates it
    // from the citations row, which carries the same hover classes but no
    // buttons.
    MERLIN_BAR_SEL: '[class*="group-hover/message:opacity-100"][class*="select-none"]',

    // ⚠ Our buttons DO fade with Merlin's here, unlike lobehub.js where they
    // are pinned visible. The difference is what sits one level up: LobeHub's
    // action row has a permanently visible parent ON the action line, so ours
    // could be raised into it. Merlin's parent is the CONTENT block — raising
    // them there would print two buttons above the message text. Since every
    // native control on Merlin (copy included) is hover-only, staying in the
    // row matches the site instead of floating loose. The row keeps
    // `pointer-events: auto`, so ours stay clickable the moment they show.
    findMountPoints() {
      const out = [];
      for (const msg of document.querySelectorAll(this.MERLIN_TURN_SEL)) {
        const bar = msg.querySelector(this.MERLIN_BAR_SEL);
        if (bar) out.push({ bar, msg });
      }
      return out;
    },

    findMessages() {
      return document.querySelectorAll(this.MERLIN_TURN_SEL);
    },

    extractOne(el) {
      // The LAST element child is the content block for both roles — which is
      // exactly how the assistant's model/time header gets dropped without
      // having to recognise it (it is the FIRST child, and localized).
      const src = el.lastElementChild || el;
      const clean = src.cloneNode(true);
      // Both hover rows (actions + citations) and anything clickable.
      clean.querySelectorAll(
        '[class*="group-hover/message:opacity-100"], button, [role="button"]'
      ).forEach(n => n.remove());
      const md = NS.htmlToMarkdown(clean);
      if (!md || !md.trim()) return null;
      const out = {
        role: el.classList.contains("ml-auto") ? "user" : "assistant",
        markdown: NS.normalizeLatexDelimiters(md.trim())
      };
      const time = NS.findMessageTime?.(el);
      if (time) out.time = time;
      return out;
    }
  };
})();
