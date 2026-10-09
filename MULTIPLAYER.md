# Internet playtest plan

The current app is a local table with automatic browser saving and portable table files. This is the proposed path to an internet playtest; rooms, identities, and network permissions are not implemented yet.

## First playable room

A host creates a room and shares a join link. A player enters a display name and chooses a presence color. The room opens the same table for everyone, while each browser keeps its own pan, zoom, selection controls, pen preferences, and preset library. Joining should not overwrite a person's local table: local tables and online room snapshots need separate storage keys and an explicit Import into room action.

Use a small TypeScript Node server with Socket.IO for room events, durable room snapshots, and reconnects. The room server owns shared state and validates commands. Clients render optimistically and reconcile acknowledged revisions. Socket.IO supplies room broadcasting and reconnection facilities, but recovery can fail, so a fresh authoritative snapshot is still required. [Rooms](https://socket.io/docs/v4/rooms/), [connection state recovery](https://socket.io/docs/v4/connection-state-recovery).

Keep the first playtest to 2–6 participants, static images, shapes, drawing, nesting, grid, rulers, and dice. That is enough to test whether the shared-table interactions feel good before adding live media transport.

## Identity and presence

- Assign a stable participant ID and a server-issued reconnect credential. Display names are labels, never authentication. Keep host credentials separate from invitation credentials; invite links grant only the intended role. Allow the host to revoke invites and remove participants.
- Remember a participant's name, color, and room membership across refreshes. Authenticate reconnects and recheck the participant's current role. Do not use a socket connection ID as a player identity: it can change on reconnection. [Socket.IO identity guidance](https://socket.io/docs/v4/server-socket-instance).
- Broadcast laser points and current selections in world coordinates. Render each person's color with a name label where needed, so similar colors are still distinguishable. Keep pointer updates transient, throttled, and outside table history; expire stale trails and remove selections when someone leaves.
- Keep cameras and zoom local. “Follow host” can be an explicit, reversible option later. Players should be able to look at different parts of the table without fighting over the view.

## Permissions

Provisional default: the host manages the room, and players edit objects they own or that the host shares with them. A room-level switch can permit editing shared objects by everyone. The exact default can be adjusted after the first playtest.

| Action | Host | Player | Observer |
| --- | --- | --- | --- |
| View permitted objects, select, point | Yes | Yes | Yes |
| Roll dice and use a personal ruler | Yes | Yes | Optional |
| Create objects / draw | Yes | Room permission | No |
| Move, rotate, resize, recolor, delete | Any permitted object | Own/shared objects | No |
| Change shared mood, grid, obscure layer | Yes | Explicit grant | No |
| Change roles, invitations, permissions | Yes | No | No |

Give objects a small access policy: owner ID, shared-edit flag, and optional editor IDs. Check permission for the whole affected hierarchy before moving, deleting, reparenting, or copying an object. Otherwise a permitted parent could become a way to move a protected child. Child access must be consistent with its parent; reject contradictory combinations or require the host to resolve them.

The server enforces every mutation and asset request. Hiding a toolbar button is only feedback. Reject forged IDs, invalid geometry, denied edits, oversized uploads, and actions against stale object revisions. Use brief server-managed drag ownership so two people grabbing the same object receive clear feedback instead of alternating jumps. Release it on completion, disconnect, or timeout.

The existing Obscure widget is a visual cover that allows click-through; it does not hide data from the browser. Preserve that behavior for the initial playtest. If real secret content is wanted later, add explicit server-filtered visibility and asset authorization, separate from the decorative obscure layer.

## Synchronization and persistence

Represent durable changes as commands with an operation ID, actor ID derived from the authenticated session, room revision, and object revisions. Include create, move, transform, reparent, stroke, delete, widget-setting, and roll commands. Validate on the server, then broadcast accepted changes. Deduplicate retry IDs. Reconnect from a known revision or reload a complete snapshot; do not assume buffered events alone can restore state.

Undo becomes a request to reverse the actor's last accepted operation. It must preserve later edits by other people, rather than restoring an old entire-room snapshot. Keep local view changes and transient presence out of undo.

The server chooses shared dice results once and records participant and color-group metadata. Send one trajectory or deterministic playback package to all clients, anchored in world coordinates; clients do not reroll independently. New arrivals receive result history, not expired animations. Each participant's dice presets remain personal; applying one prepares their next throw.

Store imported media once with stable asset IDs and room-authorized URLs. Current browser blob URLs and base64 images are local implementation details, not network IDs. Maintain durable server snapshots and a backup/export path. A server restart should restore the room, assets, roles, and recent rolls.

## Live sources and deployment

Serve online rooms over HTTPS, with secure WebSocket transport. Camera and microphone access requires a secure context outside the localhost development exception. [MDN capture requirements](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia).

After shared objects are reliable, use WebRTC for screen, camera, virtual camera, and audio tracks. The room server handles signaling and permission to publish/subscribe. Reliable connections across home networks need a TURN relay; transport setup and operating costs must be decided before a media playtest. A small peer mesh is a reasonable initial experiment; an SFU may be needed as participant count or video load grows. [WebRTC signaling](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Signaling_and_video_calling), [TURN guidance](https://webrtc.org/getting-started/turn-server).

Do not expose the current localhost file server as an internet session server. Deploy the authenticated room service and assets together behind HTTPS after a local two-browser test. Choose a hosting region and media budget before public deployment.

## Implementation order and acceptance checks

1. **Identity and presence:** host/join screens, room credentials, remembered identity, colored lasers and selections. Test two independent browser contexts plus refresh, duplicate names, and disconnect cleanup.
2. **Authorized shared objects:** server command validation, hierarchy ownership, drag ownership, drawing, assets, and room snapshots. Test simultaneous grabs, revoked permissions, malicious commands, parent/child policies, and server restart.
3. **Shared utilities:** authoritative dice, host atmosphere/grid/obscure controls, personal presets, and collaboration-aware undo. Test late joining, missed events, zoom differences, and reconnect while rolling.
4. **Internet playtest:** deploy an invitation-only room over HTTPS; test 2–6 people on different networks. Verify saved-room recovery, permission feedback, pointer latency, and media loading before adding live capture.
5. **Live media:** WebRTC signaling, TURN, source lifecycle and sharing permissions, audio mute/monitoring, and subscription cleanup. Test OBS, screen/tab audio, reconnection, and the final viewer leaving a stream.
