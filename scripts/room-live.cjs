const { randomUUID } = require('node:crypto');
const uuid = value => typeof value === 'string' && /^[a-f0-9-]{36}$/i.test(value);
/** Only descriptors live here. SDP/ICE is forwarded to one authenticated browser,
 * never broadcast, recorded, or written into a saved room. */
function createLive({ clients, send, broadcast, fail }) {
  const rooms = new Map();
  const instance = randomUUID();
  const config = require('./room-ice.cjs').createIce();
  const data = room => {
    if (!rooms.has(room.id)) rooms.set(room.id, { sequence: 0, sources: new Map() });
    return rooms.get(room.id);
  };
  const snapshot = room => ({ instance, sequence: data(room).sequence, sources: [...data(room).sources.values()].map(({ peers, ...s }) => ({ ...s,
    name: room.members.find(m => m.id === s.actor)?.name || 'Player' })) });
  const changed = room => { data(room).sequence++; broadcast(room, 'live', snapshot(room)); };
  const endpoint = (room, actor, browser) => [...(clients.get(room.id) || [])].find(c => c.id === actor && c.client === browser && !c.res.destroyed);
  const anchor = (room, source) => room.table.scene.objects.find(o => o.id === source && ['camera', 'screen'].includes(o.kind)) ||
    room.table.scene.objects.find(o => (o.sourceId ?? o.id) === source && ['camera', 'screen'].includes(o.kind));
  const allowed = (room, me, source, kind) => kind === 'audio' ? me.role === 'gm' || room.playerEditing :
    !!anchor(room, source) && (me.role === 'gm' || room.access[`object:${anchor(room, source).id}`]?.owner === me.id);
  function end(room, source) {
    const s = data(room).sources.get(source);
    if (!s) return;
    const owner = endpoint(room, s.actor, s.browser);
    if (owner) send(owner, 'live-signal', { action: 'ended', source, generation: s.generation });
    data(room).sources.delete(source); changed(room);
  }
  function reconcile(room) {
    for (const s of data(room).sources.values()) {
      const owner = room.members.find(m => m.id === s.actor);
      if (!owner || !endpoint(room, s.actor, s.browser) || !allowed(room, owner, s.source, s.kind) ||
        s.kind !== 'audio' && anchor(room, s.source)?.kind !== s.kind) end(room, s.source);
    }
  }
  function disconnect(room, actor, browser) {
    if (endpoint(room, actor, browser)) return;
    for (const s of data(room).sources.values()) {
      if (s.actor === actor && s.browser === browser) end(room, s.source);
      else {
        const p = s.peers.get(browser);
        if (p?.actor === actor) { s.peers.delete(browser); const owner = endpoint(room, s.actor, s.browser);
          if (owner) send(owner, 'live-signal', { action: 'unsubscribe', source: s.source, generation: s.generation, peer: browser, connection: p.connection }); }
      }
    }
  }
  function request(room, me, v) {
    if (!uuid(v.client) || !endpoint(room, me.id, v.client)) fail(409, 'Reconnect to the room before using live sources.');
    if (!uuid(v.source)) fail(400, 'Choose a valid live source.');
    const registry = data(room), s = registry.sources.get(v.source);
    if (v.action === 'publish') {
      if (!['screen', 'camera', 'audio'].includes(v.kind) || !uuid(v.generation) ||
        typeof v.label !== 'string' || !v.label.trim() || v.label.length > 160) fail(400, 'Invalid live source.');
      if (v.kind === 'audio' && room.table.scene.objects.some(o => (o.sourceId ?? o.id) === v.source) || s && s.kind !== v.kind)
        fail(400, 'A live audio source cannot replace a video surface.');
      if (!allowed(room, me, v.source, v.kind) || v.kind !== 'audio' && anchor(room, v.source)?.kind !== v.kind)
        fail(403, 'Only the source owner or GM can connect this source. Adding audio needs permission to add objects.');
      if (s && (s.actor !== me.id || s.browser !== v.client)) fail(409, 'This source is being shared from another browser. Stop it there first.');
      if (s?.generation === v.generation) return snapshot(room);
      if (!s && (registry.sources.size >= 8 || [...registry.sources.values()].filter(x => x.browser === v.client).length >= 4))
        fail(429, 'This demo supports eight live sources per room and four per browser.');
      registry.sources.set(v.source, { source: v.source, kind: v.kind, label: v.label.trim(), actor: me.id, browser: v.client,
        generation: v.generation, peers: new Map() }); changed(room); return snapshot(room);
    }
    if (!s || s.generation !== v.generation) fail(409, 'The live source changed. Reconnect to its current feed.');
    if (v.action === 'stop') {
      if (me.role !== 'gm' && (s.actor !== me.id || s.browser !== v.client)) fail(403, 'Stop only sources shared by this browser.');
      end(room, v.source); return snapshot(room);
    }
    if (v.action === 'subscribe' || v.action === 'unsubscribe') {
      if (s.browser === v.client) fail(400, 'A source cannot subscribe to itself.');
      if (!uuid(v.connection)) fail(400, 'Invalid live connection.');
      const owner = endpoint(room, s.actor, s.browser);
      if (!owner) fail(409, 'The publisher disconnected.');
      const previous = s.peers.get(v.client);
      if (v.action === 'subscribe') s.peers.set(v.client, { actor: me.id, connection: v.connection });
      else if (previous?.actor === me.id && previous.connection === v.connection) s.peers.delete(v.client);
      else return snapshot(room);
      send(owner, 'live-signal', { action: v.action, source: s.source, generation: s.generation, peer: v.client, connection: v.connection });
      return snapshot(room);
    }
    if (v.action !== 'signal' || !uuid(v.peer) || !uuid(v.connection)) fail(400, 'Invalid live signal.');
    const publisher = s.actor === me.id && s.browser === v.client;
    const p = s.peers.get(publisher ? v.peer : v.client);
    if (!p || p.connection !== v.connection || !publisher && (p.actor !== me.id || v.peer !== s.browser)) fail(403, 'This browser is not part of that live connection.');
    const message = v.message;
    if (!message || !['offer', 'answer', 'ice'].includes(message.type) || Buffer.byteLength(JSON.stringify(message)) > 70 * 1024) fail(400, 'Invalid live signal.');
    if (message.type === 'ice') {
      const c = message.candidate;
      if (!c || typeof c.candidate !== 'string' || c.candidate.length > 2048 ||
        c.sdpMid !== null && (typeof c.sdpMid !== 'string' || c.sdpMid.length > 128) ||
        c.sdpMLineIndex !== null && (!Number.isInteger(c.sdpMLineIndex) || c.sdpMLineIndex < 0 || c.sdpMLineIndex > 32) ||
        c.usernameFragment !== undefined && c.usernameFragment !== null && (typeof c.usernameFragment !== 'string' || c.usernameFragment.length > 256)) fail(400, 'Invalid ICE candidate.');
    } else if ((message.type === 'offer') !== publisher || typeof message.sdp !== 'string' || message.sdp.length > 65536 || !message.sdp.startsWith('v=0')) fail(400, 'Invalid session description.');
    const recipient = endpoint(room, publisher ? p.actor : s.actor, v.peer);
    if (!recipient) fail(409, 'The receiving browser disconnected.');
    send(recipient, 'live-signal', { action: 'signal', source: s.source, generation: s.generation, peer: v.client, connection: v.connection, message });
    return { ok: true };
  }
  return { snapshot, reconcile, disconnect, request, config };
}
module.exports = { createLive };
