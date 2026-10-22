import { createContext, useCallback, useContext } from 'react';
import { DEFAULT_TONE, isMessageKey, t, type MessageKey, type MessageParams, type Tone } from '.';

// The active tone (Settings, spec 01 §8) for every component; defaults to playful.

export const ToneContext = createContext<Tone>(DEFAULT_TONE);

export type Translate = (key: MessageKey, params?: MessageParams) => string;

export function useT(): Translate {
  const tone = useContext(ToneContext);
  return useCallback((key, params) => t(key, tone, params), [tone]);
}

/** For issue keys that arrive as plain strings (module and domain reports). */
export function useIssueText(): (key: string, params?: MessageParams) => string {
  const translate = useT();
  return useCallback(
    (key, params) => (isMessageKey(key) ? translate(key, params) : key),
    [translate],
  );
}
