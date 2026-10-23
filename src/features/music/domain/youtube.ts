// YouTube links pasted by the host (spec 12 §1). Only the ids leave this function, so whatever
// was typed never reaches the TV as a URL.

export interface YouTubeSource {
  videoId?: string | undefined;
  listId?: string | undefined;
}

const VIDEO_ID = /^[\w-]{11}$/;
const LIST_ID = /^[\w-]{2,64}$/;
const HOSTS = new Set(['youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtube-nocookie.com']);

/** Reads a video and/or playlist id from a YouTube link; undefined if it isn't one. */
export function parseYouTubeLink(input: string): YouTubeSource | undefined {
  const text = input.trim();
  if (VIDEO_ID.test(text)) return { videoId: text };
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return undefined;
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const parts = url.pathname.split('/').filter(Boolean);
  let videoId: string | undefined;
  if (host === 'youtu.be') {
    videoId = parts[0];
  } else if (HOSTS.has(host)) {
    if (parts[0] === 'watch') videoId = url.searchParams.get('v') ?? undefined;
    else if (['shorts', 'live', 'embed', 'v'].includes(parts[0] ?? '')) videoId = parts[1];
  } else {
    return undefined;
  }
  const list = url.searchParams.get('list') ?? undefined;
  const source: YouTubeSource = {
    ...(videoId && VIDEO_ID.test(videoId) ? { videoId } : {}),
    ...(list && LIST_ID.test(list) ? { listId: list } : {}),
  };
  return source.videoId || source.listId ? source : undefined;
}

/** The embed address for a source; the TV's player starts from it (spec 12 §2). */
export function embedUrl(source: YouTubeSource, origin: string, autoplay: boolean): string {
  const params = new URLSearchParams({
    enablejsapi: '1',
    origin,
    playsinline: '1',
    rel: '0',
    autoplay: autoplay ? '1' : '0',
  });
  if (source.listId) {
    params.set('list', source.listId);
    params.set('listType', 'playlist');
  }
  const path = source.videoId ?? 'videoseries';
  return `https://www.youtube-nocookie.com/embed/${path}?${params.toString()}`;
}
