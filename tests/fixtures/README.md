`network-music.ogg` is a generated 16-second, mono 330 Hz sine wave, used to test remote OGG playback under delayed table updates. It contains no third-party music. Regenerate with:

```sh
ffmpeg -f lavfi -i "sine=frequency=330:duration=16:sample_rate=24000" -c:a libvorbis -q:a 2 -y tests/fixtures/network-music.ogg
```
