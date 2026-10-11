# Table Goblin demo roadmap

The local tabletop demo and the core shared-room demo work. Live media now works in local multi-browser tests; the remaining work is hosting and testing on real internet connections. A full feature demo means the existing tabletop tools, file media and live sources can be used together by a small invited group; it does not require accounts, game rules or public room discovery.

## Completed

- Local tabletop: shapes and masked artwork, nesting, locks, marquee selection, drawing, inline styled text, theme effects, dice, grid/ruler, visual Obscure, file audio/video, live capture, presets, persistence and portable files.
- Shared rooms: invitations, remembered identities, colored lasers/selections, optional participant-view navigation, private artwork, authorized object editing, hierarchy permissions, drag claims, actor undo/redo, shared dice, reconnect recovery and durable room storage.
- GM room controls: confirmed invitation replacement and player removal, preserved objects and transferred ownership, rejected stale requests and revoked sessions.
- Uploaded audio/video files: private stored references, bounded uploads, browser decoding checks, byte-range downloads, refresh/restart, copies, crops, portable exports/imports and rejected-upload recovery.
- Shared file playback: authorized play/pause/restart/seek/loop, independent playback versions and retry receipts, room playhead recovery, late joins, personal mute/volume and explicit sound permission.
- Live sources: authenticated directed WebRTC signaling for cameras/OBS, screens and captured audio, shared surface copies/crops, source replacement/reconnect, late joins, personal listening, ownership checks, revocation and connection cleanup. Verified in independent local browser contexts; public network/relay testing remains.
- Portable deployment preparation: Linux Docker Compose stack, HTTPS proxy, persistent volumes, coturn with expiring member credentials, private configuration generator, backup/recovery instructions and isolated credential/API checks. Container startup and public networking remain to be verified on the target host.

## Next milestones

1. **Hosted verification.** Choose a server/domain, run the portable deployment, validate certificates and backups, and confirm TURN allocations and real media on different networks. The deployment package is prepared; no hosting has been purchased or started.
2. **Group usability.** Match remote laser trails to the local effect and identity color, add subtle audio activity indicators and a clearer incoming-sound prompt. Player identity/color editing already exists under the pencil beside your name in Online. Explore sharing screen video/audio from one capture to reduce duplicate browser indicators; the app cannot hide browser-owned sharing bars.
3. **Group playtest and fixes.** Test with 2–6 people on different networks, including Brave and physical camera/OBS/screen/audio pickers. Check reconnects, saved-room recovery, source changes, pointer latency and browser differences. Fix the issues found before calling the full feature demo ready.

The core feature implementation is complete for a local online demo. Hosting, relay verification and a real group playtest are still required to verify internet readiness. Docker/deployment files include the live signaling service, but no public service or TURN relay has been deployed. Public hosting needs a chosen service and any associated cost approved by the owner.

## Later, if playtests justify it

Requested tabletop additions, queued after internet verification and the first group usability pass:

- **GM-only object visibility.** Enforce visibility in server snapshots, assets/media, history and live subscriptions, including nested objects. Client-side hiding alone would not make an object private. This is separate from edit permissions and visual Obscure.
- **Lasso paint.** Add/subtract filled drawing regions with the smooth controls of Obscure, suitable for quick cave/map painting.
- **Grid layers.** Optional world grid above content, plus per-surface masked grids using the world scale while following the surface's rotation.

Observer roles, smaller delta broadcasts, unused-file cleanup, account-based room recovery and larger-group media routing. These are outside the initial full feature demo.

Finished updates should report what changed, what passed verification, and a short list of the next milestones. See [ONLINE.md](ONLINE.md) for current behavior and launch instructions.
