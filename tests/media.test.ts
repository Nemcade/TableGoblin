import { test } from "node:test";
import assert from "node:assert/strict";
import { mediaState, videoState, waitForMediaData } from "../src/video-source.ts";

const fake = () => Object.assign(new EventTarget(), { error: null, readyState: 0, videoWidth: 0, videoHeight: 0, duration: NaN }) as unknown as HTMLVideoElement;
test("media detection accepts decoded audio without treating it as a picture", () => {
  const audio = { error: null, readyState: 2, duration: 3, videoWidth: 0, videoHeight: 0 };
  assert.equal(mediaState(audio).kind, "audio");
  assert.equal(videoState(audio).state, "error");
  assert.equal(videoState(audio).message, "No readable video track");
  assert.equal(mediaState({ ...audio, videoWidth: 640, videoHeight: 360 }).kind, "video");
  assert.equal(mediaState({ ...audio, duration: 0 }).state, "error");
  assert.equal(mediaState({ ...audio, videoWidth: 640, videoHeight: 0 }).state, "error");
  assert.equal(mediaState({ ...audio, videoWidth: Infinity, videoHeight: Infinity }).state, "error");
});
test("imports wait for decodable data, including audio-only containers, rather than metadata alone", async () => {
  const video = fake(); let finished = false;
  const promise = waitForMediaData(video, 1000).then(kind => { finished = true; return kind; });
  Object.assign(video, { readyState: 1, duration: 2 }); video.dispatchEvent(new Event("loadedmetadata"));
  await Promise.resolve(); assert.equal(finished, false);
  Object.assign(video, { readyState: 2 }); video.dispatchEvent(new Event("loadeddata"));
  assert.equal(await promise, "audio");
});
test("unreadable, stalled and interrupted media reject without leaving an import waiting forever", async () => {
  const bad = fake(), promise = waitForMediaData(bad, 1000);
  Object.assign(bad, { error: { code: 3 } }); bad.dispatchEvent(new Event("error"));
  await assert.rejects(promise, /decoded/);
  const stalled = fake(); Object.assign(stalled, { readyState: 1, videoWidth: 640, videoHeight: 360 });
  await assert.rejects(waitForMediaData(stalled, 20), /timed out/);
  const aborted = fake(), pending = waitForMediaData(aborted, 1000);
  aborted.dispatchEvent(new Event("abort")); await assert.rejects(pending, /interrupted/);
});
