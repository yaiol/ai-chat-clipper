(() => {
  const NS = (globalThis.AiDoc ||= {});

  // CRC32 lookup table
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      t[i] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  const encoder = new TextEncoder();

  async function deflateRaw(bytes) {
    const cs = new CompressionStream("deflate-raw");
    const writer = cs.writable.getWriter();
    writer.write(bytes);
    writer.close();
    return new Uint8Array(await new Response(cs.readable).arrayBuffer());
  }

  // Creates a ZIP archive in memory.
  // entries: Array<{ name: string, data: string | Uint8Array, store?: boolean }>
  // - store=true forces an uncompressed entry (method 0). Required for ODT's
  //   `mimetype` entry, which must be the first entry and stored.
  NS.createZip = async function createZip(entries) {
    const locals = [];
    const centrals = [];
    let offset = 0;

    for (const e of entries) {
      const nameBytes = encoder.encode(e.name);
      const raw = typeof e.data === "string" ? encoder.encode(e.data) : e.data;
      const stored = !!e.store;
      const payload = stored ? raw : await deflateRaw(raw);
      const method = stored ? 0 : 8;
      const crc = crc32(raw);

      // Local file header (30 + name)
      const localHdr = new Uint8Array(30 + nameBytes.length);
      const lv = new DataView(localHdr.buffer);
      lv.setUint32(0, 0x04034b50, true);    // signature
      lv.setUint16(4, 20, true);            // version needed
      lv.setUint16(6, 0x0800, true);        // flags: UTF-8 filename
      lv.setUint16(8, method, true);        // method (0=stored, 8=DEFLATE)
      lv.setUint16(10, 0, true);            // mod time
      lv.setUint16(12, 0x21, true);         // mod date (1980-01-01)
      lv.setUint32(14, crc, true);
      lv.setUint32(18, payload.length, true);
      lv.setUint32(22, raw.length, true);
      lv.setUint16(26, nameBytes.length, true);
      lv.setUint16(28, 0, true);
      localHdr.set(nameBytes, 30);
      locals.push({ hdr: localHdr, data: payload });

      // Central directory file header (46 + name)
      const cd = new Uint8Array(46 + nameBytes.length);
      const cv = new DataView(cd.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 0x031E, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x0800, true);
      cv.setUint16(10, method, true);
      cv.setUint16(12, 0, true);
      cv.setUint16(14, 0x21, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, payload.length, true);
      cv.setUint32(24, raw.length, true);
      cv.setUint16(28, nameBytes.length, true);
      cv.setUint16(30, 0, true);
      cv.setUint16(32, 0, true);
      cv.setUint16(34, 0, true);
      cv.setUint16(36, 0, true);
      cv.setUint32(38, 0, true);
      cv.setUint32(42, offset, true);
      cd.set(nameBytes, 46);
      centrals.push(cd);

      offset += localHdr.length + payload.length;
    }

    const cdStart = offset;
    let cdSize = 0;
    for (const c of centrals) cdSize += c.length;

    // End of Central Directory Record
    const eocd = new Uint8Array(22);
    const ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(4, 0, true);
    ev.setUint16(6, 0, true);
    ev.setUint16(8, entries.length, true);
    ev.setUint16(10, entries.length, true);
    ev.setUint32(12, cdSize, true);
    ev.setUint32(16, cdStart, true);
    ev.setUint16(20, 0, true);

    const total = cdStart + cdSize + eocd.length;
    const out = new Uint8Array(total);
    let pos = 0;
    for (const l of locals) {
      out.set(l.hdr, pos); pos += l.hdr.length;
      out.set(l.data, pos); pos += l.data.length;
    }
    for (const c of centrals) { out.set(c, pos); pos += c.length; }
    out.set(eocd, pos);
    return out;
  };

  NS.bytesToBase64 = function bytesToBase64(bytes) {
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  };
})();
