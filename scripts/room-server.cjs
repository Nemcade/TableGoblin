const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { randomBytes, randomUUID, createHash } = require("node:crypto");
const { ROOM_PROTOCOL, emptySharedTable, parseSharedTable } = require("../.server-runtime/room-state.cjs");
const runningBuild = require("./online-runtime.cjs").serverBuild();
const { tableChanges, validOperation, operationConflict, applyChanges, expectations, inverseChanges, advanceVersions } = require("../.server-runtime/room-operations.cjs");
const { requiredKeys } = require("../.server-runtime/room-operations.cjs");
const { editsAllowed, canEdit, hierarchy, validAccess, assignNewAccess } = require("../.server-runtime/room-permissions.cjs");
const { emptyRoomDice, parseRoomDice, parseRollRequest, makeRoll } = require("../.server-runtime/room-dice.cjs");
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
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const fail = (status, message) => { throw new HttpError(status, message); };
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
      // Original prototype rooms have no operation metadata. Preserve their table
      // and credentials, and begin entity versioning at the saved revision.
      room.versions ??= Object.fromEntries([...room.table.scene.objects.map(o => `object:${o.id}`), ...room.table.scene.strokes.map(s => `stroke:${s.id}`), "widget:mood", "widget:grid", "widget:obscure"].map(key => [key, room.revision]));
      room.history ??= []; room.receipts ??= [];
      if (!room.access) {
        const gm = room.members.find(m => m.role === "gm");
        if (!gm) throw new Error("Missing room owner");
        room.access = assignNewAccess(room.table, {}, gm.id);
        for (const policy of Object.values(room.access)) policy.shared = room.playerEditing;
      }
      if (!Object.values(room.access).every(validAccess)) throw new Error("Invalid sharing data");
      room.dice ??= emptyRoomDice(); room.rollReceipts ??= [];
      if (!parseRoomDice(room.dice)) throw new Error("Invalid dice history");
      rooms.set(id, room);
    } catch (e) { fail(e.code === "ENOENT" ? 404 : 503, e.code === "ENOENT" ? "Room not found." : "This room's saved data could not be opened. It has been kept intact."); }
  }
  return rooms.get(id);
}
function member(req, room) {
  const cookie = (req.headers.cookie || "").split(";").map(s => s.trim()).find(s => s.startsWith(`tg_${room.id}=`));
  if (!cookie) fail(401, "Join this room to continue.");
  const token = cookie.slice(cookie.indexOf("=") + 1);
  const me = room.members.find(m => m.tokenHash === hash(token));
  if (!me) fail(401, "Your room session is no longer valid. Join again.");
  return me;
}
function setCookie(res, room, token) {
  res.setHeader("Set-Cookie", `tg_${room.id}=${token}; Path=/api/rooms/${room.id}; HttpOnly; SameSite=Strict; Max-Age=31536000${process.env.NODE_ENV === "production" ? "; Secure" : ""}`);
}
function people(room) {
  return room.members.map(({ id, name, color, role }) => ({ id, name, color, role, online: [...(clients.get(room.id) || [])].some(c => c.id === id) }));
}
function state(room, me) {
  return { protocol: ROOM_PROTOCOL, id: room.id, title: room.title, revision: room.revision, playerEditing: room.playerEditing,
    me: people(room).find(p => p.id === me.id), participants: people(room), presence: [...(presence.get(room.id)?.values() || [])], table: room.table,
    ...diceState(room, me), access: room.access, leases: activeLeases(room), versions: room.versions, history: historyStatus(room, me.id), accepted: room.receipts.filter(r => r.actor === me.id).map(({ id, revision }) => ({ id, revision })),
    ...(me.role === "gm" ? { invite: room.invite } : {}) };
}
function diceState(room, me) { return { dice: room.dice, diceAccepted: room.rollReceipts.filter(r => r.actor === me.id).map(({ id, sequence }) => ({ id, sequence })), serverTime: Date.now() }; }
function publishDice(room) { for (const c of clients.get(room.id) || []) send(c, "dice", diceState(room, room.members.find(m => m.id === c.id))); }
function historyStatus(room, actor) {
  return { undo: room.history.some(h => h.actor === actor && !h.undone), redo: room.history.some(h => h.actor === actor && h.undone) };
}
function authorizedTable(room, me, table, changes = tableChanges(room.table, table)) {
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
      if (req.method === "POST" && !/^application\/json\b/i.test(req.headers["content-type"] || "")) fail(415, "Send a JSON request.");
      if (url.pathname === "/api/rooms" && req.method === "POST") {
        rate(req, "create", 10);
        if (fs.readdirSync(data).filter(f => f.endsWith(".json")).length >= 200) fail(503, "This playtest server has reached its room limit.");
        const v = await body(req), profile = identity(v), token = secret();
        const room = { id: randomBytes(8).toString("hex"), title: typeof v.title === "string" ? v.title.trim().slice(0, 60) || "Shared table" : "Shared table",
          invite: secret(), revision: 0, playerEditing: false, table: emptySharedTable(), access: {}, versions: {}, history: [], receipts: [], dice: emptyRoomDice(), rollReceipts: [],
          members: [{ id: randomUUID(), ...profile, role: "gm", tokenHash: hash(token) }] };
        persist(room); rooms.set(room.id, room); setCookie(res, room, token);
        return json(res, 201, state(room, room.members[0]));
      }
      const match = url.pathname.match(/^\/api\/rooms\/([a-z0-9]{16})\/(state|join|events|table|operations|undo|redo|presence|permissions|access|leases|rolls)$/);
      if (!match) fail(404, "Endpoint not found.");
      const room = load(match[1]), action = match[2];
      if (action === "join" && req.method === "POST") {
        rate(req, "join", 40);
        const v = await body(req), profile = identity(v);
        if (typeof v.invite !== "string" || hash(v.invite) !== hash(room.invite)) fail(403, "This invitation is invalid.");
        let existing; try { existing = member(req, room); } catch {}
        if (existing) {
          const next = { ...room, members: room.members.map(m => m.id === existing.id ? { ...m, ...profile } : m) };
          persist(next); Object.assign(room, next); existing = room.members.find(m => m.id === existing.id);
        } else {
          if (room.members.length >= 24) fail(403, "This playtest room is full.");
          const token = secret(); existing = { id: randomUUID(), ...profile, role: "player", tokenHash: hash(token) };
          const next = { ...room, members: [...room.members, existing] };
          persist(next); Object.assign(room, next); setCookie(res, room, token);
        }
        broadcastPeople(room); return json(res, 200, state(room, existing));
      }
      const me = member(req, room);
      if (action === "state" && req.method === "GET") return json(res, 200, state(room, me));
      if (action === "events" && req.method === "GET") {
        const connections = clients.get(room.id) || new Set();
        if (connections.size >= 48) fail(429, "Too many connections to this room.");
        res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive", "X-Accel-Buffering": "no" });
        const client = { id: me.id, client: url.searchParams.get("client"), res }; connections.add(client); clients.set(room.id, connections);
        send(client, "state", state(room, me)); broadcastPeople(room);
        const heartbeat = setInterval(() => res.write(": keepalive\n\n"), 15000);
        res.on("close", () => {
          clearInterval(heartbeat); connections.delete(client);
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
            const sequence = room.dice.sequence + 1, roll = { ...record, sequence, seed, area: request.area, duration, startedAt: Date.now() + 350 };
            const next = { ...room, dice: { sequence, rolls: [roll, ...room.dice.rolls].slice(0, 12) }, rollReceipts: [...room.rollReceipts, { id: request.id, actor: me.id, sequence, digest }].slice(-256) };
            persist(next); Object.assign(room, next); publishDice(room);
          })();
          pendingRolls.set(key, { digest, promise });
        }
        try { await pendingRolls.get(key).promise; }
        catch (error) { fail(503, error.message || "The roll could not be saved. Try again."); }
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
        if (!v || !Array.isArray(v.selection) || v.selection.length > 64 || !v.selection.every(id => typeof id === "string" && id.length <= 128) ||
          (v.laser !== null && (!v.laser || ![v.laser.x, v.laser.y].every(n => typeof n === "number" && Number.isFinite(n) && Math.abs(n) < 1e7)))) fail(400, "Invalid pointer or selection.");
        const entries = presence.get(room.id) || new Map();
        entries.set(me.id, { id: me.id, selection: v.selection.filter(id => room.table.scene.objects.some(o => o.id === id)), laser: v.laser, seen: Date.now() });
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
        authorizedTable(room, me, table, operation.changes);
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
        if (!table) fail(400, "Invalid table. Rooms currently support shapes, text, drawings and PNG/JPG/WebP/GIF images (8 MB total). Media streams and files stay local.");
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
    if (!res.headersSent) json(res, error.status || 500, { error: error.status ? error.message : "The server could not save this change. Your previous room data is intact." });
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
