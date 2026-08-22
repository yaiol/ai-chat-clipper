// single source of truth for the AI site directory.
// Both popup.js (renders the favicon grid) and options.js (renders the
// visibility checklist) read from AiDoc.SITES.
//
// To add a new site, append a row here AND register a content-script
// adapter under sites/<id>.js - nothing else needs editing.

(() => {
  const NS = (globalThis.AiDoc ||= {});

  NS.SITES = [
    { id: "chatgpt",           label: "ChatGPT",                url: "https://chatgpt.com/",            hosts: ["chatgpt.com", "chat.openai.com"], icon: "assets/sites/chatgpt.svg" },
    { id: "claude",            label: "Claude",                 url: "https://claude.ai/",              hosts: ["claude.ai"], icon: "assets/sites/claude.svg" },
    { id: "google-gemini",     label: "Google Gemini",          url: "https://gemini.google.com/",      hosts: ["gemini.google.com"], icon: "assets/sites/google-gemini.svg" },
    { id: "copilot",           label: "Copilot",                url: "https://copilot.microsoft.com/",  hosts: ["copilot.microsoft.com"], icon: "assets/sites/copilot.svg" },
    { id: "deepseek",          label: "DeepSeek",               url: "https://chat.deepseek.com/",      hosts: ["chat.deepseek.com"], icon: "assets/sites/deepseek.svg" },
    { id: "duckduckgo",        label: "DuckDuckGo AI Chat",     url: "https://duckduckgo.com/aichat",   hosts: ["duckduckgo.com"], icon: "assets/sites/duckduckgo.svg" },
    { id: "grok",              label: "Grok",                   url: "https://grok.com/",               hosts: ["grok.com", "www.grok.com"], icon: "assets/sites/grok.svg" },
    { id: "grok-x",            label: "Grok on X",              url: "https://x.com/i/grok",            hosts: ["x.com"], icon: "assets/sites/grok-x.svg" },
    { id: "perplexity",        label: "Perplexity",             url: "https://www.perplexity.ai/",      hosts: ["www.perplexity.ai", "perplexity.ai"], icon: "assets/sites/perplexity.svg" },
    { id: "mistral",           label: "Mistral",                url: "https://chat.mistral.ai/",        hosts: ["chat.mistral.ai"], icon: "assets/sites/mistral.svg" },
    { id: "kimi",              label: "Kimi",                   url: "https://www.kimi.ai/",            hosts: ["www.kimi.ai", "kimi.ai", "www.kimi.com", "kimi.com", "kimi.moonshot.cn"], icon: "assets/sites/kimi.svg" },
    { id: "pi",                label: "Pi",                     url: "https://pi.ai/",                  hosts: ["pi.ai", "www.pi.ai"], icon: "assets/sites/pi.svg" },
    { id: "poe",               label: "Poe",                    url: "https://poe.com/",                hosts: ["poe.com", "www.poe.com"], icon: "assets/sites/poe.svg" },
    { id: "meta-ai",           label: "Meta AI",                url: "https://www.meta.ai/",            hosts: ["www.meta.ai", "meta.ai"], icon: "assets/sites/meta-ai.svg" },
    { id: "yuanbao",           label: "Yuanbao",                url: "https://yuanbao.tencent.com/",    hosts: ["yuanbao.tencent.com"], icon: "assets/sites/yuanbao.svg" },
    { id: "google-notebooklm", label: "Google Gemini Notebook", url: "https://notebooklm.google.com/",  hosts: ["notebooklm.google.com"], icon: "assets/sites/google-notebooklm.svg" },
    { id: "google-aistudio",   label: "Google AI Studio",       url: "https://aistudio.google.com/",    hosts: ["aistudio.google.com"], icon: "assets/sites/google-aistudio.svg" },
    { id: "github-copilot",    label: "GitHub Copilot",         url: "https://github.com/copilot",      hosts: ["github.com"], icon: "assets/sites/github-copilot.svg" },
    { id: "huggingchat",       label: "HuggingChat",            url: "https://huggingface.co/chat",     hosts: ["huggingface.co"], icon: "assets/sites/huggingchat.svg" },
    { id: "groq",              label: "Groq",                   url: "https://chat.groq.com/",          hosts: ["chat.groq.com"], icon: "assets/sites/groq.svg" },
    { id: "google-aisearch",   label: "Google Search AI Mode",  url: "https://www.google.com/search?udm=50",         hosts: ["www.google.com", "google.com"], icon: "assets/sites/google-aisearch.svg" },
    { id: "google-search",     label: "Google Search",          url: "https://www.google.com/",           hosts: ["www.google.com", "google.com"], icon: "assets/sites/google-search.svg" },
    { id: "minimax",           label: "MiniMax",                url: "https://agent.minimax.io/",       hosts: ["agent.minimax.io"], icon: "assets/sites/minimax.svg" },
    { id: "qwen",              label: "Qwen",                   url: "https://chat.qwen.ai/",           hosts: ["chat.qwen.ai"], icon: "assets/sites/qwen.svg" },
    { id: "reve",              label: "Reve",                   url: "https://app.reve.com/",           hosts: ["app.reve.com"], icon: "assets/sites/reve.svg" },
    { id: "lobehub",           label: "LobeHub",                url: "https://app.lobehub.com/",        hosts: ["app.lobehub.com"], icon: "assets/sites/lobehub.svg" },
    { id: "merlin",            label: "Merlin",                 url: "https://www.getmerlin.in/",       hosts: ["www.getmerlin.in", "getmerlin.in"], icon: "assets/sites/merlin.svg" },
    { id: "z-ai",              label: "Z.ai",                   url: "https://chat.z.ai/",             hosts: ["chat.z.ai"], icon: "assets/sites/z-ai.svg" },
    { id: "dola",              label: "Dola",                   url: "https://www.dola.com/chat/",     hosts: ["www.dola.com", "dola.com"], icon: "assets/sites/dola.png" },
    { id: "copilot-m365",      label: "M365 Copilot",           url: "https://m365.cloud.microsoft/chat", hosts: ["m365.cloud.microsoft"], icon: "assets/sites/copilot-m365.svg" },
    { id: "chatglm",           label: "ChatGLM",                url: "https://chatglm.cn/",             hosts: ["chatglm.cn", "www.chatglm.cn"], icon: "assets/sites/chatglm.svg" },
    { id: "arena",             label: "Arena",                  url: "https://arena.ai/",               hosts: ["arena.ai", "www.arena.ai"], icon: "assets/sites/arena.svg" },
  ];

  // The site's display name, for the "<name> said:" label every exporter writes.
  // ⚠ This is the ONLY source of that string. Each exporter used to carry its own
  // copy of an id→name map — six of them, and every one had drifted: none listed
  // z-ai, dola, chatglm, arena, copilot-m365, lobehub or merlin, so exporting
  // from any of those labelled every reply "Assistant". The label lives here,
  // beside the id it belongs to, and nowhere else.
  NS.siteName = function siteName(id) {
    return NS.SITES.find(s => s.id === id)?.label || "Assistant";
  };

  // Storage keys - chrome.storage.local, shared by popup and options.
  NS.STORAGE = Object.assign(NS.STORAGE || {}, {
    SITE_ORDER:    "adx_site_order",     // array of ids - drag-reorder result
    HIDDEN_SITES:  "adx_hidden_sites",   // array of ids the user hid (default: empty)
  });

  // Storage helpers (NS.getLocal / NS.setLocal) live in lib/storage.js.

  NS.getOrder    = ()   => NS.getLocal(NS.STORAGE.SITE_ORDER,    null);
  NS.setOrder    = (ids) => NS.setLocal(NS.STORAGE.SITE_ORDER,    ids);
  NS.getHidden   = ()   => NS.getLocal(NS.STORAGE.HIDDEN_SITES,  []);
  NS.setHidden   = (ids) => NS.setLocal(NS.STORAGE.HIDDEN_SITES,  ids);

  // Generic drag-and-drop for a flat list of items inside `container`.
  // Each draggable row must match `selector` and carry `data-id`.
  // After a drop completes, `onReorder(idsInNewOrder)` is invoked.
  //
  // Used by both popup (favicon grid) and options (checklist with checkboxes).
  // The container gets CSS classes `dragging` / `drag-over` on the relevant
  // rows so each caller can style the feedback to match its own layout.
  //
  // `zones` are drop targets OUTSIDE the container — `[{ el, onDrop(id) }]`.
  // A reorder can only ever move a row among the rows currently rendered, which
  // in a paginated list means "within this page"; a zone is how a caller offers
  // the move the list itself cannot express. The popup passes its pager arrows,
  // so dropping a tile on one sends it to that page. An armed zone gets
  // `drag-zone` for the whole drag and `drag-over` while hovered; a DISABLED
  // zone is never armed (and browsers dispatch no drag events on it anyway), so
  // "next page" on the last page silently refuses, which is the wanted answer.
  NS.enableSiteDnd = function enableSiteDnd(container, selector, onReorder, zones = []) {
    let dragged = null;

    const clearZones = () => {
      for (const z of zones) z.el.classList.remove("drag-zone", "drag-over");
    };

    container.addEventListener("dragstart", (e) => {
      const row = e.target.closest(selector);
      if (!row) return;
      dragged = row;
      row.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", row.dataset.id);
      for (const z of zones) if (!z.el.disabled) z.el.classList.add("drag-zone");
    });

    container.addEventListener("dragend", () => {
      if (dragged) dragged.classList.remove("dragging");
      container.querySelectorAll(".drag-over").forEach(el => el.classList.remove("drag-over"));
      clearZones();
      dragged = null;
    });

    for (const z of zones) {
      z.el.addEventListener("dragover", (e) => {
        if (!dragged) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        z.el.classList.add("drag-over");
      });
      z.el.addEventListener("dragleave", () => z.el.classList.remove("drag-over"));
      z.el.addEventListener("drop", (e) => {
        if (!dragged) return;
        e.preventDefault();
        e.stopPropagation();                 // not a reorder — the zone owns this drop
        const id = dragged.dataset.id;
        dragged.classList.remove("dragging");
        clearZones();
        dragged = null;
        z.onDrop(id);
      });
    }

    container.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      const target = e.target.closest(selector);
      container.querySelectorAll(".drag-over").forEach(el => {
        if (el !== target) el.classList.remove("drag-over");
      });
      if (target && target !== dragged) target.classList.add("drag-over");
    });

    container.addEventListener("drop", (e) => {
      e.preventDefault();
      const target = e.target.closest(selector);
      if (!target || !dragged || target === dragged) return;
      const children = Array.from(container.children);
      const draggedBefore = children.indexOf(dragged) < children.indexOf(target);
      target.parentNode.insertBefore(dragged, draggedBefore ? target.nextSibling : target);
      const ids = Array.from(container.querySelectorAll(selector)).map(el => el.dataset.id);
      onReorder(ids);
    });
  };
})();
