import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MusicSettings } from '@/core/tournaments/tournament';
import { MusicPanel } from './MusicPanel';
import { MusicPlayer } from './MusicPlayer';
import type { YouTubeApi, YouTubePlayer } from './youtube-api';

// Spec 12: the host's panel writes settings; the TV's player follows them through the API.

const V = 'dQw4w9WgXcQ';
const L = 'PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG';
const song: MusicSettings = { videoId: V, playing: true, volume: 60, shuffle: false, skips: 0 };
const playlist: MusicSettings = { listId: L, playing: true, volume: 60, shuffle: false, skips: 0 };

afterEach(() => vi.useRealTimers());

describe('MusicPanel', () => {
  it('plays a pasted link and rejects anything else', () => {
    const onChange = vi.fn();
    render(<MusicPanel music={undefined} onChange={onChange} onClose={() => undefined} />);
    const box = screen.getByLabelText('YouTube link');
    fireEvent.change(box, { target: { value: 'not a link' } });
    fireEvent.click(screen.getByRole('button', { name: 'Play on TV' }));
    expect(screen.getByRole('alert')).toHaveTextContent("doesn't look like a YouTube");
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.change(box, { target: { value: `https://youtu.be/${V}` } });
    fireEvent.click(screen.getByRole('button', { name: 'Play on TV' }));
    expect(onChange).toHaveBeenCalledWith(song);
  });

  it('pauses, skips, shuffles and stops a playlist', () => {
    const onChange = vi.fn();
    render(<MusicPanel music={playlist} onChange={onChange} onClose={() => undefined} />);
    expect(screen.getByRole('status')).toHaveTextContent('Playlist playing on the TV.');
    fireEvent.click(screen.getByRole('button', { name: 'Pause music' }));
    expect(onChange).toHaveBeenLastCalledWith({ ...playlist, playing: false });
    fireEvent.click(screen.getByRole('button', { name: 'Next song' }));
    expect(onChange).toHaveBeenLastCalledWith({ ...playlist, skips: 1 });
    fireEvent.click(screen.getByRole('button', { name: 'Shuffle' }));
    expect(onChange).toHaveBeenLastCalledWith({ ...playlist, shuffle: true });
    fireEvent.click(screen.getByRole('button', { name: 'Stop music' }));
    expect(onChange).toHaveBeenLastCalledWith(undefined);
  });

  it('saves the volume once the slider settles', () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    render(<MusicPanel music={song} onChange={onChange} onClose={() => undefined} />);
    const slider = screen.getByRole('slider');
    fireEvent.change(slider, { target: { value: '40' } });
    fireEvent.change(slider, { target: { value: '30' } });
    expect(onChange).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(500));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ ...song, volume: 30 });
  });

  it("doesn't undo a stop made while the slider settles", () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const { rerender } = render(<MusicPanel music={song} onChange={onChange} onClose={() => undefined} />);
    fireEvent.change(screen.getByRole('slider'), { target: { value: '40' } });
    fireEvent.click(screen.getByRole('button', { name: 'Stop music' }));
    rerender(<MusicPanel music={undefined} onChange={onChange} onClose={() => undefined} />);
    act(() => vi.advanceTimersByTime(500));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(undefined);
  });
});

function fakeApi() {
  const player = {
    playVideo: vi.fn(),
    pauseVideo: vi.fn(),
    nextVideo: vi.fn(),
    seekTo: vi.fn(),
    setVolume: vi.fn(),
    unMute: vi.fn(),
    setShuffle: vi.fn(),
    setLoop: vi.fn(),
    getPlayerState: vi.fn(() => 1),
  } satisfies YouTubePlayer;
  let events: { onReady?: () => void; onError?: (e: { data: number }) => void } = {};
  const api: YouTubeApi = {
    Player: vi.fn(function (_frame: HTMLIFrameElement, options: { events: typeof events }) {
      events = options.events;
      return player;
    }) as unknown as YouTubeApi['Player'],
  };
  return { player, api, ready: () => act(() => events.onReady?.()), error: () => act(() => events.onError?.({ data: 150 })) };
}

describe('MusicPlayer', () => {
  it('embeds a privacy-enhanced player that follows the host', async () => {
    const yt = fakeApi();
    const loadApi = () => Promise.resolve(yt.api);
    const { rerender } = render(<MusicPlayer music={playlist} alertKey={undefined} loadApi={loadApi} />);
    const frame = screen.getByTitle('YouTube music player');
    expect(frame.getAttribute('src')).toMatch(/^https:\/\/www\.youtube-nocookie\.com\/embed\/videoseries\?/);
    expect(frame.getAttribute('referrerpolicy')).toBe('strict-origin-when-cross-origin');
    await act(async () => undefined);
    yt.ready();
    expect(yt.player.setLoop).toHaveBeenCalledWith(true);
    expect(yt.player.setVolume).toHaveBeenLastCalledWith(60);
    expect(yt.player.playVideo).toHaveBeenCalled();

    rerender(<MusicPlayer music={{ ...playlist, playing: false }} alertKey={undefined} loadApi={loadApi} />);
    expect(yt.player.pauseVideo).toHaveBeenCalled();
    rerender(<MusicPlayer music={{ ...playlist, skips: 1, shuffle: true }} alertKey={undefined} loadApi={loadApi} />);
    expect(yt.player.nextVideo).toHaveBeenCalledTimes(1);
    expect(yt.player.setShuffle).toHaveBeenLastCalledWith(true);
  });

  it('ducks under an alert, then comes back', async () => {
    const yt = fakeApi();
    const loadApi = () => Promise.resolve(yt.api);
    const { rerender } = render(<MusicPlayer music={song} alertKey={undefined} loadApi={loadApi} />);
    await act(async () => undefined);
    vi.useFakeTimers();
    yt.ready();
    rerender(<MusicPlayer music={song} alertKey="levelStart:2" loadApi={loadApi} />);
    expect(yt.player.setVolume).toHaveBeenLastCalledWith(15);
    act(() => vi.advanceTimersByTime(6_000));
    expect(yt.player.setVolume).toHaveBeenLastCalledWith(60);
  });

  it('offers a start button when the TV blocks autoplay', async () => {
    const yt = fakeApi();
    yt.player.getPlayerState.mockReturnValue(-1);
    render(<MusicPlayer music={song} alertKey={undefined} loadApi={() => Promise.resolve(yt.api)} />);
    await act(async () => undefined);
    vi.useFakeTimers();
    yt.ready();
    act(() => vi.advanceTimersByTime(5_000));
    fireEvent.click(screen.getByRole('button', { name: 'Start music' }));
    expect(yt.player.playVideo).toHaveBeenCalledTimes(2);
  });

  it("says when a song can't play, and when YouTube can't be reached", async () => {
    const yt = fakeApi();
    render(<MusicPlayer music={song} alertKey={undefined} loadApi={() => Promise.resolve(yt.api)} />);
    await act(async () => undefined);
    yt.ready();
    yt.error();
    expect(screen.getByRole('status')).toHaveTextContent("can't be played here");

    render(<MusicPlayer music={{ ...song, videoId: 'aaaaaaaaaaa' }} alertKey={undefined} loadApi={() => Promise.reject(new Error('x'))} />);
    expect(await screen.findByText("Can't reach YouTube right now.")).toBeInTheDocument();
  });
});
