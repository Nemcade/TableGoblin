const fs = require("node:fs"), path = require("node:path"), { createHash, randomUUID } = require("node:crypto");
const MAX_FILE = 64 * 1024 * 1024, MAX_ROOM = 512 * 1024 * 1024, MAX_FILES = 512;
const types = { mp4: "video/mp4", webm: "video/webm", mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", flac: "audio/flac", aac: "audio/aac" };
const declaredTypes = { ...Object.fromEntries(Object.entries(types).map(([ext, type]) => [type, ext])), "audio/mp4": "mp4", "audio/webm": "webm", "video/ogg": "ogg" };
const reference = /^\/api\/rooms\/([a-f0-9]{16})\/media\/([a-f0-9]{64}\.(mp4|webm|mp3|wav|ogg|flac|aac))$/;

/** Container checks reject mismatched/truncated uploads; browsers still decode codecs. */
function inspectMedia(b) { try {
  if (b.length >= 44 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WAVE" && b.readUInt32LE(4) + 8 === b.length) {
    let offset = 12, format = false, samples = false;
    while (offset + 8 <= b.length) {
      const kind = b.toString("ascii", offset, offset + 4), size = b.readUInt32LE(offset + 4); offset += 8;
      if (offset + size > b.length) return null;
      if (kind === "fmt " && size >= 16) format = b.readUInt16LE(offset + 2) > 0 && b.readUInt32LE(offset + 4) > 0;
      if (kind === "data" && size > 0) samples = true;
      offset += size + (size % 2);
    }
    return format && samples && offset === b.length ? "wav" : null;
  }
  if (b.length >= 32 && b.toString("ascii", 4, 8) === "ftyp") {
    let offset = 0, movie = false, samples = false, track = false;
    const boxes = (start, end, depth = 0) => {
      if (depth > 4) return false;
      let at = start;
      while (at + 8 <= end) {
        let size = b.readUInt32BE(at), header = 8; const type = b.toString("ascii", at + 4, at + 8);
        if (size === 1) { if (at + 16 > end) return false; size = Number(b.readBigUInt64BE(at + 8)); header = 16; }
        else if (size === 0) size = end - at;
        if (!Number.isSafeInteger(size) || size < header || at + size > end) return false;
        if (type === "hdlr" && size >= header + 12 && ["vide", "soun"].includes(b.toString("ascii", at + header + 8, at + header + 12))) track = true;
        if (["moov", "trak", "mdia"].includes(type) && !boxes(at + header, at + size, depth + 1)) return false;
        at += size;
      }
      return at === end;
    };
    while (offset + 8 <= b.length) {
      let size = b.readUInt32BE(offset), header = 8; const kind = b.toString("ascii", offset + 4, offset + 8);
      if (size === 1) { if (offset + 16 > b.length) return null; size = Number(b.readBigUInt64BE(offset + 8)); header = 16; }
      else if (size === 0) size = b.length - offset;
      if (!Number.isSafeInteger(size) || size < header || offset + size > b.length) return null;
      if (kind === "ftyp" && size < header + 8) return null;
      if (kind === "moov") { movie = true; if (!boxes(offset + header, offset + size)) return null; }
      if (kind === "mdat" && size > header) samples = true;
      offset += size;
    }
    return movie && samples && track && offset === b.length ? "mp4" : null;
  }
  if (b.length > 64 && b.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])) && b.subarray(0, 64).includes(Buffer.from("webm")) &&
    b.includes(Buffer.from([0x18, 0x53, 0x80, 0x67])) && b.includes(Buffer.from([0x16, 0x54, 0xae, 0x6b])) && b.includes(Buffer.from([0x1f, 0x43, 0xb6, 0x75]))) return "webm";
  if (b.length >= 28 && b.toString("ascii", 0, 4) === "OggS") {
    let at = 0, payload = 0;
    while (at + 27 <= b.length) {
      if (b.toString("ascii", at, at + 4) !== "OggS" || b[at + 4] !== 0) return null;
      const count = b[at + 26]; if (at + 27 + count > b.length) return null;
      const length = b.subarray(at + 27, at + 27 + count).reduce((n, v) => n + v, 0);
      at += 27 + count + length; if (at > b.length) return null; payload += length;
    }
    return at === b.length && payload > 0 ? "ogg" : null;
  }
  if (b.length > 42 && b.toString("ascii", 0, 4) === "fLaC") {
    let at = 4, last = false;
    while (!last && at + 4 <= b.length) {
      const kind = b[at] & 127, length = b.readUIntBE(at + 1, 3); last = !!(b[at] & 128);
      if (at === 4 && (kind !== 0 || length !== 34) || at + 4 + length > b.length) return null;
      at += 4 + length;
    }
    return last && at < b.length ? "flac" : null;
  }
  let at = 0;
  if (b.length > 10 && b.toString("ascii", 0, 3) === "ID3") {
    if (b.subarray(6, 10).some(n => n > 127)) return null;
    at = 10 + ((b[6] << 21) | (b[7] << 14) | (b[8] << 7) | b[9]) + (b[5] & 16 ? 10 : 0);
  }
  if (at + 8 < b.length && b[at] === 255 && (b[at + 1] & 224) === 224 && (b[at + 1] & 24) !== 8 && (b[at + 1] & 6) !== 0 &&
    (b[at + 2] >> 4) > 0 && (b[at + 2] >> 4) < 15 && (b[at + 2] & 12) !== 12) return "mp3";
  if (b.length > 7 && b[0] === 255 && (b[1] & 246) === 240) {
    let offset = 0;
    while (offset + 7 <= b.length) {
      if (b[offset] !== 255 || (b[offset + 1] & 246) !== 240) return null;
      const length = ((b[offset + 3] & 3) << 11) | (b[offset + 4] << 3) | (b[offset + 5] >> 5);
      if (length < 8 || offset + length > b.length) return null; offset += length;
    }
    return offset === b.length ? "aac" : null;
  }
  return null;
} catch { return null; } }
exports.inspectMedia = inspectMedia;
exports.createMedia = (data, fail) => {
  let uploading = 0;
  const directory = room => path.join(data, "media", room);
  return {
    async upload(room, req) {
      const type = (req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
      if (!declaredTypes[type]) { req.resume(); fail(415, "Use MP4, WebM, MP3, WAV, Ogg, FLAC or AAC media."); }
      if (Number(req.headers["content-length"]) > MAX_FILE) { req.resume(); fail(413, "Room media must be no larger than 64 MB."); }
      if (uploading >= 2) { req.resume(); fail(429, "Media uploads are busy. Try again shortly."); }
      uploading++;
      try {
        let length = 0; const chunks = [];
        for await (const chunk of req) { length += chunk.length; if (length > MAX_FILE) fail(413, "Room media must be no larger than 64 MB."); chunks.push(chunk); }
        const bytes = Buffer.concat(chunks), extension = inspectMedia(bytes);
        if (!extension || extension !== declaredTypes[type]) fail(415, "This media container is unreadable, incomplete, or does not match its file type.");
        const name = createHash("sha256").update(bytes).digest("hex") + "." + extension, dir = directory(room), file = path.join(dir, name);
        if (!fs.existsSync(file)) {
          fs.mkdirSync(dir, { recursive: true }); const files = fs.readdirSync(dir).filter(n => /^[a-f0-9]{64}\.(mp4|webm|mp3|wav|ogg|flac|aac)$/.test(n));
          if (files.length >= MAX_FILES || files.reduce((n, f) => n + fs.statSync(path.join(dir, f)).size, 0) + bytes.length > MAX_ROOM) fail(413, "This room has reached its 512 MB media limit. Export it and start another room for more media.");
          const temporary = path.join(dir, randomUUID() + ".tmp");
          try { fs.writeFileSync(temporary, bytes, { mode: 0o600 }); fs.renameSync(temporary, file); }
          finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
        }
        return `/api/rooms/${room}/media/${name}`;
      } finally { uploading--; }
    },
    serve(room, name, req, res) {
      const file = path.join(directory(room), name); if (!fs.existsSync(file)) fail(404, "Room media not found.");
      const size = fs.statSync(file).size, tag = `"${name}"`, headers = { "Cache-Control": "private, no-cache", "Vary": "Cookie", "ETag": tag,
        "Accept-Ranges": "bytes", "X-Content-Type-Options": "nosniff", "Cross-Origin-Resource-Policy": "same-origin" };
      if (req.headers["if-none-match"] === tag) { res.writeHead(304, headers); res.end(); return; }
      let start = 0, end = size - 1, partial = false;
      if (req.headers.range && req.method !== "HEAD" && (!req.headers["if-range"] || req.headers["if-range"] === tag)) {
        const range = req.headers.range.match(/^bytes=(\d*)-(\d*)$/);
        if (range && (range[1] || range[2])) {
          if (!range[1]) start = Math.max(0, size - Number(range[2]));
          else { start = Number(range[1]); if (range[2]) end = Math.min(end, Number(range[2])); }
          if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || end < start) { res.writeHead(416, { ...headers, "Content-Range": `bytes */${size}` }); res.end(); return; }
          partial = true;
        }
      }
      res.writeHead(partial ? 206 : 200, { ...headers, "Content-Type": types[name.split(".")[1]], "Content-Length": end - start + 1,
        ...(partial ? { "Content-Range": `bytes ${start}-${end}/${size}` } : {}) });
      if (req.method === "HEAD") { res.end(); return; }
      const stream = fs.createReadStream(file, { start, end }); stream.on("error", () => res.destroy()); res.on("close", () => stream.destroy()); stream.pipe(res);
    },
    validate(room, table) {
      for (const object of table.scene.objects) for (const ref of [object.audio, object.video]) if (ref) {
        const match = ref.match(reference);
        if (!match || match[1] !== room || !fs.existsSync(path.join(directory(room), match[2]))) fail(400, "An object references missing media or media from another room.");
      }
    },
  };
};
