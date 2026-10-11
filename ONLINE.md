# Online rooms — first playtest

`main` preserves the local application. `feature/online-rooms` adds a room server and the **Online** control in the header.

## Open locally

With Node.js 22.12+ installed:

```powershell
npm install
npm run build
npm run start:online
```

Or double-click **Open Online Table Goblin.bat** after the build. It opens `http://127.0.0.1:4180/`. Keep the server window open. The original launcher still opens the local-only server on port 4173.

After updating the app, close the existing online server window (or press Ctrl+C there), reopen the online launcher, and refresh both the GM and player browsers. Refreshing only the browser can load a new app against an older server process. The launcher checks the running server before opening a browser; an outdated process gets a restart explanation instead of silently being reused. Saved rooms and browser identities survive this restart. With an older server, the new app can still display the table in read-only mode and shows **Restart room server**.

Open **Online**, enter a name and pointer color, and create a room. Copy the player invitation into another browser or an independent browser profile. Names are labels; matching names do not grant another participant's identity. A room starts empty. **Table options → Import table** lets the GM import a saved table containing supported artwork. Leaving the room restores the local table that was open before joining. Room state is never saved over the local IndexedDB record.

Browser identities and GM credentials use persistent, HttpOnly cookies scoped to each room. The GM should keep their browser profile; losing its cookies loses GM access in this prototype. Invitation links grant player access, never GM access. Opening a room URL after refresh restores the same identity. Clearing the address fragment returns to the normal entry page on the next reload; the room remains on the server.

## Invitations and participants

The GM's **Online** popup contains **Copy invitation** and **Replace invitation**. Replacement asks for confirmation, invalidates previous invitation links, and updates the link in every connected GM tab. Players already in the room keep their identities and connections.

Use the small remove button beside a player to **Remove player**. The confirmation names the person and explains the effect. Their objects, nested contents, drawings and saved dice results stay on the table; their objects and drawings become the GM's. Editor grants for that identity are cleared, including retained policies used by undo. Duplicate display names remain separate people. The GM cannot remove themselves.

Removal ends every connection for that identity, clears its selection, laser and drag claims, and invalidates its session. The invitation is also replaced, preventing re-entry through an old link. You can deliberately send the new link to admit someone again with a fresh identity; they do not regain their former ownership or grants. This prototype does not provide account-based bans.

The removed browser shows **Room access ended**, stops reconnecting and disables editing. **Return to local table** restores the local table saved before joining. Unsent edits remain available through **Export unsent edit**, with confirmation before leaving without them. If those edits use private room artwork, export creates recovery JSON containing the edits and image references; it cannot download files after access has ended. That recovery file is for data recovery and is not a portable table import. Export a portable room table while still connected when you need a complete offline copy.

Both controls are checked by the server and persisted atomically. Recent retries use the same request identity and do not rotate a link twice. Stale confirmations are rejected. Credentials are checked again after receiving request bodies, artwork uploads and dice simulation, preventing a removed session from committing a pending edit or roll. Removal and replaced invitations survive server restart.

## What is shared

- Shapes, text, raster images (PNG/JPG/WebP/GIF), artwork masks, nesting, object transforms, drawings, deletion, and locks.
- GM mood, grid and visual Obscure edits. GM cover opacity stays local to the GM's view.
- Colored selection outlines and laser points with participant names. Presence is transient; stale laser points expire and disconnected participants' selections disappear.
- Durable room contents, roles, identities and object ownership/sharing. Server restart preserves them.
- Dice throws, their color groups, participant names, and the last 12 results. Everyone sees the same physical throw in world coordinates.

Pan/zoom, current selection, pen preferences, rulers, preset libraries, dice selection/colors and sound preferences remain personal. Live audio/video transport is a subsequent stage. The Obscure cover remains a visual mask; room members receive the underlying content.

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

The room service serves the app and API together. Deploy one instance behind HTTPS with streaming responses enabled, and keep its room directory on a persistent disk. Session cookies are Secure when `NODE_ENV=production`. There is no cross-origin API; invitations must point to the service's public origin.

| Environment variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `4180` | HTTP service port |
| `HOST` | `127.0.0.1` | Use `0.0.0.0` on a hosting service |
| `TABLE_GOBLIN_DATA` | `./room-data` | Persistent private room directory |
| `NODE_ENV` | unset | Set `production` behind HTTPS |

The included Dockerfile builds the app and bundles the server validation code, then runs the service as an unprivileged user. Mount a persistent volume at `/data`. Its production container expects HTTPS at the public reverse proxy. `GET /api/health` is the health endpoint. Room JSON files contain private invitations and credential hashes: keep them on the private volume, back them up, and never serve that directory as static content. `.gitignore` and `.dockerignore` exclude room data and environment files.

Playtest limits: 1,000 objects, 8 MB per table update, 24 current participants, 48 event connections per room, 200 rooms per service. Removing a player frees their participant slot. This is intended for a small invitation-based playtest. Public room discovery and account authentication are not included. No public deployment has been created yet.

## Verify

```powershell
npm test
npm run test:online
npm run test:browser
```

Online tests use separate browser contexts and an isolated temporary room directory. They check ownership, editor grants, protected groups, locked-map tokens, sharing revocation, forged requests, same-piece grab races and claim cleanup, independent edits, actor Undo/Redo, lost acknowledgements and late responses, active dragging/typing/drawing during incoming updates, old-room migration, restart persistence, identity refresh, presence, reconnect and preservation of the local table. Room controls cover confirmation/cancel, invitation rotation, duplicate names, synchronized GM tabs, transferred ownership, cleared grants, revoked connections and artwork reads, requests/uploads/dice already in progress, unsent-edit recovery, retries and restart persistence. Dice checks cover simultaneous rolls, server-chosen grouped results, matching physical poses at different zoom levels, active reconnect, expired playback, lost roll acknowledgements, personal preferences and the production widget UI. Artwork checks cover large maps, authenticated caching, format/size/foreign-reference rejection, upload races/retries, GIF animation, masked/nested copies, portable export/import, compact operations and backed-up migration.

Identity and navigation checks cover self-only profile updates, durable profile versions, stale tabs, unchanged ownership/entity versions, live labels/colors, reconnect retries, unfinished typing/gestures, different viewport aspect ratios, independent cameras and local camera restoration.
