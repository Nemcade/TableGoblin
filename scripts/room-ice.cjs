const { createHmac } = require('node:crypto');

// The coturn signing secret stays on the server. Room members receive only
// expiring credentials; these are never part of a durable room snapshot.
function createIce(env = process.env, now = Date.now) {
  let servers = [];
  if (env.TABLE_GOBLIN_ICE_SERVERS) {
    try { servers = JSON.parse(env.TABLE_GOBLIN_ICE_SERVERS); }
    catch { throw new Error('TABLE_GOBLIN_ICE_SERVERS must be a JSON array.'); }
    if (!Array.isArray(servers) || servers.length > 8 || servers.some(s => !s ||
      ![s.urls].flat().length || [s.urls].flat().length > 8 ||
      ![s.urls].flat().every(u => typeof u === 'string' && /^(stun|stuns|turn|turns):[^\s]+$/.test(u)) ||
      [s.urls].flat().some(u => /^turns?:/.test(u)) && (!s.username || !s.credential) ||
      [s.username, s.credential].some(v => v !== undefined && (typeof v !== 'string' || v.length > 1024))))
      throw new Error('TABLE_GOBLIN_ICE_SERVERS must be a JSON array of valid STUN/TURN servers.');
  }
  const secret = env.TABLE_GOBLIN_TURN_SECRET;
  let urls;
  if (secret || env.TABLE_GOBLIN_TURN_URLS) {
    if (typeof secret !== 'string' || secret.length < 32 || secret.length > 1024)
      throw new Error('TABLE_GOBLIN_TURN_SECRET must contain at least 32 characters.');
    try { urls = JSON.parse(env.TABLE_GOBLIN_TURN_URLS); } catch { /* Report the setting, never its contents. */ }
    if (!Array.isArray(urls) || !urls.length || urls.length > 8 || servers.length >= 8 ||
      !urls.every(u => typeof u === 'string' && /^turns?:[^\s]+$/.test(u)))
      throw new Error('TABLE_GOBLIN_TURN_URLS must be a JSON array of TURN URLs.');
  }
  return (room, member) => {
    if (!urls) return { iceServers: servers };
    const expires = Math.floor(now() / 1000) + 24 * 60 * 60;
    const username = `${expires}:${room.id}:${member.id}`;
    return { iceServers: [...servers, { urls, username,
      credential: createHmac('sha1', secret).update(username).digest('base64') }], iceExpiresAt: expires * 1000 };
  };
}
module.exports = { createIce };
