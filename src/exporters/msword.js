// Microsoft Word (Word Online) exporter.
//
// Reuses the existing OOXML altChunk pipeline (NS.toDocx) - Word Online
// imports altChunk HTML the same way the desktop Word does, so the upload
// renders with headings, code blocks, lists, and inline images intact.
//
// Public:
//   NS.toMsWord(convo) → { bytes: Uint8Array, mime: DOCX_MIME }

(() => {
  const NS = (globalThis.AiDoc ||= {});

  NS.toMsWord = async function toMsWord(convo, opts) {
    if (!NS.toDocx) throw new Error("toDocx not loaded");
    const bytes = await NS.toDocx(convo, opts);
    return { bytes, mime: NS.DOCX_MIME };
  };
})();
