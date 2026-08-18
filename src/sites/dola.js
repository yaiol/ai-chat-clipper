(() => {
  const NS = (globalThis.AiDoc ||= {});
  const sites = (NS.sites ||= {});

  // Dola (www.dola.com/chat/<numeric id>) — a ByteDance-stack assistant
  // (`__tea_cache_*` / `ARGUS_XSS_V3` in localStorage, same family as Doubao).
  // Probed on a live guest conversation, 2026-08-04. DOM-only: no conversation
  // endpoint was found, and the page carries everything we need.
  //
  // Turns: `[data-message-id]` — one per message, a real semantic anchor (the
  // only one here; there are no `data-testid`s and every other class is a hashed
  // CSS-module name like `container-enLQFx` that must NOT be anchored on).
  // Body: `.md-box-root` inside the turn — an UNHASHED co-class, so it is stable.
  //
  // ⚠ Role has no semantic marker. The action bars that would carry one
  // (`data-name="send-message-action-bar"` / `receive-…`) are rendered on hover
  // only and are absent from a resting page, so they cannot be used. What is
  // always there is the layout: the user bubble is right-aligned (`justify-end`),
  // the assistant turn is a grid with a trailing action column. That is the
  // messenger convention and it is what roleOf reads; if Dola ever restyles,
  // this is the line to revisit.
  //
  // Code blocks are real `<pre class="language-…"><code>` WITH newlines — the
  // shared converter fences them natively, no rewriting needed. But the widget
  // around them (`[class*="code-block-element"]`) also holds a header with the
  // language name and a **Run** button, which lands in the text as "pythonRun…"
  // if it is not removed first.

  const TURN_SEL = "[data-message-id]";
  // ⚠ Convert the WHOLE turn, not its `.md-box-root`. The md-box holds the prose
  // only — generated pictures are rendered in a sibling container, so scoping to
  // it dropped every image (4 of them in the verified capture), and a turn Dola
  // could not render has no md-box at all. The turn element carries no chrome
  // worth stripping: its action bar is hover-only, and our own injected button
  // is filtered by the converter.
  const CODE_WIDGET_SEL = '[class*="code-block-element"]';

  // Replace each code widget with the bare <pre> it wraps, dropping the
  // language-label + Run header. Runs on the CLONE, never the live page.
  function stripCodeChrome(root) {
    for (const w of [...root.querySelectorAll(CODE_WIDGET_SEL)]) {
      const pre = w.querySelector("pre");
      if (pre) w.replaceWith(pre);
    }
  }

  sites.dola = {
    id: "dola",
    label: "Dola",
    matches(host) { return host === "www.dola.com" || host === "dola.com"; },

    title() {
      // document.title = "<chat title> - Dola"
      return document.title.replace(/\s*[-–—]\s*Dola\s*$/i, "").trim() || "Dola chat";
    },

    getConversationId() {
      return location.pathname.match(/\/chat\/(\d+)/)?.[1] || null;
    },

    // ⚠ Do NOT filter on `.md-box-root`. Dola renders a turn it cannot display
    // in the web client — a web-search answer, an app-only message type — as a
    // bare "Unsupported message type" div with no md-box. Requiring the md-box
    // dropped those turns SILENTLY, so an export skipped whole answers and still
    // read as complete (verified against a Debug bundle: 12 turns in the page,
    // 10 in the export, with three user prompts left hanging). Every turn is
    // exported; a placeholder one carries Dola's own wording, which is exactly
    // what the reader sees on the page.
    findMessages() {
      return [...document.querySelectorAll(TURN_SEL)];
    },

    roleOf(el) {
      return /\bjustify-end\b/.test((el.className || "").toString()) ? "user" : "assistant";
    },

    extractOne(el) {
      const clone = el.cloneNode(true);
      stripCodeChrome(clone);
      const md = NS.htmlToMarkdown(clone);
      if (!md) return null;
      const out = { role: this.roleOf(el), markdown: md };
      const time = NS.findMessageTime?.(el);
      if (time) out.time = time;
      return out;
    },

    async extract() {
      const messages = [];
      for (const el of this.findMessages()) {
        const one = this.extractOne(el);
        if (one) messages.push(one);
      }
      return { title: this.title(), url: location.href, site: "dola", messages };
    },

    // ⚠ Dola's action row lives OUTSIDE the turn element. `[data-message-id]`
    // holds only the message body — querying it for buttons finds nothing, which
    // is what made this look hover-only at first and produced two wrong mounts
    // (buttons prepended over the first line of the answer, and a set on the
    // user's own prompt). The row is `.message-action-button-main`, a descendant
    // of the turn's PARENT, present at rest: verified on a live chat, one turn
    // and exactly one row per parent, 4 buttons on a user row, 7 on an assistant
    // one. So anchor on it like every other adapter does and let the shared
    // mount prepend into it — our buttons then sit in Dola's own row rather than
    // on a second strip of their own.
    findMountPoints() {
      const out = [];
      for (const msg of this.findMessages()) {
        // Assistant turns only — findMessages() deliberately returns every turn
        // (see its comment), and you export a reply, not your own prompt.
        if (this.roleOf(msg) !== "assistant") continue;
        const bar = msg.parentElement?.querySelector(".message-action-button-main");
        if (bar) out.push({ bar, msg });
      }
      return out;
    }
  };
})();
