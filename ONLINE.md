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

## What is shared

- Shapes, text, raster images (PNG/JPG/WebP/GIF), artwork masks, nesting, object transforms, drawings, deletion, and locks.
- GM mood, grid and visual Obscure edits. GM cover opacity stays local to the GM's view.
- Colored selection outlines and laser points with participant names. Presence is transient; stale laser points expire and disconnected participants' selections disappear.
- Durable room contents, roles, identities and editing permission. Server restart preserves them.

Pan/zoom, current selection, pen preferences, rulers, preset libraries, and dice remain personal. Shared authoritative dice and live audio/video transport are subsequent stages. The Obscure cover remains a visual mask; room members receive the underlying content.

## Permissions and conflicts

Players initially view, select, pan, measure and point. The GM can enable **Allow players to edit unlocked objects**. That grants collaborative table editing, while the GM retains atmosphere/grid/cover and lock controls. Locked objects and ancestors of locked descendants are protected from player edits. Server checks apply even to forged requests; display names and client-supplied roles cannot grant authority.

The browser submits operations with a unique request identity and versions for the affected objects, drawings or widgets. Two people can edit separate objects at once; unrelated incoming updates preserve an active drag, brush stroke or inline text session. Parent/child dependencies are checked together. Changes to the same object or affected hierarchy conflict rather than overwriting someone else's work. The latest room version opens, with **Export unsent edit** available to preserve the rejected version. Each object is one conflict unit, including text, image framing and drawings inside it; this does not merge simultaneous typing within one note.

Online pointer gestures commit on release, and text sessions commit when finished by clicking away, Escape or the checkmark. Finish typing and wait for **Room connected** before refreshing. The browser asks before leaving with unsaved room edits; local tables retain their existing save-as-you-type behavior.

Undo and Redo reverse only your own accepted operations. An unrelated edit by another participant remains intact. If the affected object or its hierarchy has changed afterward, reversal is refused with a clear explanation. Undo history and request receipts persist with the room, including through refresh and server restart. History retains at most 80 operations across the room, capped at 8 MB; the current table is always retained. A new edit clears only that participant's redo history.

Reconnects reload authoritative state and rebase unrelated unsent edits. Requests whose acknowledgement was lost retain their identity and are deduplicated against the last 256 receipts. Existing prototype rooms migrate their version metadata without changing contents or credentials. Updates still broadcast full authoritative snapshots; separate asset storage and compact update broadcasts are future improvements. There are no object ownership assignments, observer roles, invite revocation, or drag leases yet.

## Host on the internet

The room service serves the app and API together. Deploy one instance behind HTTPS with streaming responses enabled, and keep its room directory on a persistent disk. Session cookies are Secure when `NODE_ENV=production`. There is no cross-origin API; invitations must point to the service's public origin.

| Environment variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `4180` | HTTP service port |
| `HOST` | `127.0.0.1` | Use `0.0.0.0` on a hosting service |
| `TABLE_GOBLIN_DATA` | `./room-data` | Persistent private room directory |
| `NODE_ENV` | unset | Set `production` behind HTTPS |

The included Dockerfile builds the app and bundles the server validation code, then runs the service as an unprivileged user. Mount a persistent volume at `/data`. Its production container expects HTTPS at the public reverse proxy. `GET /api/health` is the health endpoint. Room JSON files contain private invitations and credential hashes: keep them on the private volume, back them up, and never serve that directory as static content. `.gitignore` and `.dockerignore` exclude room data and environment files.

Playtest limits: 1,000 objects, 8 MB per table update, 24 remembered participants, 48 event connections per room, 200 rooms per service. This is intended for a small invitation-based playtest. Public room discovery and account authentication are not included. No public deployment has been created yet.

## Verify

```powershell
npm test
npm run test:online
npm run test:browser
```

Online tests use separate browser contexts and an isolated temporary room directory. They check permissions, malformed/forged requests, overlapping and simultaneous independent edits, actor Undo/Redo, lost acknowledgements and late responses, active dragging/typing/drawing during incoming updates, old-room migration, restart persistence, identity refresh, presence, reconnect and preservation of the local table.
