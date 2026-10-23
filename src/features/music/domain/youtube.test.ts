import { describe, expect, it } from 'vitest';
import { embedUrl, parseYouTubeLink } from './youtube';

const V = 'dQw4w9WgXcQ';
const L = 'PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG';

describe('parseYouTubeLink', () => {
  it.each([
    [`https://www.youtube.com/watch?v=${V}`, { videoId: V }],
    [`https://youtu.be/${V}?si=abc`, { videoId: V }],
    [`youtube.com/watch?v=${V}&t=42`, { videoId: V }],
    [`https://m.youtube.com/watch?v=${V}`, { videoId: V }],
    [`https://www.youtube.com/shorts/${V}`, { videoId: V }],
    [`https://www.youtube.com/live/${V}`, { videoId: V }],
    [V, { videoId: V }],
    [`https://www.youtube.com/playlist?list=${L}`, { listId: L }],
    [`https://music.youtube.com/watch?v=${V}&list=${L}`, { videoId: V, listId: L }],
    [`  https://www.youtube.com/watch?v=${V}&list=${L}&index=3  `, { videoId: V, listId: L }],
  ])('reads %s', (input, expected) => {
    expect(parseYouTubeLink(input)).toEqual(expected);
  });

  it.each([
    '',
    'hello there',
    `https://vimeo.com/watch?v=${V}`,
    `https://evil.example/youtube.com/watch?v=${V}`,
    'https://www.youtube.com/watch?v=short',
    'https://www.youtube.com/@somechannel',
    'javascript:alert(1)',
  ])('rejects %s', (input) => {
    expect(parseYouTubeLink(input)).toBeUndefined();
  });
});

describe('embedUrl', () => {
  it('builds a privacy-enhanced embed with the JS API on', () => {
    const url = new URL(embedUrl({ videoId: V }, 'https://app.example', true));
    expect(url.origin).toBe('https://www.youtube-nocookie.com');
    expect(url.pathname).toBe(`/embed/${V}`);
    expect(url.searchParams.get('enablejsapi')).toBe('1');
    expect(url.searchParams.get('origin')).toBe('https://app.example');
    expect(url.searchParams.get('autoplay')).toBe('1');
    expect(url.searchParams.has('list')).toBe(false);
  });

  it('uses videoseries for a playlist on its own', () => {
    const url = new URL(embedUrl({ listId: L }, 'https://app.example', false));
    expect(url.pathname).toBe('/embed/videoseries');
    expect(url.searchParams.get('list')).toBe(L);
    expect(url.searchParams.get('autoplay')).toBe('0');
  });
});
