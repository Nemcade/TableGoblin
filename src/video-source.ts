export const videoLoadTimeout = 15000;
export type VideoState = { state: "loading" | "ready" | "error"; message: string; kind?: "video" | "audio" };
type MediaInfo = Pick<HTMLMediaElement, "error" | "readyState" | "duration"> & Partial<Pick<HTMLVideoElement, "videoWidth" | "videoHeight">>;
export function mediaState(video: MediaInfo, timedOut = false): VideoState {
  if (video.error) return { state: "error", message: video.error.code === 3 ? "Video could not be decoded" : "Video format could not be read" };
  if (video.readyState >= 2) {
    if ((video.videoWidth ?? 0) > 0 && (video.videoHeight ?? 0) > 0 && Number.isFinite(video.videoWidth) && Number.isFinite(video.videoHeight)) return { state: "ready", message: "", kind: "video" };
    if ((video.videoWidth ?? 0) !== 0 || (video.videoHeight ?? 0) !== 0) return { state: "error", message: "Video dimensions could not be read" };
    if (video.duration > 0) return { state: "ready", message: "", kind: "audio" };
    return { state: "error", message: "No readable media track" };
  }
  if (timedOut) return { state: "error", message: "Video loading timed out" };
  return { state: "loading", message: "Loading video…" };
}
export function videoState(video: MediaInfo, timedOut = false): VideoState {
  const state = mediaState(video, timedOut);
  return state.kind === "audio" ? { state: "error", message: "No readable video track" } : state;
}

/** Metadata alone does not prove that a browser can decode any picture frames. */
export function waitForMediaData(video: HTMLVideoElement, timeout = videoLoadTimeout): Promise<"video" | "audio"> {
  return new Promise((resolve, reject) => {
    const finish = (error?: Error, kind?: "video" | "audio") => {
      clearTimeout(timer);
      for (const event of ["loadedmetadata", "loadeddata", "error", "abort"]) video.removeEventListener(event, check);
      if (error) reject(error); else resolve(kind!);
    };
    const check = (event?: Event) => {
      const status = mediaState(video);
      if (event?.type === "abort") finish(new Error("Video loading was interrupted."));
      else if (status.state === "error") finish(new Error(`${status.message}. Try a different file or encoding.`));
      else if (status.state === "ready") finish(undefined, status.kind);
    };
    const timer = setTimeout(() => finish(new Error("Video loading timed out. Nothing was placed on the table.")), timeout);
    for (const event of ["loadedmetadata", "loadeddata", "error", "abort"]) video.addEventListener(event, check);
    check();
  });
}
