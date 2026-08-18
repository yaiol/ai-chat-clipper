(() => {
  const NS = (globalThis.AiDoc ||= {});
  const sites = (NS.sites ||= {});

  sites.chatgpt = {
    id: "chatgpt",
    label: "ChatGPT",
    matches(host) { return host === "chatgpt.com" || host === "chat.openai.com"; },

    title() {
      return document.title.replace(/\s*[-|]\s*ChatGPT.*$/i, "").trim() || "ChatGPT chat";
    },

    findMessages() {
      return document.querySelectorAll('[data-message-author-role]');
    },

    extractOne(el) {
      const role = el.getAttribute("data-message-author-role");
      const body = el.querySelector('[data-message-id] > div, .markdown, .whitespace-pre-wrap') || el;
      const md = NS.htmlToMarkdown(body);
      if (!md) return null;
      const out = { role: role, markdown: md };
      const time = NS.findMessageTime?.(el);
      if (time) out.time = time;
      return out;
    },

    findMountPoints() {
      const copies = document.querySelectorAll('[data-testid*="copy-turn-action-button"]');
      const out = [];
      for (const c of copies) {
        const bar = c.parentElement;
        const msg = c.closest('[data-message-author-role]')
                 || c.closest('[data-turn]')
                 || c.closest('article');
        if (bar && msg) out.push({ bar, msg });
      }
      return out;
    },

    getConversationId() {
      const m = location.pathname.match(/\/(?:c|g\/[^/]+\/c)\/([0-9a-f-]{8,})/i);
      return m ? m[1] : null;
    },

    getDeviceId() {
      const m = document.cookie.match(/oai-did=([^;]+)/);
      return m ? m[1] : null;
    },

    async getAccessToken() {
      try {
        const r = await fetch("/api/auth/session?unstable_client=true", { credentials: "include" });
        if (!r.ok) return null;
        const j = await NS.debug.json(r, "chatgpt");
        return j?.accessToken || null;
      } catch { return null; }
    },

    async fetchConversation(id) {
      const token = await this.getAccessToken();
      const device = this.getDeviceId();
      if (!token || !device) throw new Error("Missing ChatGPT auth (refresh page and retry).");
      const r = await fetch(`/backend-api/conversation/${id}`, {
        method: "GET",
        credentials: "include",
        headers: {
          "Authorization": `Bearer ${token}`,
          "OAI-Device-Id": device,
          "Accept": "application/json"
        }
      });
      if (!r.ok) throw new Error(`ChatGPT API ${r.status}`);
      return NS.debug.json(r, "chatgpt");
    },

    resolveAssetUrl(assetPointer) {
      if (!assetPointer) return "";
      const id = assetPointer.replace(/^sediment:\/\/file_/, "").replace(/^file-service:\/\//, "");
      try {
        const img = document.querySelector(`img[src*="${id}"]`);
        if (img?.src) return img.src;
      } catch {}
      return "";
    },

    // Serialize an inline <svg> element as a self-contained data: URL so the
    // export can render it outside chatgpt.com. Replaces ChatGPT's CSS custom
    // properties (var(--icon-accent), …) with concrete colors that wouldn't
    // resolve in a standalone document.
    svgToDataUrl(svg) {
      const clone = svg.cloneNode(true);
      if (!clone.getAttribute("xmlns")) clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      let xml = new XMLSerializer().serializeToString(clone);
      xml = xml
        .replace(/var\(--icon-accent\)/g, "#5d6cf0")
        .replace(/var\(--text-primary\)/g, "#222");
      // encodeURIComponent leaves ( and ) unescaped, but markdown image
      // syntax `![](url)` ends at the first unescaped `)`. SVGs with `rgba(…)`
      // would split mid-URL - encode parens manually so the URL stays one
      // contiguous string inside the markdown image.
      const encoded = encodeURIComponent(xml).replace(/\(/g, "%28").replace(/\)/g, "%29");
      return "data:image/svg+xml;utf8," + encoded;
    },

    // Strip the API's custom in-text directives:
    //   genui{"math_block_widget_…":{"content":"<latex>"}}  → $$<latex>$$
    //   entity["category","name","description"]              → name
    // These appear inline in `parts[].text`; without unwrapping they leak
    // into the export verbatim ("genui{…}", 'entity["people","Aristotle",…]').
    cleanDirectives(text, refs) {
      if (!text) return text;
      // ⚠ CLAUDE: ChatGPT wraps content_references spans in INVISIBLE private-use
      // sentinels — U+E200 (span start), U+E201 (span end), U+E202 (mid marker):
      // the live text is  U+E200 genui U+E202 {…} U+E201 . They silently broke
      // the genui strip: `genui\{` can't match with U+E202 between "genui" and
      // "{", and every isolated regex test passed because pasted/copied text
      // drops invisible chars. Strip the sentinel range FIRST. (Found by
      // hexdumping a real export — od -c showed the U+E2xx bytes around the
      // leaked directive.)
      text = text.replace(/[\uE200-\uE2FF]/g, "");
      // Learning-block widgets (genui{"\u2026_learning_block":{"type_id":\u2026}}) carry
      // no formula in the token itself \u2014 the LaTeX lives in the message's
      // metadata content_references[].data.content (content_type
      // "canonical_formula"). Substitute it back as display math BEFORE the
      // generic genui drop below eats the token (which lost the Pythagorean /
      // circle-area / quadratic formulas, debug-bundle capture 2026-07-21).
      for (const ref of refs || []) {
        const latex = ref?.data?.content;
        if (!latex || ref.data.content_type !== "canonical_formula" || !ref.matched_text) continue;
        // matched_text carries the same invisible U+E2xx sentinels as the raw
        // text — strip them too, or it can never match the cleaned text.
        const token = ref.matched_text.replace(/[-]/g, "");
        if (token) text = text.split(token).join("$$" + latex + "$$");
      }
      // Math-widget directive - re-emit as display math so KaTeX renders it.
      let out = text.replace(
        /genui\{"math_block_widget[^"]*":\s*\{\s*"content"\s*:\s*"((?:[^"\\]|\\.)*)"\s*\}\s*\}/g,
        (_, latex) => "$$" + latex.replace(/\\"/g, '"') + "$$"
      );
      // Other genui widgets: drop the directive (their interactive UIs don't
      // map to static export). Permissive match: `genui{…}` non-greedy.
      out = out.replace(/genui\{(?:[^{}]|\{[^{}]*\})*\}/g, "");
      // Bare widget tokens — some widgets render as a single brace-less token,
      // e.g. the clock widget's whole message is literally `genuihmtd`
      // (genui + ref slug; see genui://data/hmtd in the raw). Strip them too;
      // a message left empty is dropped by the caller.
      out = out.replace(/\bgenui[a-z0-9_]{1,40}\b/g, "");
      // Entity mentions - keep only the human-readable name (second JSON field).
      out = out.replace(
        /entity\[\s*"[^"]*"\s*,\s*"((?:[^"\\]|\\.)*)"\s*,\s*"[^"]*"\s*\]/g,
        (_, name) => name.replace(/\\"/g, '"')
      );
      // Normalize LaTeX delimiters (\[…\] → $$, \(…\) → $) so prose math
      // renders — shared code-fence-safe helper in lib/fonts.js.
      return NS.normalizeLatexDelimiters(out);
    },

    // ChatGPT renders interactive math widgets (sliders + SVG visualization)
    // alongside formulas. The API only returns the formula source; the SVG is
    // produced client-side. We harvest each widget's LaTeX + accompanying SVG
    // from the live DOM and insert the SVG markdown image right after the
    // matching `$$…$$` block in the API-derived markdown.
    captureWidgetDrawings(msgEl) {
      if (!msgEl) return [];
      // Each widget visualization is an inline SVG with role="img" + aria-label.
      // Decorative icons (KaTeX sprites, action-bar icons) lack both.
      const svgs = msgEl.querySelectorAll('svg[role="img"][aria-label]');
      const out = [];
      for (const svg of svgs) {
        // Walk up to the widget container, then find its LaTeX annotation.
        // The CSS-module class hash changes on every ChatGPT build, so we
        // anchor on structure: the closest ancestor that contains both the
        // SVG and a `<annotation encoding="application/x-tex">`.
        let container = svg.parentElement;
        let ann = null;
        while (container && container !== document.body) {
          ann = container.querySelector('annotation[encoding="application/x-tex"]');
          if (ann) break;
          container = container.parentElement;
        }
        const tex = (ann?.textContent || "").trim();
        if (!tex) continue;
        out.push({ tex, dataUrl: this.svgToDataUrl(svg) });
      }
      return out;
    },

    applyWidgetDrawings(markdown, drawings) {
      if (!drawings.length) return markdown;
      let out = markdown;
      for (const { tex, dataUrl } of drawings) {
        const escaped = tex.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const re = new RegExp("\\$\\$\\s*" + escaped + "\\s*\\$\\$");
        if (re.test(out)) {
          out = out.replace(re, (m) => `${m}\n\n![](${dataUrl})`);
        } else {
          // Couldn't pair by formula - append at message end so the drawing
          // still ships (rare; happens if the API and DOM render a formula
          // with subtly different LaTeX whitespace).
          out += `\n\n![](${dataUrl})`;
        }
      }
      return out;
    },

    linearizeTree(data) {
      const mapping = data?.mapping || {};
      // Walk via current_node backwards to root, then reverse - active branch.
      const path = [];
      let cur = data.current_node;
      const guard = new Set();
      while (cur && !guard.has(cur)) {
        guard.add(cur);
        path.push(cur);
        cur = mapping[cur]?.parent || null;
      }
      path.reverse();

      const out = [];
      for (const nid of path) {
        const node = mapping[nid];
        const msg = node?.message;
        if (!msg) continue;
        const role = msg.author?.role;
        // ⚠ CLAUDE: "tool" turns must be walked too — image generation (DALL-E)
        // returns the picture as an image_asset_pointer inside a role:"tool"
        // message; skipping tool entirely dropped every generated image (the
        // missing-sheep bug, debug-bundle capture 2026-07-19). Tool TEXT parts
        // stay excluded below — they are internal protocol ("genui_run result
        // of …", '{"skipped_mainline":true}'), never user-facing content.
        if (role !== "user" && role !== "assistant" && role !== "tool") continue;

        const parts = msg.content?.parts || [];
        const chunks = [];

        // User-side attachments from metadata (uploaded images etc.)
        const atts = msg.metadata?.attachments || [];
        for (const a of atts) {
          if (a.mime_type?.startsWith("image/")) {
            const url = this.resolveAssetUrl(a.id || a.asset_pointer);
            if (url) chunks.push(`![${a.name || "image"}](${url})`);
            else if (a.name) chunks.push(`*[attachment: ${a.name}]*`);
          } else if (a.name) {
            chunks.push(`*[attachment: ${a.name}]*`);
          }
        }

        // Parts: string or object. Image objects have content_type "image_asset_pointer".
        // Tool turns contribute IMAGES ONLY (their text is internal protocol).
        for (const p of parts) {
          if (typeof p === "string") {
            if (role !== "tool" && p.trim()) chunks.push(p);
          } else if (p && typeof p === "object") {
            if (p.content_type === "image_asset_pointer" || p.asset_pointer) {
              const url = this.resolveAssetUrl(p.asset_pointer);
              if (url) chunks.push(`![](${url})`);
            } else if (role !== "tool" && typeof p.text === "string" && p.text.trim()) {
              chunks.push(p.text);
            }
          }
        }

        const md = this.cleanDirectives(chunks.join("\n\n"), msg.metadata?.content_references).trim();
        if (md) {
          // A tool turn's image belongs to the assistant's reply in the export.
          const entry = { role: role === "tool" ? "assistant" : role, markdown: md };
          // create_time is Unix seconds (e.g. 1714150123.456). Pass through
          // as a number - formatTime() in html.js handles seconds-vs-ms.
          if (typeof msg.create_time === "number") entry.time = msg.create_time;
          // Preserve the node id so we can find the live DOM element for
          // widget-drawing harvesting; stripped before returning to the
          // exporter (it's not part of the canonical message shape).
          entry._nodeId = nid;
          out.push(entry);
        }
      }
      return out;
    },

    async extract() {
      const title = this.title();
      const id = this.getConversationId();
      if (id) {
        try {
          const data = await this.fetchConversation(id);
          const messages = this.linearizeTree(data);

          // Graft widget drawings (interactive math viz SVGs) from the DOM
          // onto the API-derived markdown. The API doesn't carry the SVG;
          // it's a client-side render of the formula.
          for (const m of messages) {
            if (m.role === "assistant" && m._nodeId) {
              const el = document.querySelector(`[data-message-id="${m._nodeId}"]`);
              if (el) {
                const drawings = this.captureWidgetDrawings(el);
                if (drawings.length) m.markdown = this.applyWidgetDrawings(m.markdown, drawings);
              }
            }
            delete m._nodeId;
          }

          if (messages.length) {
            return {
              title: data.title || title,
              url: location.href,
              site: "chatgpt",
              messages
            };
          }
        } catch (err) {
          console.warn(NS.TAG, "ChatGPT API extract failed, falling back to DOM:", err);
        }
      }
      // DOM fallback (partial - ChatGPT virtualizes offscreen messages)
      const messages = [];
      for (const n of this.findMessages()) {
        const one = this.extractOne(n);
        if (one) messages.push(one);
      }
      return { title, url: location.href, site: "chatgpt", messages };
    }
  };
})();
