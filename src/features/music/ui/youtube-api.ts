// YouTube's IFrame API (spec 12 §2, D46): loaded at runtime on a screen that plays music, never
// bundled. Only the calls the TV player makes are typed.

export interface YouTubePlayer {
  playVideo(): void;
  pauseVideo(): void;
  nextVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  setVolume(volume: number): void;
  unMute(): void;
  setShuffle(shuffle: boolean): void;
  setLoop(loop: boolean): void;
  getPlayerState(): number;
}
export interface YouTubeApi {
  Player: new (
    frame: HTMLIFrameElement,
    options: {
      events: {
        onReady?: () => void;
        onStateChange?: (e: { data: number }) => void;
        onError?: (e: { data: number }) => void;
      };
    },
  ) => YouTubePlayer;
}

/** The script arrived but never said it was ready (its own parts were blocked). */
const READY_TIMEOUT_MS = 15_000;

let loading: Promise<YouTubeApi> | undefined;

/** Loads YouTube's IFrame API once, on the first screen that needs it. */
export function loadYouTubeApi(): Promise<YouTubeApi> {
  loading ??= new Promise<YouTubeApi>((resolve, reject) => {
    const w = window as unknown as { YT?: YouTubeApi; onYouTubeIframeAPIReady?: () => void };
    if (w.YT?.Player) {
      resolve(w.YT);
      return;
    }
    const before = w.onYouTubeIframeAPIReady;
    w.onYouTubeIframeAPIReady = () => {
      before?.();
      clearTimeout(timer);
      if (w.YT) resolve(w.YT);
    };
    const fail = () => {
      loading = undefined;
      script.remove();
      reject(new Error('YouTube unavailable'));
    };
    const timer = setTimeout(fail, READY_TIMEOUT_MS);
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.async = true;
    script.onerror = () => {
      clearTimeout(timer);
      fail();
    };
    document.head.append(script);
  });
  return loading;
}
