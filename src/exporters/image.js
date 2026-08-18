// image (.png) exporter via live screen capture.
//
// Walks the chat container from top to bottom, captures the visible
// viewport at each scroll position, crops each frame to the chat region,
// and stitches the crops vertically into one tall PNG. The result is a
// faithful screenshot of how the live chat looks on the source site -
// site-specific bubbles, fonts, theme, and all.
//
// Key constraints driving the implementation:
//   • `chrome.tabs.captureVisibleTab` lives in the background SW (content
//     scripts can't call it). We round-trip via adx:capture-tab.
//   • The Chrome API rate-limits captures to ~2/sec. We pause between
//     scroll steps to stay under the limit and let new messages render.
//   • Many sites use virtual scrolling (messages disappear from the DOM
//     as they scroll out of view). The capture-per-scroll loop tolerates
//     that - each frame is whatever's painted at that moment.
//   • The chat container varies per site. We find it as the nearest
//     scrollable ancestor of the first message element exposed by the
//     adapter; if none, we scroll the window itself.

(() => {
  const NS = (globalThis.AiDoc ||= {});

  NS.IMAGE_MIME = "image/png";

  // Strip the `data:image/png;base64,` prefix so the result can flow
  // through the existing bytes-as-base64 download path used by docx/odt.
  NS.dataUrlToBase64 = function dataUrlToBase64(dataUrl) {
    const m = /^data:[^;]+;base64,(.+)$/.exec(dataUrl || "");
    return m ? m[1] : "";
  };

  const OVERLAP_PX     = 40;   // overlap between captures (de-dupes sticky edges)
  const SETTLE_MS      = 550;  // wait between scroll + capture (render + API rate)
  const INITIAL_WAIT   = 350;  // wait after scrolling to top before first frame
  const MAX_STEPS      = 200;  // safety against runaway loops

  NS.toImage = async function toImage(adapter) {
    if (!adapter?.findMessages) {
      throw new Error("This site adapter doesn't expose messages for capture.");
    }
    const msgs = [...adapter.findMessages()];
    if (!msgs.length) throw new Error("No messages visible to capture.");

    // Find the scrollable ancestor of the first message. Falls back to
    // window-level scroll when no ancestor reports its own scrollbar.
    const scroller = findScrollableAncestor(msgs[0]);
    const useWindow = !scroller;
    const dpr = window.devicePixelRatio || 1;

    const get = {
      top:    () => useWindow ? window.pageYOffset : scroller.scrollTop,
      max:    () => useWindow
                    ? (document.documentElement.scrollHeight - window.innerHeight)
                    : (scroller.scrollHeight - scroller.clientHeight),
      view:   () => useWindow ? window.innerHeight : scroller.clientHeight,
    };
    const setTop = (y) => useWindow ? window.scrollTo(0, y) : (scroller.scrollTop = y);

    const savedScroll = get.top();
    let savedFocus = null;
    try { savedFocus = document.activeElement; } catch {}

    try {
      // Snap to top.
      setTop(0);
      await sleep(INITIAL_WAIT);
      await raf();

      const frames = [];
      let prevTop = -1;
      let step = 0;

      while (step++ < MAX_STEPS) {
        // Re-query the chat rect each frame - virtualised chats may
        // re-mount messages, shifting the bounds.
        const rect = chatRectInViewport(adapter.findMessages());
        if (!rect) break;

        const cap = await sendCaptureRequest();
        if (!cap?.ok) throw new Error(cap?.error || "Tab capture failed.");

        // Clip the chat rect to the viewport - anything off-screen at
        // the top/bottom of the visible area must not be cropped from
        // the capture (would pull in sticky chrome).
        const clipTop    = Math.max(0, rect.top);
        const clipBottom = Math.min(get.view(), rect.bottom);
        const clipH      = clipBottom - clipTop;
        if (clipH > 0) {
          frames.push({
            dataUrl: cap.dataUrl,
            sx: Math.max(0, rect.left) * dpr,
            sy: clipTop * dpr,
            sw: Math.min(rect.width, window.innerWidth - rect.left) * dpr,
            sh: clipH * dpr,
          });
        }

        const cur = get.top();
        const mx  = get.max();
        if (cur >= mx - 1) break;          // reached the bottom
        if (cur === prevTop) break;        // can't scroll further (stuck)
        prevTop = cur;

        setTop(Math.min(mx, cur + get.view() - OVERLAP_PX));
        await sleep(SETTLE_MS);
      }

      if (!frames.length) throw new Error("Nothing captured - try scrolling so messages are visible first.");

      const dataUrl = await stitchFrames(frames);
      return { dataUrl, base64: NS.dataUrlToBase64(dataUrl) };
    } finally {
      // Restore where the user was.
      setTop(savedScroll);
      if (savedFocus?.focus) try { savedFocus.focus({ preventScroll: true }); } catch {}
    }
  };

  // Single-message screenshot - used by the inline per-message Image
  // entry. Scrolls the element into view, captures the viewport for as
  // many frames as needed to cover the element's height, crops, stitches.
  NS.toImageOne = async function toImageOne(msgEl) {
    if (!msgEl?.getBoundingClientRect) throw new Error("No message to capture.");

    const scroller = findScrollableAncestor(msgEl);
    const useWindow = !scroller;
    const dpr = window.devicePixelRatio || 1;

    const get = {
      top:    () => useWindow ? window.pageYOffset : scroller.scrollTop,
      view:   () => useWindow ? window.innerHeight : scroller.clientHeight,
    };
    const setTop = (y) => useWindow ? window.scrollTo(0, y) : (scroller.scrollTop = y);

    const savedScroll = get.top();
    try {
      // Scroll so the top of the message sits at the top of the viewport.
      msgEl.scrollIntoView({ block: "start", inline: "nearest" });
      await sleep(INITIAL_WAIT);

      const frames = [];
      let step = 0;
      // Total pixel height of the message; we'll fill from the top.
      let capturedHeight = 0;
      const totalNeeded = msgEl.getBoundingClientRect().height;

      while (step++ < MAX_STEPS && capturedHeight < totalNeeded - 2) {
        const rect = msgEl.getBoundingClientRect();
        const clipTop    = Math.max(0, rect.top);
        const clipBottom = Math.min(get.view(), rect.bottom);
        const clipH      = clipBottom - clipTop;
        if (clipH <= 0) break;

        const cap = await sendCaptureRequest();
        if (!cap?.ok) throw new Error(cap?.error || "Tab capture failed.");
        frames.push({
          dataUrl: cap.dataUrl,
          sx: Math.max(0, rect.left) * dpr,
          sy: clipTop * dpr,
          sw: Math.min(rect.width, window.innerWidth - rect.left) * dpr,
          sh: clipH * dpr,
        });
        capturedHeight += clipH;

        if (capturedHeight >= totalNeeded - 2) break;
        // Scroll down by one viewport minus the overlap.
        setTop(get.top() + get.view() - OVERLAP_PX);
        await sleep(SETTLE_MS);
      }

      if (!frames.length) throw new Error("Nothing captured.");
      const dataUrl = await stitchFrames(frames);
      return { dataUrl, base64: NS.dataUrlToBase64(dataUrl) };
    } finally {
      setTop(savedScroll);
    }
  };

  // ── helpers ──────────────────────────────────────────────────────────

  function findScrollableAncestor(el) {
    let n = el?.parentElement;
    while (n && n !== document.documentElement) {
      const cs = getComputedStyle(n);
      const oy = cs.overflowY;
      if ((oy === "auto" || oy === "scroll") && n.scrollHeight > n.clientHeight + 4) return n;
      n = n.parentElement;
    }
    return null;
  }

  function chatRectInViewport(messages) {
    const list = [...messages];
    if (!list.length) return null;
    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
    let any = false;
    for (const m of list) {
      const r = m.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      any = true;
      left = Math.min(left, r.left);
      top  = Math.min(top,  r.top);
      right  = Math.max(right,  r.right);
      bottom = Math.max(bottom, r.bottom);
    }
    if (!any) return null;
    return { left, top, right, bottom, width: right - left, height: bottom - top };
  }

  function sendCaptureRequest() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "adx:capture-tab" }, (resp) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message });
        } else {
          resolve(resp || { ok: false, error: "no response" });
        }
      });
    });
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
  function raf()    { return new Promise(r => requestAnimationFrame(r)); }

  async function stitchFrames(frames) {
    const imgs = await Promise.all(frames.map(f => loadImage(f.dataUrl)));
    const width = Math.max(...frames.map(f => f.sw));
    let height  = 0;
    for (const f of frames) height += f.sh;
    const canvas = document.createElement("canvas");
    canvas.width  = Math.ceil(width);
    canvas.height = Math.ceil(height);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    let y = 0;
    for (let i = 0; i < frames.length; i++) {
      const f = frames[i];
      ctx.drawImage(imgs[i], f.sx, f.sy, f.sw, f.sh, 0, y, f.sw, f.sh);
      y += f.sh;
    }
    return canvas.toDataURL("image/png");
  }

  function loadImage(dataUrl) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload  = () => res(img);
      img.onerror = () => rej(new Error("Could not decode capture frame."));
      img.src = dataUrl;
    });
  }
})();
