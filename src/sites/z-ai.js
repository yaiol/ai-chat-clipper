(() => {
  const NS = (globalThis.AiDoc ||= {});
  const sites = (NS.sites ||= {});

  // Z.ai (chat.z.ai) — Zhipu's GLM chat. An Open WebUI fork.
  // Everything below was probed on a live conversation (2026-08-04).
  //
  // API — GET /api/v1/chats/<id>, conversation URL /c/<uuid>:
  //   cookie-auth (httpOnly session; `credentials:"include"` is enough — a
  //   bearer from localStorage.token is sent when present but is NOT required).
  //   Shape: { id, title, chat: { history: { messages: {<id>: msg}, currentId } } }
  //   msg = { id, parentId, childrenIds, role, timestamp, content, models }.
  //   ⚠ There is NO `chat.messages` array — history+currentId is the only list,
  //   and walking parentId back from currentId is what gives the ACTIVE branch.
  //
  // ⚠ THE API DOCUMENT IS OFTEN INCOMPLETE — this is the trap here. On the live
  //   chat the persisted document held 4 of the 8 rendered turns, and `content`
  //   was present on the FIRST user message only; every other entry had no
  //   `content` key at all while the page rendered its text fine. Persistence
  //   lags the conversation. So a non-empty API result is NOT evidence of a
  //   complete one: `extract()` accepts the API branch only when every message
  //   in it carries text AND it covers at least as many turns as the DOM shows.
  //   Otherwise it falls through to the DOM, which is always current.
  //   The API `title` is trustworthy even when its messages are not, so it is
  //   used for the filename on both paths (document.title is a static brand
  //   string — "Z.ai - Advanced AI Chatbot…" — and carries no chat name).
  //
  // DOM (the working path, verified): #messages-container holds one
  //   div[id="message-<uuid>"] per turn — plus an empty `…-start` anchor twin
  //   that must be excluded. The body is `.chat-user` / `.chat-assistant`
  //   (both `.markdown-prose`), which is also the role marker. Reasoning sits
  //   in `.thinking-chain-container` inside the assistant body.
  //   ⚠ There are NO copy buttons and no aria-labels on the action row, so the
  //   copy-button anchoring other adapters use finds nothing here — don't.

  const TURN_SEL = '#messages-container [id^="message-"]:not([id$="-start"])';
  const BODY_SEL = ".chat-user, .chat-assistant";
  const THINK_SEL = ".thinking-chain-container";

  // ⚠ Code blocks are CodeMirror editors, NOT <pre><code>. Every line is its own
  // `div.cm-line`, so the line breaks are STRUCTURAL — `textContent` on the
  // widget returns one run-on string ("import redef extract_latex(text):…"),
  // which is what turned exported code and ASCII art into mush. The widget also
  // wraps a language-label div and a Copy button, which leaked into the export
  // as stray words ("python", "text").
  // So rewrite each widget, on the CLONE, into the <pre><code class="language-…">
  // the shared converter already knows how to fence.
  function normalizeCodeBlocks(root) {
    for (const ed of [...root.querySelectorAll(".cm-editor")]) {
      const content = ed.querySelector(".cm-content");
      if (!content) continue;
      const lines = [...content.querySelectorAll(".cm-line")].map(l => l.textContent || "");
      if (!lines.length) continue;

      // The widget is the nearest ancestor that also holds the copy button —
      // that is the box carrying the label + toolbar + editor.
      let w = ed, hops = 0;
      while (w && hops++ < 6 && !w.querySelector(".copy-code-button")) w = w.parentElement;
      const target = w || ed;
      const label = (w?.firstElementChild?.textContent || "").trim();

      const doc = root.ownerDocument || document;
      const pre = doc.createElement("pre");
      const code = doc.createElement("code");
      if (/^[\w+#.-]{1,20}$/.test(label)) code.className = `language-${label}`;
      code.textContent = lines.join("\n");
      pre.appendChild(code);
      target.replaceWith(pre);
    }
  }

  // ⚠ The message list renders only a WINDOW of the conversation and grows it as
  // you scroll up — a freshly-loaded long chat holds just the last ~10 turns, so
  // an export taken straight after opening it silently starts mid-conversation.
  // (Nothing is ever removed again once rendered, verified: scrolling a fully
  // rendered chat adds nothing and drops nothing.)
  //
  // So walk the list up until it stops growing. Rules borrowed from the WhatsApp
  // walker, which learned them the hard way:
  //   • find the scroller EMPIRICALLY — does its scrollTop actually move? —
  //     never by computed overflow, which matches the wrong element;
  //   • stop on "did new turns arrive?", never on "did we reach position X?":
  //     prepended content pushes scrollTop back down, so the top is a moving
  //     target and a position test ends the walk at an arbitrary message.
  const QUIET_STEPS = 3;
  const STEP_MS = 300;
  const MAX_STEPS = 60;

  function findScroller() {
    let n = document.querySelector("#messages-container");
    let hops = 0;
    while (n && hops++ < 8) {
      const t0 = n.scrollTop;
      n.scrollTop = t0 - 200;
      if (n.scrollTop !== t0) { n.scrollTop = t0; return n; }
      n.scrollTop = t0 + 200;
      if (n.scrollTop !== t0) { n.scrollTop = t0; return n; }
      n = n.parentElement;
    }
    return null;
  }

  async function loadWholeConversation(countTurns) {
    const scroller = findScroller();
    if (!scroller) return;
    // Remember where the reader was, by element — scrollHeight changes as older
    // turns load, so a numeric scrollTop would not restore the same view.
    const anchor = [...document.querySelectorAll(TURN_SEL)]
      .find(el => el.getBoundingClientRect().bottom > 0) || null;

    let last = countTurns(), quiet = 0, steps = 0;
    while (quiet < QUIET_STEPS && steps++ < MAX_STEPS) {
      scroller.scrollTop -= scroller.clientHeight;
      await new Promise(r => setTimeout(r, STEP_MS));
      const n = countTurns();
      if (n > last) { last = n; quiet = 0; }
      else if (scroller.scrollTop <= 0) quiet++;
    }
    anchor?.scrollIntoView({ block: "start" });
  }

  function bearer() {
    try {
      const t = localStorage.getItem("token");
      if (t) return /^Bearer /i.test(t) ? t : `Bearer ${t}`;
    } catch { /* localStorage may be unavailable */ }
    return null;
  }

  sites["z-ai"] = {
    id: "z-ai",
    label: "Z.ai",
    matches(host) { return host === "chat.z.ai"; },

    title() { return "Z.ai chat"; },

    getConversationId() {
      return location.pathname.match(/\/c\/([A-Za-z0-9_-]+)/)?.[1] || null;
    },

    async fetchChat(id) {
      const headers = { Accept: "application/json" };
      const auth = bearer();
      if (auth) headers.Authorization = auth;
      const r = await fetch(`/api/v1/chats/${encodeURIComponent(id)}`, {
        credentials: "include", headers
      });
      if (!r.ok) throw new Error(`Z.ai API ${r.status}`);
      return NS.debug.json(r, "z-ai");
    },

    // The active branch: walk history.messages back from currentId via parentId.
    // Returns null when the document is incomplete (see the header note).
    linearize(doc, minTurns) {
      const hist = doc?.chat?.history;
      if (!hist?.messages || !hist.currentId) return null;

      const byId = hist.messages;
      const chain = [];
      const seen = new Set();
      let cur = hist.currentId;
      while (cur && byId[cur] && !seen.has(cur)) {
        seen.add(cur);
        chain.push(byId[cur]);
        cur = byId[cur].parentId;
      }
      chain.reverse();
      if (!chain.length) return null;
      if (minTurns && chain.length < minTurns) return null;   // stale document

      const out = [];
      for (const m of chain) {
        const text = typeof m?.content === "string" ? m.content.trim() : "";
        if (!text) return null;                                // partial document
        out.push({ role: m.role === "user" ? "user" : "assistant", markdown: text });
      }
      return out;
    },

    async extract() {
      const id = this.getConversationId();
      let title = this.title();
      let doc = null;
      if (id) {
        try { doc = await this.fetchChat(id); } catch (err) {
          console.warn(NS.TAG, "Z.ai API fetch failed, using DOM:", err);
        }
      }
      const apiTitle = (doc?.title || doc?.chat?.title || "").trim();
      if (apiTitle) title = apiTitle;

      // The API branch, when it is complete, already holds the WHOLE thread —
      // take it before paying for the scroll walk.
      const fromApi = doc ? this.linearize(doc, this.findMessages().length) : null;
      if (fromApi) return { title, url: location.href, site: "z-ai", messages: fromApi };

      // Otherwise the DOM is the source, and it starts out holding only the tail
      // of a freshly-opened conversation — load the rest before reading it.
      await loadWholeConversation(() => this.findMessages().length);

      const messages = [];
      for (const el of this.findMessages()) {
        const one = this.extractOne(el);
        if (one) messages.push(one);
      }
      return { title, url: location.href, site: "z-ai", messages };
    },

    findMessages() {
      return [...document.querySelectorAll(TURN_SEL)].filter(el => el.querySelector(BODY_SEL));
    },

    roleOf(el) {
      return el.querySelector(".chat-user") ? "user" : "assistant";
    },

    extractOne(el) {
      const body = el.querySelector(BODY_SEL);
      if (!body) return null;
      const role = this.roleOf(el);

      // Reasoning first as a `> **Thinking**` blockquote (the convention
      // json.js splits on as a `thinking` segment), then the answer without it.
      // ⚠ The container holds the "Thought Process" TOGGLE as well as the trace,
      // and the trace is collapsed by default — so a naive convert yields a
      // Thinking block containing nothing but the button caption. Drop the
      // buttons first; what remains is empty when the trace is collapsed, and
      // no block is emitted.
      const parts = [];
      const think = body.querySelector(THINK_SEL);
      if (think) {
        const thinkClone = think.cloneNode(true);
        thinkClone.querySelectorAll("button").forEach(n => n.remove());
        normalizeCodeBlocks(thinkClone);
        const thoughtMd = NS.htmlToMarkdown(thinkClone);
        if (thoughtMd) {
          parts.push("> **Thinking**\n" + thoughtMd.split("\n").map(l => `> ${l}`).join("\n"));
        }
      }
      const answerClone = body.cloneNode(true);
      answerClone.querySelectorAll(THINK_SEL).forEach(n => n.remove());
      normalizeCodeBlocks(answerClone);
      const answerMd = NS.htmlToMarkdown(answerClone);
      if (answerMd) parts.push(answerMd);

      const md = parts.join("\n\n").trim();
      if (!md) return null;
      const out = { role, markdown: md };
      const time = NS.findMessageTime?.(el);
      if (time) out.time = time;
      return out;
    },

    // The action row is the parent of the turn's last button — it carries no
    // stable class (Svelte hashes) and no aria-label, so anchor on the button.
    findMountPoints() {
      const out = [];
      for (const msg of this.findMessages()) {
        const btns = msg.querySelectorAll("button");
        const bar = btns.length ? btns[btns.length - 1].parentElement : null;
        out.push({ bar: bar || msg, msg });
      }
      return out;
    }
  };
})();
