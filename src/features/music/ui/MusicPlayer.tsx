import { useEffect, useRef, useState } from 'react';
import type { MusicSettings } from '@/core/tournaments/tournament';
import { Icon } from '@/shared/components/Icon';
import { buttonPrimary } from '@/shared/components/styles';
import { useT } from '@/shared/messages/tone';
import { embedUrl } from '../domain/youtube';
import { loadYouTubeApi, type YouTubeApi, type YouTubePlayer } from './youtube-api';

// The shared TV's music (spec 12 §2): a small visible YouTube player in the corner (YouTube's
// terms need it on screen, at least 200 × 200), driven by the host's settings in the snapshot.
// The iframe is ours (so it can send a referrer, which embeds need); the IFrame API drives it.

const ENDED = 0;
const PLAYING = 1;
const BUFFERING = 3;
/** Music drops to this share of its volume while an alert sounds. */
const DUCK_TO = 0.25;
const DUCK_MS = 6_000;
/** Still not playing this long after it should: the TV blocked autoplay. */
const BLOCKED_AFTER_MS = 5_000;
/** A playlist where nothing embeds would otherwise skip forever. */
const MAX_ERRORS_IN_A_ROW = 5;

interface Props {
  music: MusicSettings;
  /** Changes each time an alert fires on this screen; the music ducks under it. */
  alertKey: string | undefined;
  loadApi?: () => Promise<YouTubeApi>;
}

export function MusicPlayer(props: Props) {
  // A new song or playlist gets a fresh player.
  return <Player key={`${props.music.videoId ?? ''}|${props.music.listId ?? ''}`} {...props} />;
}

type Problem = 'blocked' | 'unplayable' | 'offline';

function Player({ music, alertKey, loadApi = loadYouTubeApi }: Props) {
  const t = useT();
  const frame = useRef<HTMLIFrameElement>(null);
  const player = useRef<YouTubePlayer>();
  const [ready, setReady] = useState(false);
  const [problem, setProblem] = useState<Problem>();
  const [ducked, setDucked] = useState(false);
  const latest = useRef(music);
  latest.current = music;
  const seenSkips = useRef(music.skips);
  const errors = useRef(0);
  // Fixed at mount: later changes go through the API, not a reload.
  const [src] = useState(() => embedUrl(music, window.location.origin, music.playing));

  useEffect(() => {
    let gone = false;
    loadApi().then(
      (api) => {
        if (gone || !frame.current) return;
        const p = new api.Player(frame.current, {
          events: {
            onReady: () => {
              if (gone) return;
              // An embedded playlist stops after its last video unless told to loop.
              if (latest.current.listId) p.setLoop(true);
              setReady(true);
            },
            onStateChange: ({ data }) => {
              if (gone) return;
              if (data === PLAYING) {
                errors.current = 0;
                setProblem(undefined);
              }
              // A single song repeats; a playlist loops (onReady).
              if (data === ENDED && !latest.current.listId && latest.current.playing) {
                p.seekTo(0, true);
                p.playVideo();
              }
            },
            onError: () => {
              if (gone) return;
              errors.current += 1;
              if (latest.current.listId && errors.current < MAX_ERRORS_IN_A_ROW) p.nextVideo();
              else setProblem('unplayable');
            },
          },
        });
        player.current = p;
      },
      () => {
        if (!gone) setProblem('offline');
      },
    );
    return () => {
      gone = true;
      player.current = undefined;
    };
  }, [loadApi]);

  useEffect(() => {
    if (alertKey === undefined) {
      setDucked(false);
      return;
    }
    setDucked(true);
    const id = setTimeout(() => setDucked(false), DUCK_MS);
    return () => clearTimeout(id);
  }, [alertKey]);

  useEffect(() => {
    const p = player.current;
    if (!ready || !p) return;
    p.unMute();
    p.setVolume(ducked ? Math.round(music.volume * DUCK_TO) : music.volume);
  }, [ready, ducked, music.volume]);

  useEffect(() => {
    const p = player.current;
    if (!ready || !p) return;
    if (!music.playing) {
      p.pauseVideo();
      setProblem((was) => (was === 'blocked' ? undefined : was));
      return;
    }
    p.playVideo();
    const id = setTimeout(() => {
      const state = player.current?.getPlayerState();
      if (state !== PLAYING && state !== BUFFERING) setProblem((was) => was ?? 'blocked');
    }, BLOCKED_AFTER_MS);
    return () => clearTimeout(id);
  }, [ready, music.playing]);

  useEffect(() => {
    const p = player.current;
    if (ready && p && music.listId) p.setShuffle(music.shuffle);
  }, [ready, music.shuffle, music.listId]);

  useEffect(() => {
    const p = player.current;
    if (!ready || !p || music.skips <= seenSkips.current) return;
    seenSkips.current = music.skips;
    if (music.listId) p.nextVideo();
    else p.seekTo(0, true);
  }, [ready, music.skips, music.listId]);

  return (
    <aside
      aria-label={t('music.tv.label')}
      className="fixed bottom-[calc(1.5vh+3.5rem)] left-[2vw] z-[60] flex w-[200px] flex-col gap-2"
    >
      <iframe
        ref={frame}
        src={src}
        title={t('music.tv.player')}
        width={200}
        height={200}
        allow="autoplay; encrypted-media"
        referrerPolicy="strict-origin-when-cross-origin"
        className={`size-[200px] rounded-2xl border border-line bg-black transition-opacity ${
          music.playing ? '' : 'opacity-60'
        }`}
      />
      {problem && (
        <p role="status" className="rounded-xl bg-surface-raised/90 p-2 text-sm">
          {t(`music.tv.${problem}`)}
        </p>
      )}
      {problem === 'blocked' && (
        <button
          type="button"
          className={buttonPrimary}
          onClick={() => {
            player.current?.unMute();
            player.current?.playVideo();
          }}
        >
          <Icon name="play" className="size-4" />
          {t('music.tv.start')}
        </button>
      )}
    </aside>
  );
}
