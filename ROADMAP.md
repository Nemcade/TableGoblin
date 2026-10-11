# Table Goblin demo roadmap

The local tabletop demo and the core shared-room demo work. The remaining work is mainly media transport and testing on real internet connections. A full feature demo means the existing tabletop tools, file media and live sources can be used together by a small invited group; it does not require accounts, game rules or public room discovery.

## Completed

- Local tabletop: shapes and masked artwork, nesting, locks, marquee selection, drawing, inline styled text, theme effects, dice, grid/ruler, visual Obscure, file audio/video, live capture, presets, persistence and portable files.
- Shared rooms: invitations, remembered identities, colored lasers/selections, optional participant-view navigation, private artwork, authorized object editing, hierarchy permissions, drag claims, actor undo/redo, shared dice, reconnect recovery and durable room storage.
- GM room controls: confirmed invitation replacement and player removal, preserved objects and transferred ownership, rejected stale requests and revoked sessions.
- Uploaded audio/video files: private stored references, bounded uploads, browser decoding checks, byte-range downloads, refresh/restart, copies, crops, portable exports/imports and rejected-upload recovery.
- Shared file playback: authorized play/pause/restart/seek/loop, independent playback versions and retry receipts, room playhead recovery, late joins, personal mute/volume and explicit sound permission.

## Next milestones

1. **Live sources.** Add authenticated WebRTC signaling and publishing/subscribing for cameras, OBS virtual cameras, screens and audio. Preserve the current source/crop controls, reconnect/source replacement and cleanup across copies. Test locally before relying on public networking.
2. **Hosted playtest and polish.** Choose hosting, configure HTTPS and persistent room storage, configure TURN for live media across home networks, then test with 2–6 people on different networks. Check reconnects, saved-room recovery, source changes, pointer latency and browser differences. Fix the issues found before calling the full feature demo ready.

The main remaining engineering milestone is live media; hosting and a real group playtest are still required to verify internet readiness. Docker/deployment files exist, but no public service or TURN relay has been deployed. Public hosting needs a chosen service and any associated cost approved by the owner.

## Later, if playtests justify it

Observer roles, smaller delta broadcasts, unused-file cleanup, account-based room recovery and larger-group media routing. These are outside the initial full feature demo.

Finished updates should report what changed, what passed verification, and a short list of the next milestones. See [ONLINE.md](ONLINE.md) for current behavior and launch instructions.
