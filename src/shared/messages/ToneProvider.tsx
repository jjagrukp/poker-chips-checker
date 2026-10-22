import type { ReactNode } from 'react';
import type { Tone } from '.';
import { ToneContext } from './tone';

export function ToneProvider({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <ToneContext.Provider value={tone}>{children}</ToneContext.Provider>;
}
