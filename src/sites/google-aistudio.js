(() => {
  const NS = (globalThis.AiDoc ||= {});
  const sites = (NS.sites ||= {});

  // Google AI Studio (MakerSuite) renders each turn with Angular custom
  // elements: every markdown node is wrapped in <ms-cmark-node>, code lives in
  // <ms-code-block> (a mat-expansion-panel with a toolbar), math in <ms-katex>
  // (KaTeX with the source in <annotation encoding="application/x-tex">), and
  // model reasoning in <ms-thought-chunk>. Toolbar/action glyphs are Material
  // Symbols ligatures whose text IS the icon name ("content_copy", "download",
  // "expand_less", …). A naive htmlToMarkdown pass therefore (a) drops every
  // list and table — <ul>/<tr> hold an <ms-cmark-node>, not <li>/<td> — (b)
  // triples math into rendered glyphs, (c) loses code fences' language, and
  // (d) leaks icon-name and "User"/"Model"/timestamp chrome.
  //
  // The full API needs an OAuth token + x-goog-api-key intercepted from
  // webRequest (same as NotebookLM), not implemented; so we normalize the
  // rendered DOM on a CLONE before converting: recover math + code, strip
  // chrome, then unwrap the <ms-cmark-node> wrappers so ordinary
  // ul>li / table>tr>td relationships return.

  // ms-katex → $tex$ / $$tex$$ from the annotation source.
  function convertKatex(root) {
    for (const k of root.querySelectorAll("ms-katex")) {
      const tex = (k.querySelector('annotation[encoding="application/x-tex"]')?.textContent || "").trim();
      if (!tex) { k.remove(); continue; }
      const display = (k.className || "").toString().includes("display");
      k.replaceWith(root.ownerDocument.createTextNode(display ? `$$${tex}$$` : `$${tex}$`));
    }
  }

  // ms-code-block → a clean <pre><code class="language-…"> so htmlToMarkdown's
  // pre handler emits a fenced block. Language comes from the toolbar's
  // .title-text label; the raw code is the inner <pre><code> text.
  function convertCodeBlocks(root) {
    const doc = root.ownerDocument;
    for (const cb of root.querySelectorAll("ms-code-block")) {
      const lang = (cb.querySelector(".title-text")?.textContent || "").trim().toLowerCase();
      const src = cb.querySelector("pre code") || cb.querySelector("pre");
      const code = src ? src.textContent.replace(/\n$/, "") : "";
      // AI Studio sometimes renders a nested fence as a second, empty widget —
      // drop those so they don't emit a stray blank ``` block.
      if (!code.trim()) { cb.remove(); continue; }
      const pre = doc.createElement("pre");
      const codeEl = doc.createElement("code");
      if (lang && lang !== "text") codeEl.className = `language-${lang}`;
      codeEl.textContent = code;
      pre.appendChild(codeEl);
      cb.replaceWith(pre);
    }
  }

  // Remove Material Symbols icon ligatures + turn chrome (action bar, footer,
  // author label/timestamp, thought-panel headers, raw svg/style).
  function stripChrome(root) {
    root.querySelectorAll(
      ".material-symbols-outlined, .material-icons, mat-icon, " +
      ".actions-container, .turn-footer, .author-label, " +
      "mat-expansion-panel-header, svg, style, script"
    ).forEach(n => n.remove());
  }

  // Replace every <ms-cmark-node> (and the chunk wrappers) with its children so
  // list/table structure is direct-child again. Iterates because they nest.
  function unwrap(root, selector) {
    let n, guard = 0;
    while ((n = root.querySelector(selector)) && guard++ < 20000) {
      n.replaceWith(...n.childNodes);
    }
  }

  // Convert a live content node to markdown via a cleaned clone.
  function nodeToMarkdown(node) {
    if (!node) return "";
    const clone = node.cloneNode(true);
    convertKatex(clone);
    convertCodeBlocks(clone);
    stripChrome(clone);
    unwrap(clone, "ms-cmark-node, ms-text-chunk, ms-prompt-chunk");
    return NS.htmlToMarkdown(clone);
  }

  sites["google-aistudio"] = {
    id: "google-aistudio",
    label: "AI Studio",
    matches(host) { return host === "aistudio.google.com"; },

    title() {
      return document.title.replace(/\s*[-|]\s*(Google\s*)?AI\s*Studio.*$/i, "").trim() || "AI Studio chat";
    },

    getConversationId() {
      return location.pathname.match(/\/prompts\/([A-Za-z0-9_-]+)/)?.[1] || null;
    },

    findMessages() {
      return document.querySelectorAll("ms-chat-turn");
    },

    roleOf(el) {
      const r = (el.querySelector("[data-turn-role]")?.getAttribute("data-turn-role") || "").toLowerCase();
      return r === "user" ? "user" : "assistant";
    },

    extractOne(el) {
      const role = this.roleOf(el);
      const chunk = el.querySelector("ms-prompt-chunk") || el.querySelector(".turn-content") || el;

      // Separate reasoning from the answer: pull thought chunks first, render
      // them as a `> **Thinking**` blockquote (the convention json.js splits on
      // as a `thinking` segment), then convert the remaining answer body.
      const parts = [];
      const thoughts = [...chunk.querySelectorAll("ms-thought-chunk")];
      if (thoughts.length) {
        const thoughtMd = thoughts.map(nodeToMarkdown).filter(Boolean).join("\n\n");
        if (thoughtMd) {
          parts.push("> **Thinking**\n" + thoughtMd.split("\n").map(l => `> ${l}`).join("\n"));
        }
      }

      // Answer = the chunk minus the thought subtrees.
      const answerClone = chunk.cloneNode(true);
      answerClone.querySelectorAll("ms-thought-chunk").forEach(n => n.remove());
      const answerMd = nodeToMarkdown(answerClone);
      if (answerMd) parts.push(answerMd);

      const md = parts.join("\n\n").trim();
      if (!md) return null;
      const out = { role, markdown: md };
      const time = NS.findMessageTime?.(el);
      if (time) out.time = time;
      return out;
    },

    async extract() {
      const title = this.title();
      const messages = [];
      for (const el of this.findMessages()) {
        const one = this.extractOne(el);
        if (!one) continue;
        // A model response can render as two consecutive turns (thoughts, then
        // answer). Merge consecutive assistant turns into one message so the
        // reasoning and its answer stay together (matches the reference export).
        const prev = messages[messages.length - 1];
        if (prev && prev.role === "assistant" && one.role === "assistant") {
          prev.markdown = `${prev.markdown}\n\n${one.markdown}`.trim();
        } else {
          messages.push(one);
        }
      }
      return { title, url: location.href, site: "google-aistudio", messages };
    },

    findMountPoints() {
      const turns = document.querySelectorAll("ms-chat-turn");
      const out = [];
      for (const turn of turns) {
        const bar = turn.querySelector(
          'ms-chat-turn-options, [class*="turn-actions" i], [class*="actions" i] mat-icon-button, .actions-container, .chat-turn-options'
        ) || turn.querySelector('button[aria-label*="Copy" i]')?.parentElement;
        if (!bar || bar.dataset.adxMounted) continue;
        out.push({ bar, msg: turn });
      }
      return out;
    }
  };
})();
