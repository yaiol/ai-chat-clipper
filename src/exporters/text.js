(() => {
  const NS = (globalThis.AiDoc ||= {});

  function stripMarkdown(md) {
    let t = md || "";
    // Fenced code blocks → unwrap, keep content
    t = t.replace(/```[^\n]*\n([\s\S]*?)```/g, (_, body) => body.replace(/\n$/, ""));
    // Inline code
    t = t.replace(/`([^`\n]+)`/g, "$1");
    // Images: ![alt](url) → [image: alt]
    t = t.replace(/!\[([^\]]*)\]\([^)\s]+(?:\s+"[^"]*")?\)/g, (_, alt) => alt ? `[image: ${alt}]` : "[image]");
    // Links: [text](url) → "text (url)"
    t = t.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, "$1 ($2)");
    // Bold / italic / strike
    t = t.replace(/\*\*([^*\n]+)\*\*/g, "$1");
    t = t.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?:;]|$)/g, "$1$2");
    t = t.replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,!?:;]|$)/g, "$1$2");
    t = t.replace(/~~([^~\n]+)~~/g, "$1");
    // Headings → strip the hashes
    t = t.replace(/^#{1,6}\s+/gm, "");
    // Blockquote markers → "| " for visual indent
    t = t.replace(/^\s*>\s?/gm, "| ");
    // Horizontal rules
    t = t.replace(/^\s*(-{3,}|_{3,}|\*{3,})\s*$/gm, "------------------------------");
    // Collapse excessive blank lines
    t = t.replace(/\n{3,}/g, "\n\n");
    return t.trim();
  }

  NS.toText = function toText(convo) {
    const aiName = NS.siteName?.(convo.site) || "Assistant";
    const title = convo.title || `${aiName} chat`;
    const lines = [];
    lines.push(title);
    lines.push("=".repeat(Math.min(title.length, 80)));
    lines.push("");
    lines.push(`Source: ${convo.url}`);
    lines.push("");
    for (const m of convo.messages) {
      const label = m.role === "user" ? "User"
                  : m.role === "assistant" ? aiName
                  : m.role;
      lines.push(`--- ${label} ---`);
      lines.push("");
      lines.push(stripMarkdown(m.markdown));
      lines.push("");
    }
    return lines.join("\n");
  };
})();
