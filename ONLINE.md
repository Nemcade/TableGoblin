# Online rooms — first playtest

`main` preserves the local application. `feature/online-rooms` adds a room server and the **Online** control in the header.

See [ROADMAP.md](ROADMAP.md) for completed milestones and the remaining work toward a full feature demo.

For a free test hosted from your Windows computer using Tailscale Funnel, follow [PLAYTEST.md](PLAYTEST.md). **Open Internet Playtest.bat** enables public STUN discovery for direct live media; it does not provide a TURN relay or start/change Tailscale. Normal online/local launches retain their previous configuration.

## Open locally

With Node.js 22.12+ installed:

```powershell
npm install
npm run build
npm run start:online
```

Or double-click **Open Online Table Goblin.bat** after the build. It opens `http://127.0.0.1:4180/`. Keep the server window open. The original launcher still opens the local-only server on port 4173.

After updating the app, close the existing online server window (or press Ctrl+C there), reopen the online launcher, and refresh both the GM and player browsers. Refreshing only the browser can load a new app against an older server process. The launcher checks the running server before opening a browser; an outdated process gets a restart explanation instead of silently being reused. Saved rooms and browser identities survive this restart. With an older server, the new app can still display the table in read-only mode and shows **Restart room server**.

Open **Online**, enter a name and pointer color, and create a room. Copy the player invitation into another browser or an independent browser profile. Names are labels; matching names do not grant another participant's identity. A room starts empty. **Table options → Import table** lets the GM import a saved table containing artwork and supported media files. Leaving the room restores the local table that was open before joining. Room state is never saved over the local IndexedDB record.

Browser identities and GM credentials use persistent, HttpOnly cookies scoped to each room. The GM should keep their browser profile; losing its cookies loses GM access in this prototype. Invitation links grant player access, never GM access. Opening a room URL after refresh restores the same identity. Clearing the address fragment returns to the normal entry page on the next reload; the room remains on the server.

## Invitations and participants

The GM's **Online** popup contains **Copy invitation** and **Replace invitation**. Replacement asks for confirmation, invalidates previous invitation links, and updates the link in every connected GM tab. Players already in the room keep their identities and connections.

Use the small remove button beside a player to **Remove player**. The confirmation names the person and explains the effect. Their objects, nested contents, drawings and saved dice results stay on the table; their objects and drawings become the GM's. Editor grants for that identity are cleared, including retained policies used by undo. Duplicate display names remain separate people. The GM cannot remove themselves.

Removal ends every connection for that identity, clears its selection, laser and drag claims, and invalidates its session. The invitation is also replaced, preventing re-entry through an old link. You can deliberately send the new link to admit someone again with a fresh identity; they do not regain their former ownership or grants. This prototype does not provide account-based bans.

The removed browser shows **Room access ended**, stops reconnecting and disables editing. **Return to local table** restores the local table saved before joining. Unsent edits remain available through **Export unsent edit**, with confirmation before leaving without them. If those edits use private room artwork, export creates recovery JSON containing the edits and image references; it cannot download files after access has ended. That recovery file is for data recovery and is not a portable table import. Export a portable room table while still connected when you need a complete offline copy.

Both controls are checked by the server and persisted atomically. Recent retries use the same request identity and do not rotate a link twice. Stale confirmations are rejected. Credentials are checked again after receiving request bodies, artwork uploads and dice simulation, preventing a removed session from committing a pending edit or roll. Removal and replaced invitations survive server restart.

## What is shared

- Shapes, text, raster images (PNG/JPG/WebP/GIF), artwork masks, nesting, object transforms, drawings, deletion, and locks.
- Uploaded audio/video file objects, their crops, and synchronized play/pause/restart/seek/loop. Listening volume and mute are personal.
- Live screens, cameras/OBS virtual cameras and captured audio, using authenticated WebRTC connections. Live feed crops, placement and copies use the same shared objects.
- GM mood, grid and visual Obscure edits. GM cover opacity stays local to the GM's view.
- Colored selection outlines and laser points with participant names. Presence is transient; stale laser points expire and disconnected participants' selections disappear.
- Durable room contents, roles, identities and object ownership/sharing. Server restart preserves them.
- Dice throws, their color groups, participant names, and the last 12 results. Everyone sees the same physical throw in world coordinates.

Pan/zoom, current selection, pen preferences, rulers, preset libraries, dice selection/colors and listening preferences remain personal. Live sources are shared while their publishing browser is connected. The Obscure cover remains a visual mask; room members receive the underlying content.

## Room audio and video files

Drop an MP4, WebM, MP3, WAV, Ogg, FLAC or AAC file, or use **Add → Audio file** / the existing audio panel. The browser checks for a decodable track before creating an object. An audio-only MP4 becomes a visible audio tile, including files sent by a phone. Video appears as a muted loop. Supported codecs depend on the browser. A corrupt drop is rejected without creating an invisible object; a stored file that cannot be decoded or downloaded appears as a removable placeholder and is listed by **Find unavailable media**.

Files upload to private room storage before the object is saved. Each file is limited to 64 MB, with at most 512 MB and 512 distinct files per room. Two media uploads can run at once. These limits are separate from the artwork limits. Matching bytes reuse one stored file; object moves and copies send only references. Wait for **Room connected** after importing media. Interrupted uploads retry; permanently rejected uploads retain **Export unsent edit**, including the pending file bytes.

Everyone in the room can load files. The GM, owner and shared editors can Play/Pause, Restart, Seek and Loop a file for the room, including on locked objects. A compact progress slider appears in the audio panel and the object's right-click menu; dragging previews a position and releasing sends one control. Viewers see playback status but their transport controls are disabled. Volume and **Mute/Unmute for me** stay personal; **Stop my inputs & mute room audio** silences your listening without pausing anyone else. Personal listening preferences survive unrelated edits and reset on refresh. Audio starts paused; videos initially loop muted.

When room audio is playing, **Enable room sound** appears beside the header's audio button or inside the open audio panel. This gives the browser a deliberate listening action. A blocked browser can retry there without changing room playback. Video sound can be enabled through **Unmute for me** in its right-click menu. One person's browser refusing sound never pauses the room.

Playback uses server-clock anchors with bounded drift correction, not a continuously broadcast playhead. Late joins, refreshes and reconnects align to that anchor. This is approximate synchronization for ambience and clips, not sample-accurate audio. Non-looping files stop at their duration; Play restarts an ended file. Playback anchors and retry receipts survive server restart; a playing file's logical timeline advances while the server is stopped. Media must have a readable finite duration of up to seven days to control it.

Transport commands have independent versions and request identities, so playback does not change object versions or object Undo/Redo. Simultaneous stale controls are rejected with an explanation; a lost reply retries the original identity once reconnected. Ownership changes and participant removal are checked again when commands arrive. Deleting or replacing a file discards its transport; copies and undo-restored files receive independent initial playback states. Portable exports preserve media and ordinary object settings, not an active room timeline.

The same object ownership rules apply to moving, cropping, nesting, deleting and copying media. Video crops remain shared and preserve the source aspect ratio. A copied audio tile starts paused and reuses the source file. Portable room exports embed file bytes; copying into a local table or another room downloads the bytes before placement. Importing a portable table into a room uploads its media before saving its objects. Keep access to the source room while copying or exporting.

Media downloads require room authentication, including byte-range seeking, HEAD and conditional-cache requests. Removed sessions cannot fetch more file data. Already downloaded or buffered bytes cannot be recalled from a browser. The server checks container structure and declared types; each browser performs codec decoding. A rejected or unavailable file can be deleted by an authorized object editor.

Files live under `room-data/media/<room-id>/` and survive server restarts. Files remain after deleting an object so undo and recovery still work; unused-file cleanup is a later task. Back up the entire room-data directory. After removal, **Export unsent edit** preserves edits, pending local media bytes and private file references as recovery data; it cannot fetch inaccessible room files.

## Live screens, cameras and audio

Use **Add → Live screen**, **Camera / virtual camera**, or **Audio source**. Camera and screen surfaces use the header's existing **Live feeds** menu for Crop, Change source, Stop and Reconnect. The owner or GM can connect a stopped surface; an active capture must be replaced in the browser sharing it. A different GM browser can stop it first. Shared editors can edit permitted surface geometry/crops without taking over its capture. Copies reuse one feed connection per receiving browser. Cancelling a replacement keeps the previous feed.

The audio panel lists your captured inputs and other participants' live audio. Your input's mute silences it for the room; **Listen locally** and its volume affect your own monitoring. Received streams have **Mute for me**, personal volume and Retry connection. **Enable room sound** grants listening permission for files and live audio. Cameras/screens send video only; share an audio source separately when desired. Browser support determines which tab/system audio sources can be selected.

Adding sources needs GM or player creation permission. Connecting a video source needs source ownership or GM permission. Stopping someone else's source needs GM permission. Removing a player closes their publishing and receiving connections. Revoking player creation permission stops their live audio inputs; source ownership changes are rechecked. Deleting the last surface copy stops its capture. Leaving the room, losing the room connection or reloading stops your captures; camera/screen placeholders and crops remain, with Reconnect available. Captured audio is session-only and is added again through the audio panel. Nothing starts capturing automatically after refresh.

The initial transport is a small peer mesh: eight sources per room, four per publishing browser. Signaling uses authenticated same-origin POST/SSE, is directed to participating browsers, validates connection generations and bounded SDP/ICE, and is kept out of room files and undo. The server retains source descriptors only while their publishing browser is connected. Failed receiving connections retry a few times and then expose Retry connection. Private capture device IDs are never sent to the room server.

For internet testing, configure `TABLE_GOBLIN_ICE_SERVERS` with a JSON array of RTC ICE servers, for example `[{"urls":"stun:your-relay.example:3478"},{"urls":["turn:your-relay.example:3478?transport=udp","turns:your-relay.example:5349?transport=tcp"],"username":"playtest-user","credential":"relay-password"}]`. Set it in the server environment and restart the service. These are placeholders, not a deployed relay. Configuration is returned only to authenticated room members. Relay credentials are intended for their browsers: use restricted playtest credentials and rotate them with your relay operator. Do not commit real credentials.

The default ICE list is empty for local browser tests; public STUN/TURN services are not silently selected. HTTPS and a working TURN relay must be configured and tested before relying on different home networks. Three independent local browser contexts pass real WebRTC video/audio transport tests, but physical devices, browser pickers, Brave and cross-network relay behavior still need a manual group playtest. See [WebRTC peer connections](https://webrtc.org/getting-started/peer-connections) and [TURN configuration](https://webrtc.org/getting-started/turn-server).

## Identity and finding each other

In **Online**, the pencil beside your name opens a compact name and pointer-color editor. **Save identity** updates your selection labels, lasers and participant entry for everyone. **Cancel** discards the draft. Your identity, GM/player role, ownership, sharing grants and object undo history stay the same. Previously saved dice results retain the name recorded for that throw. The updated profile survives refresh and server restart and becomes the suggested identity for future rooms.

If another tab changes your identity while the editor is open, saving asks you to review the current name and color instead of silently overwriting them. Your draft remains available; save again to deliberately replace the newer values, or cancel. Interrupted requests retry with the original request identity, preventing duplicate saves.

Use the crosshair beside another connected person to **Go to their view**. This centers their visible world area in your own window, fitting its different aspect ratio within the normal zoom limits. The popup closes and you can immediately pan or zoom independently. It never moves anyone else's camera or follows their later movements. Finish an active gesture or text edit first. Camera positions are transient presence data, not saved table contents; returning to your local table restores its original camera. With multiple tabs for one identity, the most recently updated view represents that person.

## Room artwork

Drop or paste PNG, JPG, WebP or GIF artwork as usual, or import a portable table. Artwork uploads separately and is stored once per room; objects, copies and undo history refer to its private URL. Moving a large map sends its placement and settings rather than the image bytes. GIF animation and shape masking work with these URLs.

Uploads require GM access, permission to create objects, or an existing object the player can edit. Applying artwork still requires permission for the target object. Only authenticated room members can read its files; references from another room are rejected. Each file is limited to 20 MB, 64 megapixels and 16,384 pixels per dimension. A room holds at most 256 MB across 1,024 distinct artwork files. Duplicate uploads reuse the stored file.

The header shows **Saving** until uploads and object edits are acknowledged. An interrupted upload keeps the pending edit for reconnect/retry. A rejected upload preserves **Export unsent edit** in Online controls while restoring the accepted room table. Wait for **Room connected** before closing the window.

**Export room table** and **Export unsent edit** embed the artwork bytes, so exported files can open locally or be imported into another room. Keep the room connection available until export finishes. Copies within a room reuse its files; copying into a local table or another room embeds the source artwork before placement and needs access to the source room.

The server stores files under `room-data/assets/<room-id>/`. Existing embedded artwork migrates on the room's first load after an update, including undo/redo references. An untouched copy of the original room JSON is kept under `room-data/backups/`. Room identities, permissions and revisions are preserved. Older unreadable images stay as removable placeholders. Files remain stored after an object is deleted, preserving undo and recovery; automatic removal of unused files is not implemented. The storage limit includes these retained files. Back up the entire room directory, including assets and backups.

## Shared dice

Open the **Dice** widget, choose dice and color groups, then **Roll dice**. Both GM and players can roll, including players who cannot add objects. Different participants can throw simultaneously. The server chooses unbiased results once and broadcasts a deterministic physics package; viewers see matching dice positions, final faces, and colors at their own camera zoom.

The result and history identify the roller and retain the colors from that throw. Each browser remembers its own selection, colors, sound preference and widget visibility across refreshes. Named presets remain personal. Room rolls do not replace local-table dice history, and object Undo/Redo does not change dice results.

Dice fade after four seconds at rest. **Clear table dice** removes visible dice only from your own view and keeps shared history. Joining or reconnecting catches up with active throws and restores history without replaying expired animations. Lost acknowledgements retry the same request without generating another result. The server persists the last 12 rolls and 256 request receipts across restarts.

Each participant can roll again after their throw settles. A selection holds at most 20 dice across six color groups; the room allows eight visible throws at once and 30 new requests per participant per minute. Physics runs in server workers so rolling does not block object edits or presence updates.

## Permissions and conflicts

Players initially view, select, pan, measure, roll dice and point. The GM can enable **Allow players to add objects and draw**. Newly created pieces and freehand canvas drawings belong to their creator. Turning creation off still lets a player edit their owned and shared pieces. The GM retains atmosphere/grid/cover and lock controls.

Right-click an object or a selection as the GM and open **Sharing**. Choose its owner, allow everyone to edit, or check specific editors, then **Apply sharing**. This applies to the entire selected hierarchy. New children retain their creator's ownership; nesting alone does not grant control over them. A shared parent cannot be moved, resized, rotated or deleted by a player if it contains protected pieces. A locked map can hold independent tokens that their owners can move freely. Locks protect placement; authorized recoloring and drawing do not move the background. Server checks cover direct commands, stacking order, legacy updates and undo; client-supplied identities cannot grant authority.

Moving, rotating or resizing temporarily claims the piece and its contents for that browser. Another grab shows the holder's name and leaves the piece in place. Claims are renewed during the gesture and pending save, then released when saved, cancelled, disconnected or after a five-second timeout. Separate pieces can move at once. The peer's selection label shows **moving**; room geometry commits on pointer release. Drag claims are transient and never restored after a server restart.

The browser submits operations with a unique request identity and versions for the affected objects, drawings or widgets. Two people can edit separate objects at once; unrelated incoming updates preserve an active drag, brush stroke or inline text session. Parent/child dependencies are checked together. Changes to the same object or affected hierarchy conflict rather than overwriting someone else's work. The latest room version opens, with **Export unsent edit** available to preserve the rejected version. Each object is one conflict unit, including text, image framing and drawings inside it; this does not merge simultaneous typing within one note.

Online pointer gestures commit on release, and text sessions commit when finished by clicking away, Escape or the checkmark. Finish typing and wait for **Room connected** before refreshing. The browser asks before leaving with unsaved room edits; local tables retain their existing save-as-you-type behavior.

Undo and Redo reverse only your own accepted operations. An unrelated edit by another participant remains intact. If the affected object or its hierarchy has changed afterward, reversal is refused with a clear explanation. Undo history and request receipts persist with the room, including through refresh and server restart. History retains at most 80 operations across the room, capped at 8 MB; the current table is always retained. A new edit clears only that participant's redo history.

Reconnects reload authoritative state and rebase unrelated unsent edits. Requests whose acknowledgement was lost retain their identity and are deduplicated against the last 256 receipts. Existing prototype rooms migrate their metadata without changing contents or credentials: previously globally editable objects become shared, and otherwise belong to the GM. Updates still broadcast full authoritative snapshots with compact artwork references; broadcasting only changed entities is a future improvement. Observer roles are not implemented yet.

## Host on the internet

The portable Linux package in [deploy/README.md](deploy/README.md) includes Docker Compose, Caddy HTTPS, persistent room storage, coturn, a configuration generator and backup/playtest instructions. **Prepare Internet Deployment.bat** prepares its private settings from the project folder; it does not publish the app.

The room service serves the app and API together. Deploy one instance behind HTTPS with streaming responses enabled, and keep its room directory on a persistent disk. Session cookies are Secure when `NODE_ENV=production`. There is no cross-origin API; invitations must point to the service's public origin.

| Environment variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `4180` | HTTP service port |
| `HOST` | `127.0.0.1` | Use `0.0.0.0` on a hosting service |
| `TABLE_GOBLIN_DATA` | `./room-data` | Persistent private room directory |
| `NODE_ENV` | unset | Set `production` behind HTTPS |
| `TABLE_GOBLIN_ICE_SERVERS` | `[]` | Authenticated browser STUN/TURN configuration as JSON |
| `TABLE_GOBLIN_INTERNET_PLAYTEST` | unset | Set `1` for public STUN discovery unless custom ICE/TURN settings override it |
| `TABLE_GOBLIN_TURN_URLS` | unset | JSON list of coturn URLs using expiring credentials |
| `TABLE_GOBLIN_TURN_SECRET` | unset | Server-only signing secret shared with coturn; at least 32 characters |

Set both TURN variables together. Authenticated room members receive individually signed credentials valid for 24 hours; the signing secret stays off browser responses and saved rooms. The client refreshes relay configuration halfway through expiry for future connections. Existing connections are retained; sessions longer than 24 hours may need a feed reconnect. The static ICE setting remains available for a managed relay provider. Revoking room membership immediately blocks new signaling/config requests, but previously issued relay credentials remain valid until expiry.

The included Dockerfile builds the app and bundles the server validation code, then runs the service as an unprivileged user. Mount a persistent volume at `/data`. Its production container expects HTTPS at the public reverse proxy. `GET /api/health` is the health endpoint. Room JSON files contain private invitations and credential hashes: keep them on the private volume, back them up, and never serve that directory as static content. `.gitignore` and `.dockerignore` exclude room data and environment files.

Playtest limits: 1,000 objects, 8 MB per table update, 24 current participants, 48 event connections per room, 200 rooms per service. Removing a player frees their participant slot. This is intended for a small invitation-based playtest. Public room discovery and account authentication are not included. No public deployment has been created yet.

## Verify

```powershell
npm test
npm run test:online
npm run test:live
npm run test:browser
```

Online tests use separate browser contexts and an isolated temporary room directory. They check ownership, editor grants, protected groups, locked-map tokens, sharing revocation, forged requests, same-piece grab races and claim cleanup, independent edits, actor Undo/Redo, lost acknowledgements and late responses, active dragging/typing/drawing during incoming updates, old-room migration, restart persistence, identity refresh, presence, reconnect and preservation of the local table. Room controls cover confirmation/cancel, invitation rotation, duplicate names, synchronized GM tabs, transferred ownership, cleared grants, revoked connections and artwork reads, requests/uploads/dice already in progress, unsent-edit recovery, retries and restart persistence. Dice checks cover simultaneous rolls, server-chosen grouped results, matching physical poses at different zoom levels, active reconnect, expired playback, lost roll acknowledgements, personal preferences and the production widget UI. Artwork checks cover large maps, authenticated caching, format/size/foreign-reference rejection, upload races/retries, GIF animation, masked/nested copies, portable export/import, compact operations and backed-up migration.

Identity and navigation checks cover self-only profile updates, durable profile versions, stale tabs, unchanged ownership/entity versions, live labels/colors, reconnect retries, unfinished typing/gestures, different viewport aspect ratios, independent cameras and local camera restoration.

`test:live` uses its own temporary server and three independent browser contexts. It checks actual received camera pixels and audio waveforms, source changes/aspect ratios, crops and copies, late joins, browser refresh, receive retries, permission checks, personal listening, ephemeral signaling, player publishing/removal, last-copy deletion and room leave. Production UI checks use simulated capture devices, keeping real hardware and permission pickers untouched. Unit tests also reject oversized or forged signals and stale connections. Cross-network TURN and physical-device checks remain manual.

`test:deploy` checks coturn-compatible signing/expiry, per-member credentials, invalid configuration, non-overwriting setup, production secure cookies, authenticated credential reads, removed-member rejection, restart recovery and exclusion of signing secrets/relay credentials from saved rooms. Live tests also cover configuration renewal/retry without replacing an established media connection. Docker/HTTPS/public relay checks are separate steps in the deployment guide.

`npm run test:music` checks actual remote OGG decoding/playback while ordered room messages are queued for over a second and objects are moved/created. It verifies continuous playhead progress without seek interruptions. Player unit tests cover delayed/duplicate clock samples, small drift correction, deliberate seeks, large drift, buffering and loop boundaries. Network-delay samples no longer rewind the music clock; small drift uses gentle playback-speed correction rather than seeking.

File-media checks cover private uploads, format/truncation rejection, byte-range playback, ownership, removed sessions and interrupted uploads, real WAV/audio-only MP4/WebM/MP4 decoding, shared transport through remote edits, personal listening, crop/copy behavior, refresh/restart, compact commands and portable/recovery exports. Playback checks cover owner/editor authorization, independent object versions/undo, stale controls, locks, durable retry receipts, commands interrupted by removal, delayed HTTP replies, lost acknowledgements, sound rejection/retry, drift correction, single-command seeks and non-looping end/replay.
