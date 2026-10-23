import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import type { MusicSettings } from '@/core/tournaments/tournament';
import { Icon } from '@/shared/components/Icon';
import { useReveal } from '@/shared/components/reveal';
import {
  buttonPrimary,
  buttonQuiet,
  buttonSecondary,
  card,
  hint,
  input,
  label,
} from '@/shared/components/styles';
import { useT } from '@/shared/messages/tone';
import { parseYouTubeLink } from '../domain/youtube';

// "Music" on the host's phone (spec 12 §1): paste a YouTube link, then play, pause, skip and
// set the volume. Nothing plays here; the shared TV follows these settings.

const DEFAULT_VOLUME = 60;
/** The slider settles before it's saved, so dragging doesn't send a snapshot per step. */
const VOLUME_SETTLE_MS = 400;

interface Props {
  music: MusicSettings | undefined;
  onChange: (music: MusicSettings | undefined) => void;
  onClose: () => void;
}

export function MusicPanel({ music, onChange, onClose }: Props) {
  const t = useT();
  const id = useId();
  const [link, setLink] = useState('');
  const [invalid, setInvalid] = useState(false);
  const [volume, setVolume] = useState(music?.volume ?? DEFAULT_VOLUME);
  const panel = useReveal<HTMLElement>();
  const linkBox = useRef<HTMLInputElement>(null);
  // Nothing playing yet: the link box is what the host came for.
  const startWithLink = useRef(music === undefined);
  useEffect(() => {
    if (startWithLink.current) linkBox.current?.focus({ preventScroll: true });
  }, []);
  const latest = useRef({ music, onChange });
  latest.current = { music, onChange };

  // Another tab or a reload changed it: follow.
  const stored = music?.volume;
  useEffect(() => {
    if (stored !== undefined) setVolume(stored);
  }, [stored]);

  useEffect(() => {
    if (!latest.current.music || latest.current.music.volume === volume) return;
    // Read at save time: a pause, stop or new link in the meantime must not be undone.
    const timer = setTimeout(() => {
      const current = latest.current.music;
      if (current && current.volume !== volume) latest.current.onChange({ ...current, volume });
    }, VOLUME_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [volume]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const source = parseYouTubeLink(link);
    if (!source) {
      setInvalid(true);
      return;
    }
    onChange({
      ...source,
      playing: true,
      volume,
      shuffle: music?.shuffle ?? false,
      skips: music?.skips ?? 0,
    });
    setLink('');
  };

  return (
    <section
      ref={panel}
      aria-labelledby={id}
      className={`${card} mx-auto flex w-full max-w-xl scroll-mt-4 flex-col gap-3`}
    >
      <h2 id={id} className="flex items-center gap-2 font-display text-2xl font-semibold">
        <Icon name="music" className="size-6 text-accent" />
        {t('music.title')}
      </h2>
      <p className={hint}>{t('music.intro')}</p>
      <form onSubmit={submit} className="flex flex-col gap-2" noValidate>
        <label htmlFor={`${id}-link`} className={label}>
          {t('music.link')}
        </label>
        <input
          id={`${id}-link`}
          ref={linkBox}
          type="url"
          inputMode="url"
          autoComplete="off"
          value={link}
          onChange={(e) => {
            setLink(e.target.value);
            setInvalid(false);
          }}
          aria-invalid={invalid}
          aria-describedby={invalid ? `${id}-error` : undefined}
          placeholder="https://youtube.com/…"
          className={input}
        />
        {invalid && (
          <p id={`${id}-error`} role="alert" className="text-sm">
            {t('music.badLink')}
          </p>
        )}
        <button type="submit" className={buttonPrimary}>
          <Icon name="tv" className="size-4" />
          {t(music ? 'music.change' : 'music.play')}
        </button>
      </form>

      {music && (
        <>
          <p role="status" className="text-sm">
            {t(music.playing ? 'music.status.playing' : 'music.status.paused', {
              what: t(music.listId ? 'music.what.playlist' : 'music.what.song'),
            })}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={buttonSecondary}
              onClick={() => onChange({ ...music, playing: !music.playing })}
            >
              <Icon name={music.playing ? 'pause' : 'play'} className="size-4" />
              {t(music.playing ? 'music.pause' : 'music.resume')}
            </button>
            <button
              type="button"
              className={buttonSecondary}
              onClick={() => onChange({ ...music, playing: true, skips: music.skips + 1 })}
            >
              <Icon name="next" className="size-4" />
              {t(music.listId ? 'music.next' : 'music.restart')}
            </button>
            {music.listId && (
              <button
                type="button"
                className={`${buttonSecondary} aria-pressed:border-accent/60 aria-pressed:bg-accent/10 aria-pressed:text-accent-strong`}
                aria-pressed={music.shuffle}
                onClick={() => onChange({ ...music, shuffle: !music.shuffle })}
              >
                {t('music.shuffle')}
              </button>
            )}
          </div>
          <label className="flex items-center gap-3">
            <span className={label}>{t('music.volume')}</span>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={volume}
              onChange={(e) => setVolume(Number(e.target.value))}
              className="min-h-11 flex-1 accent-[var(--color-accent)]"
            />
            <span className="w-10 text-right tabular-nums">{volume}</span>
          </label>
        </>
      )}
      <p className={hint}>{t('music.tvHint')}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={buttonSecondary} onClick={onClose}>
          {t('share.close')}
        </button>
        {music && (
          <button type="button" className={buttonQuiet} onClick={() => onChange(undefined)}>
            <Icon name="flag" className="size-4" />
            {t('music.stop')}
          </button>
        )}
      </div>
    </section>
  );
}
