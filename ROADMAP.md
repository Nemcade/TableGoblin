# Table Goblin demo roadmap

The local tabletop demo and the core shared-room demo work. The first real internet test through Tailscale Funnel confirmed shared objects, images, permissions and dice. Live media works in local multi-browser tests but still needs a successful cross-network check. A full feature demo means the existing tabletop tools, file media and live sources can be used together by a small invited group; it does not require accounts, game rules or public room discovery.

## Completed

- Local tabletop: shapes and masked artwork, nesting, locks, marquee selection, drawing, inline styled text, theme effects, dice, grid/ruler, visual Obscure, file audio/video, live capture, presets, persistence and portable files.
- Shared rooms: invitations, remembered identities, colored lasers/selections, optional participant-view navigation, private artwork, authorized object editing, hierarchy permissions, drag claims, actor undo/redo, shared dice, reconnect recovery and durable room storage.
- GM room controls: confirmed invitation replacement and player removal, preserved objects and transferred ownership, rejected stale requests and revoked sessions.
- Uploaded audio/video files: private stored references, bounded uploads, browser decoding checks, byte-range downloads, refresh/restart, copies, crops, portable exports/imports and rejected-upload recovery.
- Shared file playback: authorized play/pause/restart/seek/loop, independent playback versions and retry receipts, room playhead recovery, late joins, personal mute/volume and explicit sound permission.
- Live sources: authenticated directed WebRTC signaling for cameras/OBS, screens and captured audio, shared surface copies/crops, source replacement/reconnect, late joins, personal listening, ownership checks, revocation and connection cleanup. Verified in independent local browser contexts; public network/relay testing remains.
- Portable deployment preparation: Linux Docker Compose stack, HTTPS proxy, persistent volumes, coturn with expiring member credentials, private configuration generator, backup/recovery instructions and isolated credential/API checks. Container startup and public networking remain to be verified on the target host.
- First home-hosted internet playtest: shared objects/images, permissions and dice worked through Funnel. Remote OGG stuttering led to a stable playback clock and gentle drift correction, verified with real OGG and delayed updates. An opt-in Windows launcher now enables free STUN discovery; cross-network live media remains unverified.
- Invited tester session through the actual Funnel address: player entry, artwork, owned shape creation/movement/undo, shared dice and identity restoration checked. The tester received live video frames and uninterrupted OGG playback during edits. This browser ran on the host computer, so it does not substitute for a different-network live-media test.
- Join usability: invitations focus on joining, required names have explicit guidance, missing names/links show inline feedback and focus the field, Enter joins/creates, and busy feedback prevents repeated requests. Verified in desktop/mobile layouts and through the real invitation page.
- Group usability: matching local/remote laser glow and smooth fading trails in identity colors, live recoloring, stale-pointer cleanup and alignment at different zooms/display densities. Audio-file tiles have a subtle playhead-driven activity indicator, and an explicit personal listening prompt appears when room sound is available. Verified on desktop/mobile, with unchanged table history and continuous remote OGG playback.

## Next milestones

1. **Free home-hosted media test.** Retest remote music and direct live feeds using Open Internet Playtest.bat with the existing Funnel HTTPS address. If direct feeds cannot connect, configure and verify TURN. Renting a server can wait until the demo is proven.
2. **Shared capture reuse.** Explore sharing screen video/audio from one capture to reduce duplicate browser indicators. The app cannot hide browser-owned sharing bars. Identity/color editing and the first laser/audio usability pass are complete.
3. **Group playtest and fixes.** Test with 2–6 people on different networks, including Brave and physical camera/OBS/screen/audio pickers. Check reconnects, saved-room recovery, source changes, pointer latency and browser differences. Fix the issues found before calling the full feature demo ready.

The core shared tabletop has passed an initial internet test. Live-media networking, music retesting and a fuller group playtest remain before calling the demo internet-ready. Permanent deployment and backup restoration can be verified later using the prepared Docker package; it has not been deployed. Any paid hosting still needs a chosen service and cost approved by the owner.

## Later, if playtests justify it

Requested tabletop additions, queued after internet verification and the first group usability pass:

- **GM-only object visibility.** Enforce visibility in server snapshots, assets/media, history and live subscriptions, including nested objects. Client-side hiding alone would not make an object private. This is separate from edit permissions and visual Obscure.
- **Lasso paint.** Add/subtract filled drawing regions with the smooth controls of Obscure, suitable for quick cave/map painting.
- **Grid layers.** Optional world grid above content, plus per-surface masked grids using the world scale while following the surface's rotation.

Observer roles, smaller delta broadcasts, unused-file cleanup, account-based room recovery and larger-group media routing. These are outside the initial full feature demo.

Finished updates should report what changed, what passed verification, and a short list of the next milestones. See [ONLINE.md](ONLINE.md) for current behavior and launch instructions.
