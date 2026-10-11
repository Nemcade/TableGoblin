const fs = require('node:fs');
const path = require('node:path');
const { isIP } = require('node:net');
const { randomBytes } = require('node:crypto');

function settings(domain, publicIp, relayIp = publicIp) {
  domain = (domain || '').toLowerCase();
  if (domain.length > 253 || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain))
    throw new Error('Use a domain such as table.your-domain.com, without https://, a path or port.');
  if (isIP(publicIp) !== 4 || isIP(relayIp) !== 4) throw new Error('Use the server public IPv4 and, optionally, its local relay IPv4.');
  const octets = publicIp.split('.').map(Number);
  if ([0, 10, 127].includes(octets[0]) || octets[0] >= 224 ||
    octets[0] === 169 && octets[1] === 254 || octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31 ||
    octets[0] === 192 && octets[1] === 168 || octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127)
    throw new Error('The public IPv4 must be internet routable. Use the optional third argument for a private relay interface.');
  return { domain, relayIp, externalIp: publicIp === relayIp ? publicIp : `${publicIp}/${relayIp}` };
}
function setup(args, destination = path.join(__dirname, '.env')) {
  if (args.length < 2 || args.length > 3) throw new Error('Usage: node deploy/setup.cjs DOMAIN PUBLIC_IPV4 [LOCAL_RELAY_IPV4]');
  const s = settings(...args);
  const content = `# Private deployment configuration. Keep off GitHub.\nDOMAIN=${s.domain}\nRELAY_IP=${s.relayIp}\nTURN_EXTERNAL_IP=${s.externalIp}\nTURN_SECRET=${randomBytes(32).toString('hex')}\n`;
  // Exclusive creation prevents accidental credential rotation on reruns.
  fs.writeFileSync(destination, content, { flag: 'wx', mode: 0o600 });
  return s;
}
if (require.main === module) {
  try {
    const s = setup(process.argv.slice(2));
    console.log(`Created deploy/.env for https://${s.domain}. No service has been started.\nFollow deploy/README.md on the Linux server. Existing tables are untouched.`);
  } catch (error) {
    console.error(error.code === 'EEXIST' ? 'deploy/.env already exists; kept unchanged. Edit it manually to change the host.' : error.message);
    process.exitCode = 1;
  }
}
module.exports = { settings, setup };
