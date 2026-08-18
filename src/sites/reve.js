(() => {
  const NS = (globalThis.AiDoc ||= {});
  const sites = (NS.sites ||= {});

  // Reve (app.reve.com) - image-generation app. An album is the user's chat
  // thread with the Reve agent: prompts, agent replies, image generations,
  // and "variate this image" tool calls.
  //
  // We use Reve's `trajectory_event` log as the authoritative chat order.
  // It's the same event stream the Reve UI replays to render the album, so
  // walking it chronologically reproduces exactly what the user sees.
  // The DOM-walk path we tried first only matched what was currently
  // mounted (lazy scroll quirks); events don't have that problem.
  //
  // Event types we care about:
  //   - user_text          → user prompt (free-form text)
  //   - user_variate       → user clicked "create variations" on an image
  //   - agent_text         → agent's text reply (e.g. "I'll create 8 variations…")
  //   - tool_call_result   → with tool_name=create_variations, lists the
  //                          generation node IDs of the resulting images
  //   - user_remove_image  → user deleted an image; we skip it on output
  // Everything else (user_action/unfocus, user_device_info, agent_step_*,
  // agent_execution_*, reference_image, tool_call) is bookkeeping noise
  // and is filtered out.
  //
  // Generation lookup — TWO protocols coexist (verified live 2026-07-22):
  //   - NEW (current): the generation's client_metadata is EMPTY (no
  //     trajectoryId, no turnCreatedAt). Instead the album's event stream
  //     carries an explicit `tool_call_result` with tool_name
  //     "generate_image" whose `result.generation_id` IS the generation
  //     node id — a direct, authoritative join. Album scoping comes from
  //     the event stream itself (trajectory_event is queried by album).
  //   - OLD (pre-2026-07 albums, still in the data): the generation's
  //     `client_metadata.turnCreatedAt` matches the user_text event's
  //     `created_timestamp` exactly (single-image prompts), and each
  //     create_variations tool_call_result lists generation node IDs.
  //   Both paths stay: old albums replay old events, new albums new ones.

  const ALBUM_RE = /^\/albums\/([0-9a-f-]{36})/i;

  // Resolve the album's owning project directly via Reve's own endpoint
  // (/api/misc/resolve_node → { scope_id, scope_type }; scope_id = project id).
  // ⚠ CLAUDE: this REPLACED scanning performance entries for the first
  // /api/project/<uuid>/ request — that was both fragile (buffer rotates) and
  // ambiguous (could pick the wrong project when several loaded). resolve_node
  // is authoritative and is what the app itself calls on load (2026-07-22).
  async function resolveProjectId(albumId) {
    const r = await fetch(`/api/misc/resolve_node?node_id=${albumId}`, { credentials: "include" });
    if (!r.ok) return null;
    const j = await r.json();
    return (j?.scope_type === "project" && j.scope_id) ? j.scope_id : null;
  }

  function getAlbumId() {
    const m = location.pathname.match(ALBUM_RE);
    return m ? m[1] : null;
  }

  async function fetchGenerations(projectId) {
    const url = `/api/project/${projectId}/generation?props=deleted%3Afalse%7Ctrue&count=500`;
    const r = await fetch(url, { credentials: "include" });
    if (!r.ok) throw new Error(`Reve API ${r.status}`);
    const j = await NS.debug.json(r, "reve");
    return (j.list || []).map(item => ({ node: item.node || {}, data: item.data || {} }));
  }

  async function fetchEvents(projectId, albumId) {
    const url = `/api/project/${projectId}/trajectory_event`
      + `?props=deleted%3Afalse%7Ctrue%2Ctrajectory_id%3A${albumId}&count=500`;
    const r = await fetch(url, { credentials: "include" });
    if (!r.ok) throw new Error(`Reve events ${r.status}`);
    const j = await NS.debug.json(r, "reve");
    return (j.list || []).map(item => item.data || {});
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => reject(fr.error || new Error("FileReader failed"));
      fr.readAsDataURL(blob);
    });
  }

  // Re-encode a blob as JPEG via canvas, resizing if larger than MAX_DIM.
  // - Format conversion: Reve serves WebP. Word's altChunk import doesn't
  //   recognise WebP, so the image never renders.
  // - Resize: Reve serves images at native resolution (often 4096px+).
  //   At that size, Word ignores the HTML width=... attribute and lays
  //   the image out at full intrinsic width, overflowing the page. By
  //   scaling down at transcode time, the embedded image is already at
  //   a reasonable size and the width directive is no longer fighting it.
  //   1280px is a good compromise - print-quality at typical document
  //   widths, but a fraction of the original byte count.
  const MAX_DIM = 1280;
  async function reencodeToJpeg(blob) {
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, MAX_DIM / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d").drawImage(bitmap, 0, 0, w, h);
    const jpegBlob = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.9));
    return await blobToDataUrl(jpegBlob);
  }

  // Fetch a Reve image URL and inline it as a base64 data URL - required so
  // cloud destinations without our session cookie (Notion, Drive, Word
  // Online, Nextcloud) can render it. Always transcodes through canvas
  // (JPEG, ≤1280px) for size consistency and broad compatibility.
  async function imageUrlToDataUrl(url) {
    const r = await fetch(url, { credentials: "include" });
    if (!r.ok) throw new Error(`Image fetch ${r.status}`);
    const blob = await r.blob();
    return await reencodeToJpeg(blob);
  }

  // Build an `assistant` message for a single generation.
  async function buildImageMessage(gen, projectId) {
    const d = gen.data;
    const n = gen.node;
    const outputId = d.output;
    if (!outputId) return null;
    const time = d.client_metadata?.turnCreatedAt;
    const imgUrl = `${location.origin}/api/project/${projectId}`
      + `/image/${outputId}/url/filename/${outputId}`;
    let imgSrc;
    try {
      imgSrc = await imageUrlToDataUrl(imgUrl);
    } catch (err) {
      console.warn(NS.TAG, "reve: image fetch failed, falling back to URL", err);
      imgSrc = imgUrl;
    }
    const name = (n.name || "").trim();
    const desc = (n.description || "").trim();
    let md = `![${name.replace(/[\[\]]/g, "")}](${imgSrc})`;
    if (name || desc) {
      md += "\n\n";
      if (name && desc)      md += `**${name}**: ${desc}`;
      else if (name)         md += `**${name}**`;
      else                   md += desc;
    }
    return { role: "assistant", markdown: md, time };
  }

  sites.reve = {
    id: "reve",
    label: "Reve",

    matches(host) {
      return host === "app.reve.com" && ALBUM_RE.test(location.pathname);
    },

    title() {
      return document.title.replace(/\s*-\s*Album\s*$/i, "").trim() || "Reve album";
    },

    async extract() {
      const albumId = getAlbumId();
      if (!albumId) throw new Error("Not on an album page");
      const projectId = await resolveProjectId(albumId);
      if (!projectId) throw new Error("Could not determine Reve project id; refresh the album page and try again");

      const [generations, events] = await Promise.all([
        fetchGenerations(projectId),
        fetchEvents(projectId, albumId),
      ]);

      // Index generations two ways. byNodeId spans ALL live generations —
      // node-id lookups are driven by THIS album's own event stream, so
      // cross-album pollution is impossible (and new-protocol generations
      // carry no trajectoryId to filter on). byTime is the OLD-protocol
      // join and stays scoped to this album via client_metadata. Hidden /
      // deleted generations (agent-made, never shown) are excluded from both.
      const live = generations.filter(g =>
        g.node.hidden === false && g.node.deleted === false);
      const byNodeId = new Map(live.map(g => [g.node.id, g]));
      const byTime   = new Map(live
        .filter(g => g.data.client_metadata?.trajectoryId === albumId)
        .map(g => [g.data.client_metadata?.turnCreatedAt, g]));

      // Sort events chronologically. created_timestamp first, then
      // tiebreaker for events that share a timestamp (within a single turn,
      // multiple events get the same ms-precision timestamp).
      events.sort((a, b) => {
        const t = (a.created_timestamp || "").localeCompare(b.created_timestamp || "");
        if (t !== 0) return t;
        return (a.tiebreaker || 0) - (b.tiebreaker || 0);
      });

      // Collect deletion IDs up front - these refer to generation node IDs
      // the user removed from the gallery. Even if they're still
      // hidden=false in the generation table, we don't emit them.
      const removed = new Set();
      for (const ev of events) {
        if (ev.event_type === "user_remove_image" && ev.data?.image_id) {
          removed.add(ev.data.image_id);
        }
      }

      const messages = [];
      const usedNodeIds = new Set(); // dedupe images that appear in multiple events
      let lastUserText = null;       // dedupe consecutive identical prompts

      for (const ev of events) {
        const t = ev.event_type;

        if (t === "user_text") {
          const text = (ev.data?.text || "").trim();
          if (text && text !== lastUserText) {
            messages.push({ role: "user", markdown: text, time: ev.created_timestamp });
            lastUserText = text;
          }
          // The single-image generation for this prompt is keyed by
          // turnCreatedAt === user_text's created_timestamp.
          const gen = byTime.get(ev.created_timestamp);
          if (gen && !removed.has(gen.node.id) && !usedNodeIds.has(gen.node.id)) {
            const msg = await buildImageMessage(gen, projectId);
            if (msg) { messages.push(msg); usedNodeIds.add(gen.node.id); }
          }
        }

        else if (t === "user_variate") {
          // The user clicked "Create variations" on an image. We surface
          // this as a user message so the chat reads naturally - the
          // following agent_text + tool_call_result will fill in the
          // assistant side.
          const msg = "Create variations of this image";
          if (msg !== lastUserText) {
            messages.push({ role: "user", markdown: msg, time: ev.created_timestamp });
            lastUserText = msg;
          }
        }

        else if (t === "agent_text") {
          const text = (ev.data?.text || "").trim();
          if (text) messages.push({ role: "assistant", markdown: text, time: ev.created_timestamp });
        }

        else if (t === "tool_call_result") {
          // Any tool result that names generation ids produced an image the
          // user saw. Shapes: generate_image → result.generation_id (one id,
          // NEW protocol); create_variations → result.results[].generation_id
          // (list, OLD protocol) or params.generation_ids (older fallback).
          const d = ev.data || {};
          const ids = [];
          if (typeof d.result?.generation_id === "string") ids.push(d.result.generation_id);
          if (Array.isArray(d.result?.results)) ids.push(...d.result.results.map(r => r.generation_id).filter(Boolean));
          if (!ids.length && Array.isArray(d.params?.generation_ids)) ids.push(...d.params.generation_ids);
          for (const id of ids) {
            if (removed.has(id) || usedNodeIds.has(id)) continue;
            const gen = byNodeId.get(id);
            if (!gen) continue;
            const msg = await buildImageMessage(gen, projectId);
            if (msg) { messages.push(msg); usedNodeIds.add(id); }
          }
        }

        // All other event types are bookkeeping noise - skip.
      }

      return {
        title: this.title(),
        url: location.href,
        site: "reve",
        messages,
      };
    },

    // No per-message inline buttons - see top-of-file comment.
  };
})();
