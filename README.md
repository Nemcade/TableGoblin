# Table Goblin

A tabletop for play: colored shapes, image tokens, drawing, physical nesting, live screens/cameras, audio sources, looping video/GIF surfaces, atmosphere, and optional dice/grid/obscure widgets. No accounts or game rules. This branch also includes an online room playtest with shared objects, colored presence, permissions and shared physical dice; see [ONLINE.md](ONLINE.md).

## Open the app

**Double-click `Open Table Goblin.bat`.** The launcher starts a server on your computer and opens your default browser. Keep the terminal window open while using the table; close it to stop. Chrome or Edge is recommended for live capture.

When cloning from GitHub, first run `npm install` and `npm run build` to generate `dist/` and the bundled room server. Once built, the local launcher needs Node.js 22.12 or newer and works without an internet connection. It can also use the Node runtime bundled with Codex. If Node is missing, install it from https://nodejs.org.

Alternatively, run `node scripts/launch.cjs`. The server uses `127.0.0.1:4173`, reuses a running instance for this folder, and tries another port if occupied.

## Your table and saving

The first launch opens an empty table. Choose **Add → Shapes** or drop an image to begin. The table saves automatically in this browser. The header shows **SAVING…**, **SAVED LOCALLY**, or **NOT SAVED**. A failed write preserves the previous complete save and explains how to export your work.

If a saved table cannot be opened, a persistent recovery notice identifies the rejected settings or object. Automatic saving stays paused so the empty view or new changes cannot overwrite the original. **Export saved data** downloads that original record, including media, as a `.recovery.json` file for diagnosis and repair; this differs from **Export table**, which exports the current on-screen table. **Retry** reads the browser copy again without clearing it. New saves are validated with the same rules as loading before replacing the previous save.

Older builds could save a video surface with an invalid height when a file had no readable video dimensions. Such saves recover automatically: the surface gets a normal size, the other table contents and settings stay intact, and an untouched original is retained in browser storage and under **Table options → Export saved data**. Playable audio-only files become audio tiles. Unreadable files show a named error placeholder.

Reloading restores objects, hierarchy, drawings, masked art, crop settings, imported images/GIFs/video/audio files, camera position, mood, dice groups/history/sound, grid/ruler, obscure mask, and pen settings. The scene and its media blobs are saved together atomically in IndexedDB. Named presets use browser local storage, independently of the table. Audio files return paused.

The table menu contains:

- **Clear table:** removes objects and drawings. Undo restores them during the current page session. The empty table stays empty on reload.
- **Export table:** downloads a portable `.goblin.json` file containing the current scene, settings, and imported media.
- **Import table:** validates the entire file and its media before replacing anything. Invalid files leave your work intact. Importing into a populated table asks before replacement; Undo can restore previous objects during that page session.

Table files include active dice/theme/grid settings, but not the entire named preset library. Browser saving belongs to this browser profile and address. Clearing site data, changing browser/profile or localhost port, and private browsing can remove or separate storage. Export table files for backups and moving tables between computers. Use one editing tab for a local table; collaborative room state will be separate.

Undo/redo history keeps the last 80 changes in memory and resets on reload. Live screen/camera surfaces retain their positions, crops, and drawings but return stopped. Audio inputs also need reconnecting. Closing the page stops all camera and audio captures; starting capture requires browser or OS permission.

## Shapes, nesting, tokens, and drawing

- **Add → Shapes** opens rectangle, rounded rectangle, circle/ellipse, triangle, hexagon, and diamond choices. Pick a starting color, or right-click selected shapes for color controls. Nothing opens automatically when an object is selected. On image tokens, that color becomes the rim.
- With **Select**, drag empty space to marquee-select all intersecting objects. **Shift+drag** adds to the current selection; **Shift+click** still adds/removes individual objects. The rectangle previews selection, respects actual shapes and rotated/nested objects, and works at any pan/zoom. Escape or pointer cancellation restores the previous selection. Space+drag and middle-drag pan instead.
- **Right-click** a selected object (or empty space with a selection) to open optional object/bulk actions: duplicate, delete, and shape color. File media also has crop/artwork and play/pause controls there. Selection alone never opens a panel.
- **Right-click → Lock object** fixes a surface for use as a background. Locked objects are skipped by regular selection and marquee; dragging over them starts a marquee instead of moving the map. Resize/rotation handles disappear and Delete cannot remove them. Right-click the locked surface again for **Unlock object**. Lock/unlock also works on a multiple selection, supports undo/redo, survives reload/export, and is available per surface in **Live feeds**. Unlocked tokens can still attach to and move on a locked map, and drawing/erasing still works on it. Unlock before cropping or reframing artwork. Locks belong to individual objects; they do not lock children, which continue following their parent when the parent is deliberately moved after unlocking.
- Drag a smaller surface mostly onto another to attach it. The receiving surface lights up when overlap reaches 55% and the smaller object's center is inside. Move the parent and its contents travel together. Pull a child away to detach it, keeping its contents. Deleting a parent releases surviving children at their world positions.
- Drag selection edges/corners to resize; the round handle rotates. Parent resizing changes attached positions and drawing scale but keeps child sizes. **Shift** keeps aspect ratio or snaps rotation to 15°. **Alt** allows free stretching of media.
- **Transform**, or **T**, switches to **Move only**: resize/rotation handles disappear. Small objects also use fewer handles at distant zoom levels.
- Select a shape and **Ctrl+V an image** to fill it with masked art. Dragging moves the whole token. **Double-click** or **Edit art** opens artwork pan/zoom; Apply or Cancel ends editing. Art changes and removal support undo.
- Choose **Draw** for pen, highlighter, thickness, colors, and whole-stroke eraser. A stroke belongs to the surface on which it starts; empty-space strokes belong to the table. **Smooth** adjusts pen stabilization: zero follows input closely, higher values steady slow movements. Fine pointer samples and smooth curves keep sparse input from becoming angular, while release preserves the exact endpoint.
- **Laser** leaves a fading trail without a permanent drawing. Erasing does not delete physical objects.
- **Ctrl+C / Ctrl+V** copies a selected hierarchy, including descendants, drawings, artwork, crops, and relative transforms. Pasted roots detach from the original parent. **Ctrl+D**, or Duplicate in the optional right-click menu, creates an offset copy. Multiple selections preserve layout and avoid copying descendants twice.

## Imported media and live sources

- Paste images, drop files, or choose **Add → Image**. **Add → Video / GIF**, or dropping an MP4, WebM, or GIF, creates a looping surface. Videos start muted; right-click the surface for Play/Pause media. Media supports drawing, nesting, transform, and crop.
- File imports wait for decodable media data, not just metadata. Corrupt, unsupported, empty, or stalled files are rejected with their filename; an audio-only MP4 becomes an audio tile. Existing media that cannot be read shows its filename and error on a visible placeholder. **Table options → Find unavailable media** locates and selects failed files, including objects outside the current view, so they can be deleted normally. Repeating the action cycles through remaining failures.
- Double-click a media surface or choose **Crop** to trim edges. Drag the box/handles, **Shift+drag** a new crop, or enter exact edge percentages. Applying preserves source aspect ratio and remaps existing drawings to keep them registered.
- **Add → Live screen** opens the browser sharing picker. Place a screen/window/tab locally and draw on it. The **Live feeds** button in the top-right header manages all screens and cameras in one panel; its badge counts connected sources. Each source appears once, with the number of surfaces that share it. Choose **Stop sharing**, **Reconnect**, or **Change source** without selecting a surface. Cancelling a source change keeps the current feed.
- **Add → Camera / virtual camera** opens source selection. Enable preview, allow camera access, then Place camera. For OBS, start **OBS Virtual Camera** in OBS and refresh the device list. Names may be hidden until permission is granted. Closing an unused preview stops its camera. Placed cameras support the same table interactions as screens.
- Cameras also offer **Reconnect** and **Change source** in **Live feeds**; preview the device and choose **Connect camera**. Device menus stay inside the app and support arrow keys, Home/End, Enter, and Escape.
- **Live feeds** includes **Crop**, **Duplicate**, and **Remove** for each surface. Copies of one feed have expandable **Surface settings**, so their crops stay independent. Click a source name or a specific surface to find it on the table. **Stop all feeds** stops every connected screen/camera stream. The browser manages its own sharing indicator and stop control.
- Copies of live screens/cameras share the existing capture stream but can have separate crops and annotations. Capture ends when its final copy is removed or sharing is stopped. Stopping, reconnecting, or changing a source applies to all its copies, preserving their identities, positions, hierarchy, crops, and drawings. Undo restores a stopped surface and its marks; choose **Reconnect** to restart it.
- Live surfaces follow the actual video frame dimensions when a shared window resizes or the browser switches source. Their width stays fixed and height follows the cropped aspect ratio. If you freely stretch a live surface, its video fits inside without distortion.

## Text

**Add → Text** starts typing directly on the table. Double-click or right-click **Edit text** to edit an existing object. A compact bar sits near the text, with Label/Paragraph, font, exact font size, bold/italic/underline, and a checkmark to finish. Select a word or phrase to style it independently; **Ctrl+B / I / U** also work. With a caret, formatting applies to new typing. Paste inserts plain text. Changes save as you type, including partial formatting, and clicking away, **Escape**, or the checkmark keeps them. **Ctrl+Enter** is an optional shortcut. A whole editing session is one table undo step; **Ctrl+Z / Ctrl+Shift+Z** while typing undo/redo local edits.

**Label (Aa)** grows to fit its text without automatic wrapping; handles scale the type. **Enter** finishes, and **Shift+Enter** adds a deliberate line break. **Paragraph (¶)** wraps to the box width and grows downward. Handles change wrapping width without changing font size; set size separately in the bar or right-click menu. **Enter** adds a line break. Switching modes preserves text and word formatting. Older text objects keep paragraph behavior and their original font.

Text has no background. Drag it onto a shape to attach it, for example a yellow rectangle for a note. Automatic ink follows the theme and adjusts contrast against a plain parent shape. There is no glow by default. **More text settings** holds strikethrough (in the editing bar), alignment, lists, line spacing, custom/automatic color, and optional glow. The right-click menu also has quick mode/font/size settings, along with the usual lock, duplicate and delete actions. Text supports movement, rotation, marquee selection, hierarchy copying, reload, and table export/import like other objects. Empty text is removed when editing finishes, with undo available for deleted existing notes.

The ten requested Google Fonts—Meddon, Cormorant Garamond, Jim Nightshade, Special Elite, Crimson Pro, Roboto, Quicksand, Bebas Neue, Nunito, and IM Fell English—are bundled locally, with Latin/Latin Extended subsets, available regular/bold/italic styles, their licenses, and a source manifest in `public/fonts`. They work offline without sending text to a font service. Original system fonts remain available. Crimson Pro is the starting font. `scripts/fetch-fonts.cjs` can refresh the bundled files during development.

## Audio

Drop an audio file, choose **Add → Audio file**, or import from the top-right **Audio sources** panel. MP3, WAV, M4A, Ogg/Opus, AAC, FLAC, and audio-only MP4/WebM are accepted when the browser can decode them. Each file is a visible tile with its filename and play/pause button. Double-click the filename area to play/pause; dragging that area moves the tile. Right-click for volume, looping, restart, duplicate, or delete. Files start paused, with looping off, and retain their media, volume, and loop settings across reload/export/import. Copies start paused too.

**Audio sources** also lists file playback, volume, and loop controls; click a filename to locate it on the canvas. **Stop all audio** stops captures and pauses/rewinds files without deleting them. Removing a file tile or closing the app stops its player. Older audio-only MP4 video surfaces are recognized and turned into paused audio tiles when their data loads.

**Add → Audio source**, or the top-right speaker button, opens audio controls. **Tab / computer audio** uses the browser picker; choose a tab or entire screen and enable **Share audio**. Availability depends on browser and OS. When no audio track is provided, the app explains this and releases the unused capture. Chrome/Edge on Windows is recommended. The picker requires a video track; it stays attached to keep the session alive but is not placed on the table.

**Audio input → Connect input** supports microphones and virtual audio cables. Each source has a level meter, mute, volume, and **Listen locally**. Local listening starts off to avoid feedback or playing a tab twice. Volume controls local listening. Closing the panel leaves sources connected; stop individual sources or use **Stop all audio**. Captured audio is independent of objects and undo. Live captures remain local; online rooms share uploaded files and their playback.

## Mood and presets

The sun button opens **Table mood**. **Hue**, **Saturation**, and **Lightness** change the background/interface while preserving object artwork and ink. Zero saturation gives grayscale; lightness runs from black to white and interface text adapts for readability. **Gradient** and **Texture** can be reduced or removed for a flat background.

**Campfire** produces a flickering glow; **Treetops** produces moving shade bands. Each remembers its own custom color, chosen with a swatch or hex value. The reset arrow restores that effect's color. **Intensity** reaches 400%; **Spread** changes coverage, **Flicker / Sway** changes variation, and **Pace** controls speed. Zero pace freezes the effect; **Still** disables animation.

**Theme presets**, **Dice presets**, and **Grid presets** are tucked into their relevant panels. Name a setup and **Save** it. Their built-in starting setups are always first and cannot be overwritten; **Basic green** replaces the old theme reset button.

Selecting a preset when current settings differ asks **Overwrite / Duplicate / Cancel**. Overwrite loads the selected setup. Duplicate saves the current setup as a named copy first, then switches. Cancel keeps the current setup. Updating an existing named preset uses the same decision: Overwrite changes that saved preset, Duplicate creates a new preset, and Cancel changes nothing. There is no Apply button. The active settings and named presets survive reloads.

## Optional widgets

**Widgets** (four squares, top right) toggles dice, grid/measure, and obscure independently. All start off on first launch; later launches restore enabled states. A compact dock holds their panels. Collapse it to leave more table space. Hiding a widget keeps its settings and history.

- **3D dice:** click d4/d6/d8/d10/d12/d20/d100 icons to add dice. Two clicks on d6 prepare 2d6. The minus button or right-click removes one. Clear empties the selection; Roll dice throws it. Rigid-body gravity, friction, and collisions create varied spin and settling; the overhead view shows flat final faces and emphasized serif numerals. Dice remain for four seconds, then fade over 0.9 seconds. Result/history remain; Clear table dice removes bodies immediately. Contact sounds vary with collision strength and screen position; the heading's speaker button mutes them and its preference persists. Audio is synthesized locally without sound assets. History keeps 12 rolls and displays six. d100 uses tens and units dice, with 00 + 0 meaning 100. Results use unbiased browser crypto randomness. A worker simulates trajectories before playback; cocked/stacked throws are retried. Each new throw starts at a readable screen size and subsequently follows canvas zoom.
- **Grid & measure:** a background grid follows the infinite table. Square size controls spacing; Rotation turns it around the table origin. Opacity zero keeps the ruler alone. **1 square =** sets units and a free unit name (default 1 m). Use ruler, or **M** while enabled, then drag freely. It never snaps, inspects obstacles, constrains movement, or assigns real-world scale to artwork. Completed measurements follow pan/zoom and update when the grid scale changes. Clear removes the ruler; Escape cancels an unfinished measurement and returns to Select. Grid presets save spacing, rotation, opacity, units, and name without toggling the widget.
- **Obscure:** enabling starts with an infinite visual cover. Reveal cuts a lasso hole; Cover restores concealment. Release closes the loop. **Shift** temporarily reverses the mode. Edges have light feathering. **GM view** makes covered areas translucent. Its **GM cover opacity** slider ranges from fully clear (0%) to opaque (100%); click the percentage for an exact value. The setting survives refresh and applies only in GM view. Cover never blocks clicking, selecting, moving, or drawing beneath it and is not a secrecy/permission system. Cover everything / Reveal everything reset it; its own Undo / Redo restore edits. **Ctrl+Z / Ctrl+Shift+Z** affect this layer while the lasso is active; otherwise table undo applies. **O** activates it; Escape returns to Select and Space+drag still pans. Masks persist on reload.

Expand **Dice colors** for independent body/numeral overrides with a preview and reset arrows. Theme colors and automatic contrasting numerals are the defaults. Changes update existing dice too.

Color ramps preview live while dragging and save the final choice when the picker closes. A shape or text color choice uses one undo step; ramp previews do not repeatedly snapshot or save the table.

**+ Add color group** creates named sets such as Attack and Damage. Give each colors, select its chip, then add its dice. Picker counts/minus controls operate on that group; Roll throws all groups together, and Clear empties all groups. Results/history retain group labels and colors from the throw even if later edited. Up to six groups and 20 dice can be selected. Additional groups' reset arrows use the Main group's defaults. Dice presets save the full selection, group names, and colors; loading one clears visible bodies while preserving history and sound preferences.

## Controls

| Action | Control |
| --- | --- |
| Select / pen / highlighter / eraser / laser | V / D / H / E / L |
| Pan | Space + left drag, or middle drag |
| Zoom toward cursor | Mouse wheel |
| Fit all objects | Home or fit button |
| Marquee selection | Drag empty space with Select |
| Add to selection | Shift + drag |
| Add/remove one object | Shift + click |
| Optional object/bulk actions | Right-click |
| Move several | Drag a selected surface |
| Keep aspect ratio / snap rotation | Shift |
| Free media resize | Alt + resize |
| Delete objects | Delete / Backspace |
| Undo / redo | Ctrl+Z / Ctrl+Shift+Z or Ctrl+Y |
| Cancel gesture | Escape |
| Transform handles / Move only | T |
| Edit text / art / crop media | Double-click |
| Copy/paste hierarchy | Ctrl+C / Ctrl+V |
| Duplicate hierarchy | Ctrl+D |

Click a numeric slider readout to enter an exact value. Enter or blur applies it; Escape cancels. Values remain in range. This works for grid controls, appearance/animation, pen settings, artwork zoom, audio volume, and table zoom. Grid rotation 0 restores alignment; units and crop margins also have direct inputs. Help and contextual panels explain controls without covering the center of the table.

## Development

```powershell
npm install
npm run dev
npm test
npm run build
npm run test:browser
```

The browser suite builds the app and runs installed Edge on Windows, starting/stopping its own server or reusing the app. Set `GOBLIN_BROWSER=chrome` to use Chrome. Other operating systems need Playwright Chromium installed first. Capture tests use generated canvas video/audio sources. Tests cover geometry, parenting, media lifetime/crop/copy, widgets, dice physics/sounds/colors, theme controls, safe presets, complete refresh restoration, portable files, corrupt data, and failed writes. Real permission pickers and physical/OBS devices still require manual checks.

React + TypeScript + Vite, with Canvas 2D rendering, cannon-es dice physics, and gifuct-js GIF decoding. `src/model.ts` owns geometry/hierarchy, `src/engine.ts` owns interactions/history and local saving, `src/table-storage.ts` validates and stores table/media snapshots, `src/render.ts` draws surfaces, `src/dice-physics.ts` and its worker simulate dice, `src/dice-controller.ts` replays them, `src/dice-sound.ts` synthesizes contact sounds, and `src/main.tsx` contains floating controls. `src/MediaEditor.tsx` edits media framing; `src/animated-gif.ts` composes GIF frames.

Nested positions are normalized to parent dimensions. Rotations compose through ancestors; child sizes remain table units. Reparenting converts world coordinates to preserve placement. Parenting uses convex footprint clipping; circles use an overlap polygon and ellipse hit test. Parent hierarchies render as contiguous stacks.
# Online development

Shared rooms are available on `feature/online-rooms`, with colored presence, versioned object editing, safe concurrent changes, private artwork/audio/video files, synchronized file playback, and personal Undo/Redo histories. Listening volume and mute remain personal. Use **Open Online Table Goblin.bat** or `npm run start:online` after building. See [ONLINE.md](ONLINE.md) for joining, permissions, current limits, and deployment, and [ROADMAP.md](ROADMAP.md) for progress and next milestones. The original launcher continues to work for local tables.
