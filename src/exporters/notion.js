// Notion exporter.
//
// Converts a canonical convo into the page payload the background uploader
// sends to Notion. Returns:
//   { parent: { page_id }, properties: { title }, children: block[], extras: block[][] }
//
// The first 100 children go in the create-page request. `extras` is an
// array of additional batches of ≤100 blocks each, appended via
// PATCH /v1/blocks/{pageId}/children. The background handler walks both.

(() => {
  const NS = (globalThis.AiDoc ||= {});

  const MAX_CHILDREN_PER_REQUEST = 100;

  function chunk(arr, size) {
    const out = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  }

  function roleHeading(role, time, aiName) {
    const label = role === "user" ? "User" : (aiName || "Assistant");
    const text = time ? `${label} - ${time}` : label;
    // Use heading_2 so the page title (h1 visually) stays distinct.
    return { object: "block", type: "heading_2", heading_2: {
      rich_text: [{ type: "text", text: { content: text } }]
    }};
  }

  function divider() {
    return { object: "block", type: "divider", divider: {} };
  }

  // Source line - paragraph with "Source: <site>" where the label is a
  // clickable link to convo.url. Mirrors what exporters/html.js renders
  // when opts.showSource is true.
  function sourceParagraph(convo) {
    const label = convo.site || convo.url || "";
    const rt = [{ type: "text", text: { content: "Source: " } }];
    if (convo.url) {
      rt.push({
        type: "text",
        text: { content: label, link: { url: convo.url } },
      });
    } else {
      rt.push({ type: "text", text: { content: label } });
    }
    return { object: "block", type: "paragraph", paragraph: { rich_text: rt } };
  }

  // Build the full block list for the convo. Each message: heading + blocks +
  // trailing divider (omitted after the last message). Image markdown is
  // handled inside markdownToBlocks: standalone `![alt](url)` lines become
  // real image blocks (data URLs marked for upload by background.js,
  // http/https URLs used as `external` directly).
  // opts: { showSource: bool, showTime: bool }
  function buildBlocks(convo, opts = {}) {
    if (!NS.markdownToBlocks) throw new Error("markdownToBlocks not loaded");
    const blocks = [];
    if (opts.showSource && (convo.url || convo.site)) {
      blocks.push(sourceParagraph(convo));
      blocks.push(divider());
    }
    const aiName = NS.siteName?.(convo.site) || "Assistant";
    const messages = convo.messages || [];
    messages.forEach((m, idx) => {
      blocks.push(roleHeading(m.role, opts.showTime ? m.time : undefined, aiName));
      const body = NS.markdownToBlocks(m.markdown || "");
      blocks.push(...body);
      if (idx < messages.length - 1) blocks.push(divider());
    });
    return blocks;
  }

  // Public: build the upload plan. Background handler does the HTTP.
  NS.toNotion = function toNotion(convo, parentPageId, opts) {
    const allBlocks = buildBlocks(convo, opts);
    const batches = chunk(allBlocks, MAX_CHILDREN_PER_REQUEST);
    const firstBatch = batches.shift() || [];
    return {
      parent: { page_id: parentPageId },
      properties: {
        title: { title: [{ type: "text", text: { content: convo.title || NS.APP_NAME } }] },
      },
      children: firstBatch,
      extras: batches, // additional [block[], block[], ...] to append after creation
    };
  };
})();
