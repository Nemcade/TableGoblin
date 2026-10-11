const fs = require("node:fs");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const MAX_FILE = 20 * 1024 * 1024, MAX_ROOM = 256 * 1024 * 1024, MAX_FILES = 1024;
const reference = /^\/api\/rooms\/([a-f0-9]{16})\/assets\/([a-f0-9]{64}\.(png|jpg|webp|gif))$/;
const types = { png: "image/png", jpg: "image/jpeg", webp: "image/webp", gif: "image/gif" };
// Inspect raster containers and dimensions before storing them. Decoding remains
// the browser's job; SVG, HTML, external URLs and executable content are excluded.
function raster(bytes) { try { return inspectRaster(bytes); } catch { return null; } }
function inspectRaster(bytes) {
  let extension, width, height;
  if (bytes.length >= 45 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) {
    if (bytes.toString("ascii", 12, 16) !== "IHDR" || bytes.readUInt32BE(8) !== 13) return null;
    width = bytes.readUInt32BE(16); height = bytes.readUInt32BE(20);
    let offset = 8, data = false, end = false;
    while (offset + 12 <= bytes.length) {
      const length = bytes.readUInt32BE(offset), kind = bytes.toString("ascii", offset + 4, offset + 8);
      if (offset + length + 12 > bytes.length) return null;
      if (kind === "IDAT" && length > 0) data = true;
      offset += length + 12;
      if (kind === "IEND") { end = length === 0 && offset === bytes.length; break; }
    }
    if (!data || !end) return null; extension = "png";
  } else if (bytes.length >= 14 && ["GIF87a", "GIF89a"].includes(bytes.toString("ascii", 0, 6)) && bytes[bytes.length - 1] === 0x3b) {
    extension = "gif"; width = bytes.readUInt16LE(6); height = bytes.readUInt16LE(8);
  } else if (bytes.length >= 26 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP" && bytes.readUInt32LE(4) + 8 === bytes.length) {
    const kind = bytes.toString("ascii", 12, 16);
    if (kind === "VP8X" && bytes.length >= 30) { width = bytes.readUIntLE(24, 3) + 1; height = bytes.readUIntLE(27, 3) + 1; }
    else if (kind === "VP8 " && bytes.length >= 30 && bytes[23] === 0x9d && bytes[24] === 1 && bytes[25] === 0x2a) { width = bytes.readUInt16LE(26) & 0x3fff; height = bytes.readUInt16LE(28) & 0x3fff; }
    else if (kind === "VP8L" && bytes[20] === 0x2f) { const bits = bytes.readUInt32LE(21); width = (bits & 0x3fff) + 1; height = ((bits >>> 14) & 0x3fff) + 1; }
    else return null; extension = "webp";
  } else if (bytes.length >= 12 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9) {
    let offset = 2;
    while (offset + 4 < bytes.length) {
      if (bytes[offset++] !== 0xff) return null;
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 1 || marker >= 0xd0 && marker <= 0xd7) continue;
      const length = bytes.readUInt16BE(offset);
      if (length < 2 || offset + length > bytes.length) return null;
      if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker) && length >= 8) { height = bytes.readUInt16BE(offset + 3); width = bytes.readUInt16BE(offset + 5); }
      offset += length;
    }
    extension = "jpg";
  }
  return extension && width > 0 && height > 0 && width <= 16384 && height <= 16384 && width * height <= 64 * 1024 * 1024 ? { extension, type: types[extension] } : null;
}
exports.raster = raster;
exports.createAssets = (data, fail) => {
  let uploading = 0;
  const directory = room => path.join(data, "assets", room);
  const store = (room, bytes, declared) => {
    if (!bytes.length || bytes.length > MAX_FILE) fail(413, "Artwork must be between 1 byte and 20 MB.");
    const format = raster(bytes);
    if (!format || declared !== format.type) fail(415, "Use a readable PNG, JPG, WebP or GIF image (up to 64 megapixels).");
    const name = createHash("sha256").update(bytes).digest("hex") + "." + format.extension, dir = directory(room), file = path.join(dir, name);
    if (!fs.existsSync(file)) {
      fs.mkdirSync(dir, { recursive: true });
      const files = fs.readdirSync(dir).filter(n => /^[a-f0-9]{64}\.(png|jpg|webp|gif)$/.test(n));
      if (files.length >= MAX_FILES || files.reduce((n, f) => n + fs.statSync(path.join(dir, f)).size, 0) + bytes.length > MAX_ROOM) fail(413, "This room has reached its 256 MB artwork limit. Export the table and start a new room for more artwork.");
      const temporary = path.join(dir, randomUUID() + ".tmp");
      try { fs.writeFileSync(temporary, bytes, { mode: 0o600 }); fs.renameSync(temporary, file); }
      finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
    }
    return `/api/rooms/${room}/assets/${name}`;
  };
  return {
    async upload(room, req) {
      if (uploading >= 4) { req.resume(); fail(429, "Artwork uploads are busy. Try again shortly."); }
      const type = (req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
      if (!Object.values(types).includes(type)) { req.resume(); fail(415, "Upload a PNG, JPG, WebP or GIF image."); }
      if (Number(req.headers["content-length"]) > MAX_FILE) { req.resume(); fail(413, "Artwork must be no larger than 20 MB."); }
      uploading++;
      try {
        let length = 0; const chunks = [];
        for await (const chunk of req) { length += chunk.length; if (length > MAX_FILE) fail(413, "Artwork must be no larger than 20 MB."); chunks.push(chunk); }
        return store(room, Buffer.concat(chunks), type);
      } finally { uploading--; }
    },
    serve(room, name, req, res) {
      const file = path.join(directory(room), name);
      if (!fs.existsSync(file)) fail(404, "Room artwork not found.");
      const tag = `"${name}"`, headers = { "Cache-Control": "private, no-cache", "Vary": "Cookie", "ETag": tag, "X-Content-Type-Options": "nosniff", "Cross-Origin-Resource-Policy": "same-origin" };
      if (req.headers["if-none-match"] === tag) { res.writeHead(304, headers); res.end(); return; }
      res.writeHead(200, { ...headers, "Content-Type": types[name.split(".")[1]], "Content-Length": fs.statSync(file).size });
      if (req.method === "HEAD") { res.end(); return; }
      const stream = fs.createReadStream(file); stream.on("error", () => res.destroy()); res.on("close", () => stream.destroy()); stream.pipe(res);
    },
    validate(room, table, before, restoring = false) {
      for (const object of table.scene.objects) if (object.image?.startsWith("data:")) {
        if (!restoring && before?.scene.objects.find(o => o.id === object.id)?.image !== object.image) fail(400, "Upload artwork before adding it to a room object.");
      } else if (object.image?.startsWith("/")) {
        const match = object.image.match(reference);
        if (!match || match[1] !== room || !fs.existsSync(path.join(directory(room), match[2]))) fail(400, "An object references missing artwork or artwork from another room.");
      }
    },
    migrate(room) {
      const images = new Map(); let changed = false;
      const visit = value => {
        if (!value || typeof value !== "object") return;
        if (typeof value.image === "string" && /^data:image\/(png|jpeg|webp|gif);base64,/i.test(value.image)) {
          const old = value.image;
          if (!images.has(old)) {
            const [header, encoded] = old.split(","), bytes = Buffer.from(encoded, "base64"), type = header.slice(5, -7).toLowerCase();
            // An older unreadable image remains visible as a removable placeholder.
            images.set(old, raster(bytes) ? store(room.id, bytes, type) : old);
          }
          value.image = images.get(old); changed ||= old !== value.image;
        }
        for (const child of Object.values(value)) if (child && typeof child === "object") visit(child);
      };
      visit(room.table); visit(room.history); return changed;
    },
  };
};
