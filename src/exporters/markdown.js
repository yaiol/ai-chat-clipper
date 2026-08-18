(() => {
  const NS = (globalThis.AiDoc ||= {});

  NS.toMarkdown = function toMarkdown(convo) {
    const assistantName = NS.siteName?.(convo.site) || "Assistant";
    const lines = [];
    lines.push(`# ${convo.title}`);
    lines.push("");
    lines.push(`*Source: [${convo.site}](${convo.url})*`);
    lines.push("");
    for (const m of convo.messages) {
      const label = m.role === "user" ? "User"
                  : m.role === "assistant" ? assistantName
                  : m.role;
      lines.push(`## ${label}`);
      lines.push("");
      lines.push(m.markdown);
      lines.push("");
    }
    return lines.join("\n");
  };

  NS.safeFilename = function safeFilename(title) {
    return (title || "chat")
      .replace(/[\\/:*?"<>|]+/g, "-")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120) || "chat";
  };
})();
