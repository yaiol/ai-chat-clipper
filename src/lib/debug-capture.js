(() => {
  const NS = (globalThis.AiDoc ||= {});

  // Debug capture - the byte-exact ground-truth recorder behind the Developer-
  // mode "Debug bundle" export.
  //
  // Why it exists: extraction bugs live in bytes that copy-paste silently drops
  // (ChatGPT's invisible U+E2xx sentinels around genui directives cost a whole
  // session to find because every pasted repro looked clean). A downloaded file
  // preserves bytes exactly; this module lets every adapter stash its raw API
  // response text as fetched, so the bundle can ship raw -> convo -> output and
  // a bug localizes by diffing stages.
  //
  // ⚠ CLAUDE: adapters read API responses through NS.debug.json(resp, label) /
  // NS.debug.text(resp, label) instead of resp.json()/resp.text() - one shared
  // helper, not per-adapter stashes. The helper reads resp.text() ONCE (a fetch
  // body is single-read), stashes the exact string, then parses/returns. Keep
  // any new adapter fetch on this path.
  const MAX_CAPTURES = 30;   // memory bound; a debug run resets first anyway
  const buf = [];

  NS.debug = {
    // Set when the DOM converter ran — i.e. the page (not just API bytes)
    // contributed to the convo, so the debug bundle must ship page_html.
    domUsed: false,
    markDom() { this.domUsed = true; },
    reset() { buf.length = 0; this.domUsed = false; },
    captures() { return buf.slice(); },
    stash(label, body, extra) {
      try {
        if (buf.length >= MAX_CAPTURES) buf.shift();
        buf.push({ label, at: new Date().toISOString(), ...(extra || {}), body: String(body) });
      } catch { /* capture must never break extraction */ }
    },
    // Read a fetch Response as JSON while stashing its byte-exact text.
    async json(resp, label) {
      const text = await resp.text();
      this.stash(label, text, { status: resp.status, url: resp.url });
      return JSON.parse(text);
    },
    // Read a fetch Response as text while stashing it.
    async text(resp, label) {
      const text = await resp.text();
      this.stash(label, text, { status: resp.status, url: resp.url });
      return text;
    },
  };

  // Developer mode - gates the Debug-bundle button in the popup. Default off.
  NS.getDevMode = async () => (await NS.getLocal("adx_dev_mode", false)) === true;
  NS.setDevMode = (on) => NS.setLocal("adx_dev_mode", !!on);
})();
