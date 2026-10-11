# Portable internet playtest

This folder runs one Table Goblin instance, Caddy HTTPS and a coturn media relay on a Linux server with Docker Compose v2. The server must have a reachable public IPv4, a domain you control, and persistent disk. You can prepare configuration on Windows and copy the project to that server. Nothing here purchases hosting or publishes a service automatically.

## Prepare

Point the domain's DNS A record to the server's public IPv4. Remove any stale AAAA record unless this server also serves that IPv6 address. Use direct DNS, without a CDN proxy, for this initial stack: the same domain also reaches TURN on port 3478.

From the project root, either double-click **Prepare Internet Deployment.bat** or run:

```sh
node deploy/setup.cjs table.your-domain.com YOUR_PUBLIC_IPV4
```

For a cloud host whose network interface has a private address mapped to a public address:

```sh
node deploy/setup.cjs table.your-domain.com YOUR_PUBLIC_IPV4 YOUR_LOCAL_IPV4
```

The setup creates `deploy/.env` with a random relay signing secret. It refuses to overwrite an existing file and never prints the secret. Copy this file privately alongside the project when moving to the server; it is excluded from Git and the Docker build context. Keep it accessible only to the server operator. Node is needed only to prepare configuration and run developer tests; the deployed services carry their own runtimes.

In the host/provider firewall, allow:

| Port | Protocol | Purpose |
| --- | --- | --- |
| 80 | TCP | Certificate issuance and redirect to HTTPS |
| 443 | TCP | App, API and room events |
| 443 | UDP | Optional HTTP/3 |
| 3478 | TCP and UDP | TURN client connections |
| 49160–49415 | UDP | TURN media relay allocations |

If there is NAT, forward those ports without changing their numbers. `RELAY_IP` must be an address actually assigned to the server's interface. Allow outbound HTTPS for certificate issuance and image downloads, and outbound UDP media traffic. Keep the server clock synchronized: relay credentials use timestamps. The app's port 4180 is internal and should not be exposed.

## Validate and start on the Linux server

From `deploy/`:

```sh
docker compose config --quiet
docker compose run --rm --no-deps web caddy validate --config /etc/caddy/Caddyfile
docker compose up -d --build
docker compose ps
curl --fail https://table.your-domain.com/api/health
```

The first start builds the client/server and obtains a certificate. Check failures with `docker compose logs --tail=100 web app turn`. Avoid publishing full `docker compose config` output or container inspection output: those include the secret. The health endpoint verifies the app, not TURN reachability.

Open the HTTPS URL, create a room and share its invitation. Caddy forwards room event streams without buffering, and production cookies use HTTPS. Volumes retain rooms, media and certificates across container recreation. Run a single app instance; the current room engine does not support horizontal replicas.

The coturn image is pinned to `4.18.0-r0-alpine`; Caddy tracks its maintained major-2 Alpine image and Node its major-22 Alpine image. Review/pin image digests when promoting beyond a playtest. The included relay uses authenticated TURN over UDP or TCP on 3478, with UDP relay allocations. It does not provide TURN over TLS on 443. Some restrictive networks require that; use a separately configured TLS relay or provider through `TABLE_GOBLIN_ICE_SERVERS` in the app environment if needed.

## Verify before inviting a group

1. On two different networks (for example home broadband and a phone hotspot), join as GM and player in Brave. Verify shapes, image/text editing, permissions, dice, saved room refresh and an app restart.
2. Share camera/OBS, screen and live audio. Check actual pixels/sound, source replacement, crop, late joining, stop/reconnect and personal mute/volume. Camera permissions and audio pickers vary by browser/OS.
3. Confirm **relay** connectivity, rather than just a successful direct connection. In the Chromium/Brave WebRTC diagnostics page, inspect the selected candidate pair for `candidateType: relay`. For a deterministic relay-only check, use the browser console in a joined room:

```js
// Use the room ID from the invitation URL. This fetch requires your room cookie.
const config = await fetch('/api/rooms/ROOM_ID/live').then(r => {
  if (!r.ok) throw new Error('Join the room first');
  return r.json();
});
const probe = new RTCPeerConnection({ iceServers: config.iceServers, iceTransportPolicy: 'relay' });
probe.onicecandidate = ({ candidate }) => {
  if (candidate) console.log('Relay allocation:', candidate.type);
};
probe.onicecandidateerror = e => console.log('Relay error:', e.errorCode, e.errorText);
probe.createDataChannel('relay-check');
await probe.setLocalDescription(await probe.createOffer());
// Wait for relay candidates, then release the allocation:
// probe.close();
```

This checks authenticated allocation from that network, not end-to-end media. Check actual media on both networks too. UDP and TCP relay URLs may behave differently; test each separately if one network fails. Do not share the fetched credential payload. Member credentials last 24 hours; the client refreshes configuration halfway through and supplies fresh credentials for subsequent connections. Existing connections are retained. A session spanning more than 24 hours may need a feed reconnect. Removing a player revokes app/signaling access immediately; already issued TURN credentials can remain usable until expiry, though they grant no room access.

4. Restore a backup into a separate fresh deployment and verify a saved room and its uploaded media before relying on this storage.

Developer checks from the project root:

```sh
npm run test:deploy
npm test
npm run test:online
npm run test:live
```

These use isolated local data. They do not prove public DNS, certificates, firewall rules, container startup or physical-device behavior.

## Update, stop and backups

Schedule updates when nobody is playing: live captures end when the app restarts. Keep the same project directory/name and `.env`; from `deploy/`, pull the desired Git revision and run `docker compose up -d --build`. Volumes remain in place. `docker compose stop` stops the services without deleting data. Do not use `docker compose down --volumes` on a table you want to retain.

Back up the entire room volume while the app is stopped, so JSON records and uploaded files agree. From `deploy/`:

```sh
mkdir -p backups
docker compose stop app
docker compose run --rm --no-deps --user 0 --entrypoint tar \
  -v "$PWD/backups:/backup" app -czf /backup/rooms-backup.tar.gz -C /data .
docker compose start app
```

Choose a new backup filename for each run. Keep a private copy off the server; the archive contains invitation/session data and private media. On failure, start the app again and resolve the backup error. Back up `.env` separately in private storage; Caddy can obtain new certificates if its volume is lost. Local browser tables are separate: export those through the app and import into an online room rather than copying browser storage.

To restore, prepare a **separate new deployment directory** with the same source version as the backup, its own `.env` and a trusted copy of the archive at `backups/rooms-backup.tar.gz`. Use a separate server to avoid colliding with the original service's web/relay ports. From that new `deploy/` directory:

```sh
docker compose -p table-goblin-restore build app
docker compose -p table-goblin-restore create app
docker compose -p table-goblin-restore run --rm --no-deps --user 0 --entrypoint sh \
  -v "$PWD/backups:/backup:ro" app -c '
    if [ -n "$(find /data -mindepth 1 -print -quit)" ]; then
      echo "Refusing to restore into a nonempty room volume" >&2; exit 1
    fi
    tar -xzf /backup/rooms-backup.tar.gz -C /data && chown -R node:node /data
  '
docker compose -p table-goblin-restore up -d
```

Keep using that project name for subsequent commands on the restored deployment. Verify the saved room, identities and uploaded media. Keep the original deployment and backup intact until verification succeeds. Never extract over a running or nonempty room volume; if extraction fails partway through, investigate and use a fresh volume rather than bypassing the guard.

## Sharing bars and queued polish

Browser screen-sharing indicators are browser-owned privacy controls; the page cannot hide or style them. Copies of a live surface already reuse one capture. Separate captures can produce separate bars. Planned improvements include reusing one screen capture for its video and audio, and clearer capture-source choices. OBS can compose multiple visual sources into one virtual-camera feed when that suits the table; browser camera indicators still apply.

See [the roadmap](../ROADMAP.md) for remaining group-test work and the requested UI/tool additions.

References: [Caddy HTTPS](https://caddyserver.com/docs/automatic-https), [Caddy streaming proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy), [coturn Docker usage](https://github.com/coturn/coturn/blob/master/docker/coturn/README.md), [coturn authentication](https://github.com/coturn/coturn/blob/master/examples/etc/turnserver.conf), [screen capture privacy indicators](https://www.w3.org/TR/screen-capture/#privacy-indicator-requirements).
