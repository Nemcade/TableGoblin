const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { randomBytes, randomUUID, createHash } = require("node:crypto");
const { ROOM_PROTOCOL, emptySharedTable, parseSharedTable, validPresence } = require("../.server-runtime/room-state.cjs");
const runningBuild = require("./online-runtime.cjs").serverBuild();
const { tableChanges, validOperation, operationConflict, applyChanges, expectations, inverseChanges, advanceVersions } = require("../.server-runtime/room-operations.cjs");
const { requiredKeys } = require("../.server-runtime/room-operations.cjs");
const { editsAllowed, canEdit, hierarchy, validAccess, assignNewAccess } = require("../.server-runtime/room-permissions.cjs");
const { emptyRoomDice, parseRoomDice, parseRollRequest, makeRoll } = require("../.server-runtime/room-dice.cjs");
const { emptyRoomPlayback, parseRoomPlayback, parsePlaybackRequest, reconcilePlayback, changePlayback, validPlaybackReceipts } = require("../.server-runtime/room-playback.cjs");
const { diceThrow } = require("../.server-runtime/dice-throw.cjs");
const diceService = require("./dice-service.cjs"), pendingRolls = new Map();
const secret = () => randomBytes(32).toString("base64url");
const hash = value => createHash("sha256").update(value).digest("hex");
const project = path.resolve(__dirname, ".."), root = path.join(project, "dist");
const data = path.resolve(process.env.TABLE_GOBLIN_DATA || path.join(project, "room-data"));
const rooms = new Map(), clients = new Map(), presence = new Map(), limits = new Map();
const leases = new Map();
const maxBody = 8 * 1024 * 1024;
fs.mkdirSync(data, { recursive: true });
class HttpError extends Error { constructor(status, message, code) { super(message); this.status = status; this.code = code; } }
const fail = (status, message, code) => { throw new HttpError(status, message, code); };
const artwork = require("./room-assets.cjs").createAssets(data, fail);
const mediaFiles = require("./room-media.cjs").createMedia(data, fail);
const live = require("./room-live.cjs").createLive({ clients, send, broadcast, fail });
const json = (res, status, value) => { res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }); res.end(JSON.stringify(value)); };
function body(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let bytes = 0, rejected = false;
    req.on("data", chunk => {
      bytes += chunk.length;
      if (bytes > maxBody) { if (!rejected) reject(new HttpError(413, "The table is too large for this playtest (8 MB limit).")); rejected = true; chunks.length = 0; }
      else if (!rejected) chunks.push(chunk);
    });
    req.on("end", () => { if (!rejected) {
      try {
        const value = JSON.parse(Buffer.concat(chunks).toString());
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected an object");
        resolve(value);
      } catch { reject(new HttpError(400, "Invalid request.")); }
    } });
    req.on("error", reject);
  });
}
function identity(v) {
  if (!v || typeof v.name !== "string" || !v.name.trim() || v.name.length > 32 || !/^#[0-9a-f]{6}$/i.test(v.color)) fail(400, "Enter a name (up to 32 characters) and a color.");
  return { name: v.name.trim(), color: v.color.toLowerCase() };
}
function persist(room) {
  room.playback = reconcilePlayback(room.playback ?? emptyRoomPlayback(), room.table, Date.now());
  room.playReceipts ??= [];
  const file = path.join(data, `${room.id}.json`), temp = file + ".tmp";
  fs.writeFileSync(temp, JSON.stringify(room), { mode: 0o600 });
  fs.renameSync(temp, file);
}
function load(id) {
  if (!/^[a-z0-9]{16}$/.test(id)) fail(404, "Room not found.");
  if (!rooms.has(id)) {
    try {
      const room = JSON.parse(fs.readFileSync(path.join(data, `${id}.json`), "utf8"));
      if (room.id !== id || !parseSharedTable(room.table) || !Array.isArray(room.members) || !Number.isSafeInteger(room.revision)) throw new Error("Invalid room record");
      if (room.members.some(m => m.profileVersion !== undefined && (!Number.isSafeInteger(m.profileVersion) || m.profileVersion < 0))) throw new Error("Invalid identity version");
      // Original prototype rooms have no operation metadata. Preserve their table
      // and credentials, and begin entity versioning at the saved revision.
      room.versions ??= Object.fromEntries([...room.table.scene.objects.map(o => `object:${o.id}`), ...room.table.scene.strokes.map(s => `stroke:${s.id}`), "widget:mood", "widget:grid", "widget:obscure"].map(key => [key, room.revision]));
      room.history ??= []; room.receipts ??= [];
      room.removed ??= [];
      if (!Array.isArray(room.removed) || room.removed.length > 256 || !room.removed.every(h => /^[a-f0-9]{64}$/.test(h))) throw new Error("Invalid removed sessions");
      if (!room.access) {
        const gm = room.members.find(m => m.role === "gm");
        if (!gm) throw new Error("Missing room owner");
        room.access = assignNewAccess(room.table, {}, gm.id);
        for (const policy of Object.values(room.access)) policy.shared = room.playerEditing;
      }
      if (!Object.values(room.access).every(validAccess)) throw new Error("Invalid sharing data");
      room.dice ??= emptyRoomDice(); room.rollReceipts ??= [];
      if (!parseRoomDice(room.dice)) throw new Error("Invalid dice history");
      const playbackMigration = room.playback === undefined || room.playReceipts === undefined;
      room.playback ??= emptyRoomPlayback(); room.playReceipts ??= [];
      if (!parseRoomPlayback(room.playback) || !validPlaybackReceipts(room.playReceipts, room.playback.sequence) || room.playReceipts.some(r => typeof r.actor !== "string" || !/^[a-f0-9]{64}$/.test(r.digest))) throw new Error("Invalid media playback");
      room.playback = reconcilePlayback(room.playback, room.table, Date.now());
      const artworkMigration = artwork.migrate(room);
      if (artworkMigration) {
        const backups = path.join(data, "backups"), backup = path.join(backups, `${id}.before-assets.json`);
        fs.mkdirSync(backups, { recursive: true });
        if (!fs.existsSync(backup)) fs.copyFileSync(path.join(data, `${id}.json`), backup, fs.constants.COPYFILE_EXCL);
      }
      if (artworkMigration || playbackMigration) persist(room);
      rooms.set(id, room);
    } catch (e) { fail(e.code === "ENOENT" ? 404 : 503, e.code === "ENOENT" ? "Room not found." : "This room's saved data could not be opened. It has been kept intact."); }
  }
  return rooms.get(id);
}
function member(req, room) {
  const cookie = (req.headers.cookie || "").split(";").map(s => s.trim()).find(s => s.startsWith(`tg_${room.id}=`));
  if (!cookie) fail(401, "Join this room to continue.");
  const token = cookie.slice(cookie.indexOf("=") + 1);
  const digest = hash(token), me = room.members.find(m => m.tokenHash === digest);
  if (!me && room.removed.includes(digest)) fail(403, "The GM removed you from this room. Your local table is still saved separately.", "ROOM_REMOVED");
  if (!me) fail(401, "Your room session is no longer valid. Join again.");
  return me;
}
function setCookie(res, room, token) {
  res.setHeader("Set-Cookie", `tg_${room.id}=${token}; Path=/api/rooms/${room.id}; HttpOnly; SameSite=Strict; Max-Age=31536000${process.env.NODE_ENV === "production" ? "; Secure" : ""}`);
}
function people(room) {
  return room.members.map(({ id, name, color, role, profileVersion = 0 }) => ({ id, name, color, role, profileVersion, online: [...(clients.get(room.id) || [])].some(c => c.id === id) }));
}
function state(room, me) {
  return { protocol: ROOM_PROTOCOL, id: room.id, title: room.title, revision: room.revision, playerEditing: room.playerEditing,
    me: people(room).find(p => p.id === me.id), participants: people(room), presence: [...(presence.get(room.id)?.values() || [])], table: room.table,
    ...diceState(room, me), ...playbackState(room, me), access: room.access, leases: activeLeases(room), versions: room.versions, history: historyStatus(room, me.id), accepted: room.receipts.filter(r => r.actor === me.id).map(({ id, revision }) => ({ id, revision })),
    ...(me.role === "gm" ? { invite: room.invite } : {}) };
}
function diceState(room, me) { return { dice: room.dice, diceAccepted: room.rollReceipts.filter(r => r.actor === me.id).map(({ id, sequence }) => ({ id, sequence })), serverTime: Date.now() }; }
function publishDice(room) { for (const c of clients.get(room.id) || []) send(c, "dice", diceState(room, room.members.find(m => m.id === c.id))); }
function playbackState(room, me) { return { playback: room.playback, playbackAccepted: room.playReceipts.filter(r => r.actor === me.id).map(({ id, sequence }) => ({ id, sequence })), serverTime: Date.now() }; }
function publishPlayback(room) { for (const c of clients.get(room.id) || []) send(c, "playback", playbackState(room, room.members.find(m => m.id === c.id))); }
function historyStatus(room, actor) {
  return { undo: room.history.some(h => h.actor === actor && !h.undone), redo: room.history.some(h => h.actor === actor && h.undone) };
}
function authorizedTable(room, me, table, changes = tableChanges(room.table, table), restoring = false) {
  artwork.validate(room.id, table, room.table, restoring);
  mediaFiles.validate(room.id, table);
  if (!editsAllowed(room.table, table, room.access, me.id, me.role === "gm", room.playerEditing)) fail(403, "This edit needs ownership or sharing permission. Locked placement and GM settings are protected.");
  if (me.role !== "gm" && changes.some(c => /^(object|stroke):/.test(c.key) && room.access[c.key] && !canEdit(room.access, c.key, me.id))) fail(403, "Only the owner or a shared editor can change this object's stacking order.");
}
function activeLeases(room) { return [...(leases.get(room.id)?.values() || [])].filter(l => l.expires > Date.now()); }
function publishLeases(room) { broadcast(room, "leases", activeLeases(room)); }
function leaseConflict(room, me, client, keys) {
  const ids = new Set(keys.filter(k => k.startsWith("object:")).map(k => k.slice(7)));
  return activeLeases(room).find(l => !(l.actor === me.id && l.client === client) && l.objects.some(id => ids.has(id)));
}
function checkLeases(room, me, client, changes) {
  const conflict = leaseConflict(room, me, client, requiredKeys(room.table, changes));
  if (conflict) fail(409, `${room.members.find(m => m.id === conflict.actor)?.name || "Another player"} is moving this object. Try again when they finish.`);
}
function publishTable(room, actor, operationId) {
  live.reconcile(room);
  for (const c of clients.get(room.id) || []) send(c, "table", { ...state(room, room.members.find(m => m.id === c.id)), actor, operationId });
}
function trimHistory(history) {
  const next = history.slice(-80);
  // Artwork can be large; retain a bounded undo history instead of growing the
  // private room file indefinitely. The current table is never trimmed.
  while (next.length && Buffer.byteLength(JSON.stringify(next)) > 8 * 1024 * 1024) next.shift();
  return next;
}
function send(client, type, value) {
  if (client.res.writableLength > maxBody) { client.res.destroy(); return; }
  if (!client.res.destroyed) client.res.write(`event: ${type}\ndata: ${JSON.stringify(value)}\n\n`);
}
function broadcast(room, type, value) { for (const c of clients.get(room.id) || []) send(c, type, value); }
function broadcastPeople(room) { broadcast(room, "presence", { participants: people(room), presence: [...(presence.get(room.id)?.values() || [])] }); }
function rate(req, category, max) {
  const key = `${req.socket.remoteAddress}:${category}`, now = Date.now();
  if (limits.size > 10000) for (const [k, v] of limits) if (now - v.time > 60000) limits.delete(k);
  const current = limits.get(key);
  if (!current || now - current.time > 60000) limits.set(key, { time: now, count: 1 });
  else if (++current.count > max) fail(429, "Too many requests. Try again in a minute.");
}
const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".png": "image/png", ".json": "application/json" };
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/api/health") return json(res, 200, { app: "table-goblin", online: true, protocol: ROOM_PROTOCOL, build: runningBuild });
    if (url.pathname.startsWith("/api/")) {
      if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) fail(403, "Use this server's own room link.");
      if (req.headers["sec-fetch-site"] === "cross-site") fail(403, "Cross-site room requests are not allowed.");
      const mediaRoute = url.pathname.match(/^\/api\/rooms\/([a-f0-9]{16})\/media(?:\/([a-f0-9]{64}\.(mp4|webm|mp3|wav|ogg|flac|aac)))?$/);
      if (mediaRoute) {
        const room = load(mediaRoute[1]), me = member(req, room);
        if (mediaRoute[2] && ["GET", "HEAD"].includes(req.method)) return mediaFiles.serve(room.id, mediaRoute[2], req, res);
        if (!mediaRoute[2] && req.method === "POST") {
          if (me.role !== "gm" && !room.playerEditing && !room.table.scene.objects.some(o => canEdit(room.access, `object:${o.id}`, me.id, false))) fail(403, "The GM must allow adding objects or share an editable object before you can upload media.");
          rate(req, `media:${room.id}:${me.id}`, 30);
          const media = await mediaFiles.upload(room.id, req); member(req, room);
          return json(res, 200, { media });
        }
        fail(405, "Method not allowed.");
      }
      const assetRoute = url.pathname.match(/^\/api\/rooms\/([a-f0-9]{16})\/assets(?:\/([a-f0-9]{64}\.(png|jpg|webp|gif)))?$/);
      if (assetRoute) {
        const room = load(assetRoute[1]), me = member(req, room);
        if (assetRoute[2] && ["GET", "HEAD"].includes(req.method)) return artwork.serve(room.id, assetRoute[2], req, res);
        if (!assetRoute[2] && req.method === "POST") {
          if (me.role !== "gm" && !room.playerEditing && !room.table.scene.objects.some(o => canEdit(room.access, `object:${o.id}`, me.id, false))) fail(403, "The GM must allow adding objects or share an editable object before you can upload artwork.");
          rate(req, `artwork:${room.id}:${me.id}`, 40);
          const image = await artwork.upload(room.id, req);
          member(req, room); // Removal also invalidates uploads already in progress.
          return json(res, 200, { image });
        }
        fail(405, "Method not allowed.");
      }
      if (req.method === "POST" && !/^application\/json\b/i.test(req.headers["content-type"] || "")) fail(415, "Send a JSON request.");
      if (url.pathname === "/api/rooms" && req.method === "POST") {
        rate(req, "create", 10);
        if (fs.readdirSync(data).filter(f => f.endsWith(".json")).length >= 200) fail(503, "This playtest server has reached its room limit.");
        const v = await body(req), profile = identity(v), token = secret();
        const room = { id: randomBytes(8).toString("hex"), title: typeof v.title === "string" ? v.title.trim().slice(0, 60) || "Shared table" : "Shared table",
          invite: secret(), revision: 0, playerEditing: false, table: emptySharedTable(), access: {}, versions: {}, history: [], receipts: [], dice: emptyRoomDice(), rollReceipts: [], removed: [],
          members: [{ id: randomUUID(), ...profile, role: "gm", tokenHash: hash(token) }] };
        persist(room); rooms.set(room.id, room); setCookie(res, room, token);
        return json(res, 201, state(room, room.members[0]));
      }
      const match = url.pathname.match(/^\/api\/rooms\/([a-z0-9]{16})\/(state|join|events|table|operations|undo|redo|presence|permissions|access|leases|rolls|manage|profile|playback|live)$/);
      if (!match) fail(404, "Endpoint not found.");
      const room = load(match[1]), action = match[2];
      if (action === "join" && req.method === "POST") {
        rate(req, "join", 40);
        const v = await body(req), profile = identity(v);
        if (typeof v.invite !== "string" || hash(v.invite) !== hash(room.invite)) fail(403, "This invitation is invalid.");
        let existing; try { existing = member(req, room); } catch {}
        if (existing && (existing.name !== profile.name || existing.color !== profile.color)) {
          const next = { ...room, revision: room.revision + 1, members: room.members.map(m => m.id === existing.id ? { ...m, ...profile, profileVersion: (m.profileVersion ?? 0) + 1 } : m) };
          persist(next); Object.assign(room, next); existing = room.members.find(m => m.id === existing.id);
          publishTable(room, existing.id);
        } else if (!existing) {
          if (room.members.length >= 24) fail(403, "This playtest room is full.");
          const token = secret(); existing = { id: randomUUID(), ...profile, role: "player", tokenHash: hash(token) };
          const next = { ...room, members: [...room.members, existing] };
          persist(next); Object.assign(room, next); setCookie(res, room, token);
        }
        broadcastPeople(room); return json(res, 200, state(room, existing));
      }
      let me = member(req, room);
      if (action === "state" && req.method === "GET") return json(res, 200, state(room, me));
      if (action === "live" && req.method === "GET") return json(res, 200, { ...live.snapshot(room), ...live.config() });
      if (action === "events" && req.method === "GET") {
        const connections = clients.get(room.id) || new Set();
        if (connections.size >= 48) fail(429, "Too many connections to this room.");
        res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive", "X-Accel-Buffering": "no" });
        const client = { id: me.id, client: url.searchParams.get("client"), res }; connections.add(client); clients.set(room.id, connections);
        send(client, "state", state(room, me)); send(client, "live", live.snapshot(room)); broadcastPeople(room);
        const heartbeat = setInterval(() => res.write(": keepalive\n\n"), 15000);
        res.on("close", () => {
          clearInterval(heartbeat); connections.delete(client);
          live.disconnect(room, me.id, client.client);
          if (![...connections].some(c => c.id === me.id)) presence.get(room.id)?.delete(me.id);
          if (![...connections].some(c => c.id === me.id && c.client === client.client)) {
            const held = leases.get(room.id)?.get(client.client);
            if (held?.actor === me.id) { leases.get(room.id).delete(client.client); publishLeases(room); }
          }
          broadcastPeople(room);
        });
        return;
      }
      if (req.method !== "POST") fail(405, "Method not allowed.");
      rate(req, `commands:${room.id}:${me.id}`, 1200);
      const v = await body(req);
      me = member(req, room); // Credentials may have been revoked while reading the body.
      if (action === "live") {
        rate(req, `live:${room.id}:${me.id}`, 600);
        return json(res, 200, live.request(room, me, v));
      }
      if (action === "playback") {
        const request = parsePlaybackRequest(v);
        if (!request) fail(400, "Choose a valid media control and a finite duration/position (up to seven days).");
        const digest = hash(JSON.stringify(request)), receipt = room.playReceipts.find(r => r.id === request.id && r.actor === me.id);
        if (receipt) {
          if (receipt.digest !== digest) fail(409, "This playback identity has already been used for a different request.");
          return json(res, 200, playbackState(room, me));
        }
        const track = room.playback.tracks.find(t => t.object === request.object);
        if (!track || track.ref !== request.ref) fail(409, "This file was removed or replaced. Review the latest media controls.");
        if (!canEdit(room.access, `object:${request.object}`, me.id, me.role === "gm")) fail(403, "Only the GM, owner or shared editors can control this file for the room.");
        if (track.version !== request.version) return json(res, 409, { error: "Playback changed in another window. Review the latest controls and try again.", ...playbackState(room, me) });
        rate(req, `playback:${room.id}:${me.id}`, 120);
        const sequence = room.playback.sequence + 1;
        const next = { ...room, playback: { sequence, tracks: room.playback.tracks.map(t => t.object === track.object ? changePlayback(t, request, Date.now(), sequence) : t) },
          playReceipts: [...room.playReceipts, { id: request.id, actor: me.id, sequence, digest }].slice(-256) };
        persist(next); Object.assign(room, next); publishPlayback(room);
        return json(res, 200, playbackState(room, me));
      }
      if (action === "profile") {
        const profile = identity(v);
        if (typeof v.id !== "string" || !/^[a-z0-9-]{16,80}$/i.test(v.id) || !Number.isSafeInteger(v.version) || v.version < 0) fail(400, "Invalid identity update.");
        const digest = hash(JSON.stringify({ action, value: v })), receipt = room.receipts.find(r => r.id === v.id && r.actor === me.id);
        if (receipt) {
          if (receipt.digest !== digest) fail(409, "This request identity has already been used for a different action.");
          return json(res, 200, state(room, me));
        }
        if (v.version !== (me.profileVersion ?? 0)) return json(res, 409, { error: "Your identity changed in another window. Review the current name and color before saving again.", state: state(room, me) });
        const revision = room.revision + 1;
        const next = { ...room, revision,
          members: room.members.map(m => m.id === me.id ? { ...m, ...profile, profileVersion: v.version + 1 } : m),
          receipts: [...room.receipts, { id: v.id, actor: me.id, digest, revision }].slice(-256) };
        persist(next); Object.assign(room, next); publishTable(room, me.id, v.id);
        return json(res, 200, state(room, me));
      }
      if (action === "manage") {
        if (me.role !== "gm") fail(403, "Only the GM can replace invitations or remove participants.");
        if (typeof v.id !== "string" || !/^[a-z0-9-]{16,80}$/i.test(v.id) || !["invitation", "remove"].includes(v.kind) || typeof v.invite !== "string" || v.invite.length > 100 ||
          (v.kind === "remove" && typeof v.member !== "string")) fail(400, "Invalid room control request.");
        const digest = hash(JSON.stringify({ action, value: v })), receipt = room.receipts.find(r => r.id === v.id && r.actor === me.id);
        if (receipt) {
          if (receipt.digest !== digest) fail(409, "This request identity has already been used for a different action.");
          return json(res, 200, state(room, me));
        }
        if (hash(v.invite) !== hash(room.invite)) return json(res, 409, { error: "The invitation changed. Review the latest room controls and try again.", state: state(room, me) });
        const target = v.kind === "remove" ? room.members.find(m => m.id === v.member) : null;
        if (v.kind === "remove" && (!target || target.role === "gm")) fail(400, "Choose a player in this room. The GM cannot be removed.");
        const revision = room.revision + 1, access = structuredClone(room.access), versions = { ...room.versions };
        if (target) for (const [key, policy] of Object.entries(access)) {
          if (policy.owner === target.id || policy.editors.includes(target.id)) {
            if (policy.owner === target.id) policy.owner = me.id;
            policy.editors = policy.editors.filter(id => id !== target.id);
            versions[key] = revision;
          }
        }
        const next = { ...room, revision, invite: secret(), access, versions,
          members: target ? room.members.filter(m => m.id !== target.id) : room.members,
          removed: target ? [...room.removed, target.tokenHash].slice(-256) : room.removed,
          receipts: [...room.receipts, { id: v.id, actor: me.id, digest, revision }].slice(-256) };
        persist(next); Object.assign(room, next);
        if (target) {
          presence.get(room.id)?.delete(target.id);
          for (const [key, lease] of leases.get(room.id) || []) if (lease.actor === target.id) leases.get(room.id).delete(key);
          const connections = clients.get(room.id);
          for (const c of [...(connections || [])]) if (c.id === target.id) {
            connections.delete(c); send(c, "removed", { message: "The GM removed you from this room. Your local table is still saved separately." }); c.res.end();
          }
        }
        publishTable(room, me.id, v.id);
        return json(res, 200, state(room, me));
      }
      if (action === "rolls") {
        const request = parseRollRequest(v);
        if (!request) fail(400, "Choose 1–20 dice with valid colors and a table position. Results are chosen by the room server.");
        const digest = hash(JSON.stringify(request)), receipt = room.rollReceipts.find(r => r.id === request.id && r.actor === me.id), key = `${room.id}:${me.id}:${request.id}`;
        if (receipt) {
          if (receipt.digest !== digest) fail(409, "This roll identity has already been used for a different request.");
          return json(res, 200, diceState(room, me));
        }
        const pending = pendingRolls.get(key);
        if (pending && pending.digest !== digest) fail(409, "This roll identity has already been used for a different request.");
        if (!pending) {
          rate(req, `rolls:${room.id}:${me.id}`, 30);
          const now = Date.now();
          if (room.dice.rolls.some(r => r.actorId === me.id && r.startedAt + r.duration * 1000 > now) || [...pendingRolls.keys()].some(k => k.startsWith(`${room.id}:${me.id}:`))) fail(409, "Wait for your current dice roll to finish.");
          if (room.dice.rolls.filter(r => r.startedAt + (r.duration + 4.9) * 1000 > now).length + [...pendingRolls.keys()].filter(k => k.startsWith(room.id + ":")).length >= 8) fail(429, "The table already has eight throws. Wait a moment before rolling.");
          const seed = randomBytes(4).readUInt32LE(), record = makeRoll(request, room.table.mood, me, randomUUID(), () => randomBytes(4).readUInt32LE());
          const promise = (async () => {
            const { duration } = await diceService.simulate(diceThrow(record.dice, request.area, seed));
            member(req, room); // A removed participant cannot commit a pending throw.
            const sequence = room.dice.sequence + 1, roll = { ...record, sequence, seed, area: request.area, duration, startedAt: Date.now() + 350 };
            const next = { ...room, dice: { sequence, rolls: [roll, ...room.dice.rolls].slice(0, 12) }, rollReceipts: [...room.rollReceipts, { id: request.id, actor: me.id, sequence, digest }].slice(-256) };
            persist(next); Object.assign(room, next); publishDice(room);
          })();
          pendingRolls.set(key, { digest, promise });
        }
        try { await pendingRolls.get(key).promise; }
        catch (error) { if (error instanceof HttpError) throw error; fail(503, error.message || "The roll could not be saved. Try again."); }
        finally { pendingRolls.delete(key); }
        return json(res, 200, diceState(room, me));
      }
      if (action === "leases") {
        if (typeof v.client !== "string" || !/^[a-z0-9-]{16,80}$/i.test(v.client) || !["claim", "renew", "release"].includes(v.action)) fail(400, "Invalid drag request.");
        const held = leases.get(room.id) || new Map(), previous = held.get(v.client);
        if (previous && previous.actor !== me.id) fail(403, "This drag belongs to another player.");
        if (v.action === "release") held.delete(v.client);
        else if (v.action === "renew") {
          if (!previous || previous.expires <= Date.now()) fail(409, "The drag timed out. Grab the object again.");
          previous.expires = Date.now() + 5000;
        } else {
          if (!previous && activeLeases(room).length >= 48) fail(429, "Too many active drags. Finish a drag and try again.");
          if (!Array.isArray(v.ids) || !v.ids.length || v.ids.length > 1000 || !v.ids.every(id => typeof id === "string" && room.table.scene.objects.some(o => o.id === id))) fail(400, "Choose existing objects to move.");
          const objects = hierarchy(room.table.scene, v.ids);
          if (objects.some(id => room.table.scene.objects.find(o => o.id === id).locked || !canEdit(room.access, `object:${id}`, me.id, me.role === "gm"))) fail(403, "This piece or its contents cannot be moved by you.");
          const changes = v.ids.map(id => ({ key: `object:${id}`, value: room.table.scene.objects.find(o => o.id === id) }));
          if (!Array.isArray(v.expected) || !v.expected.every(e => e && typeof e.key === "string" && Number.isSafeInteger(e.version)) || operationConflict(room.table, { changes, expected: v.expected }, room.versions)) fail(409, "This object changed. Grab it again from its latest position.");
          checkLeases(room, me, v.client, changes);
          held.set(v.client, { client: v.client, actor: me.id, objects: [...new Set([...(previous?.expires > Date.now() ? previous.objects : []), ...objects])], expires: Date.now() + 5000 });
        }
        leases.set(room.id, held); publishLeases(room);
        return json(res, 200, { leases: activeLeases(room) });
      }
      if (action === "access") {
        if (me.role !== "gm") fail(403, "Only the GM can assign or share objects.");
        if (!Array.isArray(v.ids) || !v.ids.length || v.ids.length > 1000 || !v.ids.every(id => typeof id === "string" && room.table.scene.objects.some(o => o.id === id)) ||
          !validAccess(v.policy) || ![v.policy.owner, ...v.policy.editors].every(id => room.members.some(m => m.id === id))) fail(400, "Choose an owner and editors from this room.");
        if (v.revision !== room.revision) return json(res, 409, { error: "The room changed. Open sharing again to use the latest settings.", state: state(room, me) });
        const ids = hierarchy(room.table.scene, v.ids), changes = ids.map(id => ({ key: `object:${id}`, value: room.table.scene.objects.find(o => o.id === id) }));
        checkLeases(room, me, v.client, changes);
        const access = { ...room.access }, versions = { ...room.versions }, revision = room.revision + 1;
        for (const id of ids) { access[`object:${id}`] = structuredClone(v.policy); versions[`object:${id}`] = revision; }
        const next = { ...room, access, versions, revision }; persist(next); Object.assign(room, next); publishTable(room, me.id);
        return json(res, 200, state(room, me));
      }
      if (action === "presence") {
        if (!validPresence(v)) fail(400, "Invalid pointer, selection or view.");
        const entries = presence.get(room.id) || new Map();
        entries.set(me.id, { id: me.id, selection: v.selection.filter(id => room.table.scene.objects.some(o => o.id === id)), laser: v.laser ? { x: v.laser.x, y: v.laser.y } : null,
          view: v.view ? { x: v.view.x, y: v.view.y, width: v.view.width, height: v.view.height } : null, seen: Date.now() });
        presence.set(room.id, entries); broadcastPeople(room); return json(res, 200, { ok: true });
      }
      if (action === "permissions") {
        if (me.role !== "gm") fail(403, "Only the GM can change room permissions.");
        if (typeof v.playerEditing !== "boolean") fail(400, "Invalid room permission.");
        const next = { ...room, playerEditing: v.playerEditing };
        persist(next); Object.assign(room, next);
        for (const c of clients.get(room.id) || []) send(c, "state", state(room, room.members.find(m => m.id === c.id)));
        return json(res, 200, state(room, me));
      }
      if (["operations", "undo", "redo"].includes(action)) {
        if (typeof v.id !== "string" || !/^[a-z0-9-]{16,80}$/i.test(v.id)) fail(400, "Invalid operation identity.");
        const digest = hash(JSON.stringify({ action, value: v })), receipt = room.receipts.find(r => r.id === v.id && r.actor === me.id);
        if (receipt) {
          if (receipt.digest !== digest) fail(409, "This operation identity has already been used for a different request.");
          return json(res, 200, state(room, me));
        }
        let operation, entry;
        if (action === "operations") {
          if (!validOperation(v)) fail(400, "Invalid table operation.");
          operation = v;
        } else {
          const own = room.history.filter(h => h.actor === me.id);
          entry = action === "undo" ? own.findLast(h => !h.undone) : own.find(h => h.undone);
          if (!entry) fail(409, action === "undo" ? "There is no saved edit to undo." : "There is no saved edit to redo.");
          operation = { id: v.id, changes: action === "undo" ? entry.inverse : entry.forward, expected: entry.expected };
        }
        if (operationConflict(room.table, operation, room.versions)) return json(res, 409, {
          error: action === "operations" ? "This object or its group changed before your edit arrived. Your unsent version can be exported." : "That edit cannot be reversed because its objects or settings changed afterward. Other participants' work has been preserved.", state: state(room, me),
        });
        const table = applyChanges(room.table, operation.changes);
        if (!table || Buffer.byteLength(JSON.stringify(table)) > maxBody) fail(400, "Invalid or oversized table operation. The existing room has been kept intact.");
        authorizedTable(room, me, table, operation.changes, action !== "operations");
        checkLeases(room, me, v.client, operation.changes);
        const revision = room.revision + 1, versions = advanceVersions(room.table, table, operation.changes, room.versions, revision);
        let history;
        if (entry) {
          const undone = action === "undo", reverse = undone ? entry.forward : entry.inverse;
          history = room.history.map(h => h.id === entry.id && h.actor === me.id ? { ...h, undone, expected: expectations(table, reverse, versions) } : h);
          // Reversing our operation restores an earlier causal version. Advance
          // only our own history references to that exact restored version.
          const restored = new Map((undone ? entry.beforeExpected : entry.afterExpected).map(e => [e.key, e.version]));
          const advance = list => list.map(e => ({ ...e, version: versions[e.key] !== room.versions[e.key] && restored.get(e.key) === e.version ? versions[e.key] ?? 0 : e.version }));
          history = history.map(h => h.actor === me.id ? { ...h, expected: advance(h.expected), beforeExpected: advance(h.beforeExpected), afterExpected: advance(h.afterExpected) } : h);
        } else {
          const inverse = inverseChanges(room.table, operation.changes);
          history = [...room.history.filter(h => h.actor !== me.id || !h.undone), { id: v.id, actor: me.id, forward: operation.changes, inverse, expected: expectations(table, inverse, versions), beforeExpected: operation.expected, afterExpected: expectations(table, inverse, versions), undone: false }];
        }
        const next = { ...room, table, access: assignNewAccess(table, room.access, me.id), revision, versions, history: trimHistory(history), receipts: [...room.receipts, { id: v.id, actor: me.id, revision, digest }].slice(-256) };
        persist(next); Object.assign(room, next); publishTable(room, me.id, v.id);
        return json(res, 200, state(room, me));
      }
      if (action === "table") {
        if (v.revision !== room.revision) return json(res, 409, { error: "The table changed in another window. The latest room version has been loaded; try your edit again.", state: state(room, me) });
        const table = parseSharedTable(v.table);
        if (!table) fail(400, "Invalid table. Upload images, audio and video before referencing them. Live sources cannot be shared yet.");
        authorizedTable(room, me, table);
        const changes = tableChanges(room.table, table), revision = room.revision + 1;
        if (me.role !== "gm" && !room.playerEditing && !changes.length) fail(403, "Player creation is disabled.");
        checkLeases(room, me, v.client, changes);
        const next = { ...room, table, access: assignNewAccess(table, room.access, me.id), revision, versions: advanceVersions(room.table, table, changes, room.versions, revision) };
        persist(next); Object.assign(room, next);
        publishTable(room, me.id);
        return json(res, 200, { revision: room.revision });
      }
      fail(405, "Method not allowed.");
    }
    if (!["GET", "HEAD"].includes(req.method)) fail(405, "Method not allowed.");
    const pathname = decodeURIComponent(url.pathname), file = path.resolve(root, "." + (pathname === "/" ? "/index.html" : pathname));
    if (!file.startsWith(root + path.sep)) fail(403, "Forbidden.");
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) fail(404, "Not found.");
    res.writeHead(200, { "Content-Type": mime[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "same-origin" });
    if (req.method === "HEAD") res.end(); else fs.createReadStream(file).on("error", () => res.destroy()).pipe(res);
  } catch (error) {
    if (!res.headersSent) json(res, error.status || 500, { error: error.status ? error.message : "The server could not save this change. Your previous room data is intact.", ...(error.code === "ROOM_REMOVED" ? { code: error.code } : {}) });
    else res.destroy();
    if (!error.status) console.error(error);
  }
});
const port = Number(process.env.PORT || 4180), host = process.env.HOST || "127.0.0.1";
const presenceExpiry = setInterval(() => {
  for (const [id, entries] of leases) {
    let changed = false;
    for (const [client, lease] of entries) if (lease.expires <= Date.now()) { entries.delete(client); changed = true; }
    if (changed && rooms.has(id)) publishLeases(rooms.get(id));
  }
  for (const [id, entries] of presence) {
    let changed = false;
    for (const entry of entries.values()) if (entry.laser && Date.now() - entry.seen > 1500) { entry.laser = null; changed = true; }
    if (changed && rooms.has(id)) broadcastPeople(rooms.get(id));
  }
}, 500);
server.listen(port, host, () => console.log(`Table Goblin online: http://${host}:${server.address().port}/`));
server.on("error", e => { clearInterval(presenceExpiry); console.error(e.message); process.exit(1); });
function stop() { clearInterval(presenceExpiry); diceService.stop(); for (const connections of clients.values()) for (const c of connections) c.res.end(); server.close(() => process.exit(0)); }
process.on("SIGINT", stop); process.on("SIGTERM", stop);
