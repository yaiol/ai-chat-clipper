(() => {
  const NS = (globalThis.AiDoc ||= {});
  NS.getAdapter = function getAdapter() {
    const host = location.host;
    for (const a of Object.values(NS.sites || {})) {
      if (a.matches(host)) return a;
    }
    return null;
  };
})();
