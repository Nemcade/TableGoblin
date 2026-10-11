# Free home playtest

Your computer hosts the room. Tailscale Funnel supplies its HTTPS address. No rented server or purchased domain is needed for this test. Use your own Tailscale account; switching accounts temporarily changes which private network your computer can access.

## After this update

1. Keep the Tailscale Funnel PowerShell window open.
2. Close the terminal window running the old Table Goblin online server. Your saved room stays on disk. Live captures stop and will need reconnecting.
3. Double-click **Open Internet Playtest.bat** in this folder. Keep its terminal window open.
4. Both GM and player refresh their existing **HTTPS room address** in Brave. Keep using the same browser profile to retain your identity. You do not need to make another room.
5. Play an audio file while somebody moves/creates objects. Check whether the remote music remains smooth.
6. In **Live feeds**, reconnect an existing camera or screen source. The receiving player can use **Retry connection** if needed. Try one source first, then audio/other sources.

For **screen picture and sound together**, use **Add → Live screen**, choose a tab/screen in the browser picker and enable **Share audio**. If you already have separate screen and tab-audio captures, stop the old tab-audio source in Audio sources, then use the screen's **Change source** with Share audio enabled. This uses one capture for both parts. Live feeds has **Mute sound** (easy to unmute) and **Stop sound** (picture keeps running; Change source to capture sound again). A screen/window without an available audio option still works as a picture. The app cannot hide the browser's own sharing bar.

If Funnel was stopped, open PowerShell and run:

```powershell
tailscale funnel 4180
```

Open the HTTPS address it prints. If it asks to enable Funnel, follow its setup link under your own account. Keep the computer awake and both server/Funnel windows open during play. Press Ctrl+C in the Funnel window when finished to stop public access.

## What the new launcher adds

It enables Google's public STUN service, the address-discovery endpoint shown in the [WebRTC getting-started guide](https://webrtc.org/getting-started/peer-connections). This helps browsers try a direct live-media connection across the internet. That discovery service sees the network address used for discovery; it does not relay your video/audio. Local-only launches keep the previous offline configuration, and custom operator ICE/TURN settings take precedence.

Direct media will not work on every network. Funnel carries the app, shared objects and uploaded files, but does not act as a live-media relay. If a feed still fails, report which side says it is connecting/failed and whether camera, screen and microphone behave differently. The next step is a TURN relay, rather than changes to object permissions. We have not yet verified this discovery setting with physical devices on different internet connections.

An incognito window or an automated tester on the same computer is useful for checking a separate player identity, permissions, file playback and joining. We also received live video in an invited tester browser through the Funnel address on the host computer. These checks do not exercise different routers/firewalls: a player on another internet connection is still needed to verify cross-network live media.

Music synchronization now keeps a stable clock across delayed room messages, gently corrects small timing differences and avoids repeated seeks during buffering. Explicit pause/seek/restart controls and larger drift recovery remain supported. This has been tested using real OGG playback with queued room updates, but your friend's connection is the next real-world check.

For permanent hosting later, see [deploy/README.md](deploy/README.md). You can leave **Prepare Internet Deployment.bat** alone during this home test.
