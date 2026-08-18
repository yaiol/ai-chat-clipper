// Nextcloud "exporter".
//
// Nextcloud is content-agnostic: it just stores whatever bytes you PUT.
// So the "exporter" here is a tiny dispatcher that produces { bytes,
// filename, mime } from the convo for the format the user wants to land in
// Nextcloud. Defaults to Markdown - Nextcloud's web UI has a built-in
// Markdown editor that opens .md files inline.
//
// Public:
//   NS.toNextcloud(convo, format='markdown', opts) →
//     { bytes: Uint8Array, filename: string (no path), mime: string }

(() => {
  const NS = (globalThis.AiDoc ||= {});

  function utf8(s) { return new TextEncoder().encode(s); }

  NS.toNextcloud = async function toNextcloud(convo, format, opts) {
    const fmt = format || "markdown";
    switch (fmt) {
      case "markdown":
        return { bytes: utf8(NS.toMarkdown(convo)), ext: "md",   mime: "text/markdown" };
      case "html":
        return { bytes: utf8(NS.toHtml(convo, opts)), ext: "html", mime: "text/html" };
      case "text":
        return { bytes: utf8(NS.toText(convo)), ext: "txt",  mime: "text/plain" };
      case "docx": {
        const bytes = await NS.toDocx(convo, opts);
        return { bytes, ext: "docx", mime: NS.DOCX_MIME };
      }
      case "odt": {
        const bytes = await NS.toOdt(convo);
        return { bytes, ext: "odt",  mime: NS.ODT_MIME };
      }
      default:
        throw new Error("Unsupported Nextcloud format: " + fmt);
    }
  };
})();
