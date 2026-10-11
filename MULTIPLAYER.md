# Internet playtest plan

The `feature/online-rooms` branch includes a working room prototype with object ownership/sharing, temporary drag claims, versioned operations, retry deduplication, actor-specific Undo/Redo, authoritative shared dice, private artwork and audio/video file storage. See [ONLINE.md](ONLINE.md) for current behavior and [ROADMAP.md](ROADMAP.md) for progress. File playback is personal; shared playback timing and WebRTC are the next transport milestones.

## First playable room

A host creates a room and shares a join link. A player enters a display name and chooses a presence color. The room opens the same table for everyone, while each browser keeps its own pan, zoom, selection controls, pen preferences, and preset library. Joining should not overwrite a person's local table: local tables and online room snapshots need separate storage keys and an explicit Import into room action.

The prototype uses Node HTTP requests for authenticated mutations and server-sent events for room updates and presence. It requires no extra runtime dependencies. The room server owns shared state and validates versioned changes to individual objects, freehand strokes and widgets. Independent edits merge; overlapping object and hierarchy edits are rejected. Reconnects load an authoritative snapshot, recognize accepted retries and rebase unrelated unsent edits. The service uses a single server and still broadcasts full snapshots.

Keep the first playtest to 2–6 participants, static images, shapes, drawing, nesting, grid, rulers, and dice. That is enough to test whether the shared-table interactions feel good before adding live media transport.

## Identity and presence

- Assign a stable participant ID and a server-issued reconnect credential. Display names are labels, never authentication. Keep host credentials separate from invitation credentials; invite links grant only the intended role. Allow the host to revoke invites and remove participants.
- Remember a participant's name, color, and room membership across refreshes. Authenticate reconnects and recheck the participant's current role. Do not use a socket connection ID as a player identity: it can change on reconnection. [Socket.IO identity guidance](https://socket.io/docs/v4/server-socket-instance).
- Broadcast laser points and current selections in world coordinates. Render each person's color with a name label where needed, so similar colors are still distinguishable. Keep pointer updates transient, throttled, and outside table history; expire stale trails and remove selections when someone leaves.
- Keep cameras and zoom local. “Follow host” can be an explicit, reversible option later. Players should be able to look at different parts of the table without fighting over the view.

## Permissions

Implemented default: the host manages the room, and players edit objects they own or that the host shares with them. A room-level switch permits new objects and canvas drawing; each object's Sharing menu controls who can edit it.

| Action | Host | Player | Observer |
| --- | --- | --- | --- |
| View permitted objects, select, point | Yes | Yes | Yes |
| Roll dice and use a personal ruler | Yes | Yes | Optional |
| Create objects / draw | Yes | Room permission | No |
| Move, rotate, resize, recolor, delete | Any permitted object | Own/shared objects | No |
| Change shared mood, grid, obscure layer | Yes | Explicit grant | No |
| Change roles, invitations, permissions | Yes | No | No |

Objects have a small access policy: owner ID, shared-edit flag, and optional editor IDs. Check permission for the whole affected hierarchy before moving, deleting or reparenting an object. Otherwise a permitted parent could become a way to move a protected child. The host's Sharing action explicitly applies to the selected hierarchy; independently owned tokens remain movable on locked backgrounds. These are editing permissions; all room participants still receive and can inspect the shared artwork.

The server enforces every mutation and asset request. Hiding a toolbar button is only feedback. Reject forged IDs, invalid geometry, denied edits, oversized uploads, and actions against stale object revisions. Use brief server-managed drag ownership so two people grabbing the same object receive clear feedback instead of alternating jumps. Release it on completion, disconnect, or timeout.

The existing Obscure widget is a visual cover that allows click-through; it does not hide data from the browser. Preserve that behavior for the initial playtest. If real secret content is wanted later, add explicit server-filtered visibility and asset authorization, separate from the decorative obscure layer.

## Synchronization and persistence

Represent durable changes as commands with an operation ID, actor ID derived from the authenticated session, room revision, and object revisions. Include create, move, transform, reparent, stroke, delete, widget-setting, and roll commands. Validate on the server, then broadcast accepted changes. Deduplicate retry IDs. Reconnect from a known revision or reload a complete snapshot; do not assume buffered events alone can restore state.

Undo becomes a request to reverse the actor's last accepted operation. It must preserve later edits by other people, rather than restoring an old entire-room snapshot. Keep local view changes and transient presence out of undo.

The server chooses shared dice results once and records participant and color-group metadata. Send one trajectory or deterministic playback package to all clients, anchored in world coordinates; clients do not reroll independently. New arrivals receive result history, not expired animations. Each participant's dice presets remain personal; applying one prepares their next throw.

Artwork and audio/video files now use content-addressed files and room-authorized URLs. Portable exports embed their bytes; server backups include room records and the private asset/media directories. A server restart restores the room, files, roles, recent rolls and playback anchors. Playback has independent versions and receipts, leaving object undo and local listening settings untouched.

## Live sources and deployment

Serve online rooms over HTTPS, with secure WebSocket transport. Camera and microphone access requires a secure context outside the localhost development exception. [MDN capture requirements](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia).

After shared objects are reliable, use WebRTC for screen, camera, virtual camera, and audio tracks. The room server handles signaling and permission to publish/subscribe. Reliable connections across home networks need a TURN relay; transport setup and operating costs must be decided before a media playtest. A small peer mesh is a reasonable initial experiment; an SFU may be needed as participant count or video load grows. [WebRTC signaling](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Signaling_and_video_calling), [TURN guidance](https://webrtc.org/getting-started/turn-server).

Do not expose the current localhost file server as an internet session server. Deploy the authenticated room service and assets together behind HTTPS after a local two-browser test. Choose a hosting region and media budget before public deployment.

## Implementation order and acceptance checks

1. **Identity and presence:** host/join screens, room credentials, remembered identity, colored lasers and selections. Test two independent browser contexts plus refresh, duplicate names, and disconnect cleanup.
2. **Authorized shared objects:** server command validation, hierarchy ownership, drag ownership, drawing, assets, and room snapshots. Test simultaneous grabs, revoked permissions, malicious commands, parent/child policies, and server restart.
3. **Shared utilities:** authoritative dice, host atmosphere/grid/obscure controls, personal presets, and collaboration-aware undo. Test late joining, missed events, zoom differences, and reconnect while rolling.
4. **Uploaded media:** private audio/video storage, browser decoding, bounded uploads, range downloads, copies and portable exports. Implemented.
5. **Shared playback:** authorized room play/pause/restart/seek/loop, late-join timing and browser sound permission, with personal listening volume/mute. Implemented.
6. **Live media:** WebRTC signaling, TURN configuration, source lifecycle and sharing permissions, audio mute/monitoring, and subscription cleanup. Test OBS, screen/tab audio, reconnection, and the final viewer leaving a stream.
7. **Internet playtest:** deploy an invitation-only room over HTTPS; test 2–6 people on different networks. Verify saved-room recovery, permission feedback, pointer latency, file media and live transport. Hosting choices can be prepared earlier; the full feature demo requires this final group test.

See [ROADMAP.md](ROADMAP.md) for the current completion status and next milestones.
