// best-effort timestamp extractor for DOM-only adapters.
//
// Most chat UIs hide message timestamps but still encode them somewhere in
// the DOM - typically one of:
//
//   1. <time datetime="2026-04-26T12:34Z">…
//   2. title="2026-04-26 12:34"     (hover tooltip)
//   3. aria-label="Sent at 12:34 PM"
//
// We try them in that order, returning the first parseable value as an ISO
// string. Returns null if none of the heuristics match - Show Chat Time will
// then simply skip that message, which is the right behavior (no fake data).

(() => {
  const NS = (globalThis.AiDoc ||= {});

  function tryParseDate(s) {
    if (typeof s !== "string" || !s.trim()) return null;
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }

  // Keywords (en + fr + es + de + it) that often precede a relative or
  // absolute time string in aria-labels - used to filter out unrelated
  // labels like "Edit message" before parsing.
  const TIME_HINTS = /\b(sent|posted|on|at|le|à|el|um|alle|on)\b|\d:\d|\d{4}/i;

  NS.findMessageTime = function findMessageTime(el) {
    if (!el) return null;

    // 1. <time datetime="…"> anywhere inside
    const tEl = el.querySelector?.("time[datetime]");
    if (tEl) {
      const iso = tryParseDate(tEl.getAttribute("datetime"));
      if (iso) return iso;
    }

    // 2. title="…" - only on small inline elements (typically <span> tooltips)
    //    so we don't accidentally pick up e.g. an image's `title="alt text"`.
    const titled = el.querySelectorAll?.("[title]") || [];
    for (const node of titled) {
      const tag = (node.tagName || "").toLowerCase();
      if (tag === "img" || tag === "a") continue;
      const iso = tryParseDate(node.getAttribute("title"));
      if (iso) return iso;
    }

    // 3. aria-label="…" - gated on TIME_HINTS so we don't parse labels like
    //    "Copy" or "Edit". Strip leading prepositions before parsing.
    const aria = el.querySelectorAll?.("[aria-label]") || [];
    for (const node of aria) {
      const label = node.getAttribute("aria-label") || "";
      if (!TIME_HINTS.test(label)) continue;
      const cleaned = label.replace(/^[A-Za-zÀ-ÿ ]{1,30}?(?=\d)/, "").trim();
      const iso = tryParseDate(cleaned) || tryParseDate(label);
      if (iso) return iso;
    }

    return null;
  };
})();
