import { messages, type Message, type MessageKey, type Tone } from './catalogue';

export type { MessageKey, Tone } from './catalogue';

export const DEFAULT_TONE: Tone = 'playful';

export type MessageParams = Readonly<Record<string, unknown>>;

export function resolveMessage(message: Message, tone: Tone): string {
  return typeof message === 'string' ? message : message[tone];
}

/** Replaces `{name}` placeholders; unknown placeholders are left as-is. */
export function interpolate(text: string, params: MessageParams = {}): string {
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

export function t(key: MessageKey, tone: Tone = DEFAULT_TONE, params?: MessageParams): string {
  const text = resolveMessage(messages[key], tone);
  return params ? interpolate(text, params) : text;
}
