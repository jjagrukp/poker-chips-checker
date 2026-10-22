import { messages, type Message, type MessageKey, type Tone } from './catalogue';

export type { MessageKey, Tone } from './catalogue';

export const DEFAULT_TONE: Tone = 'playful';

export function resolveMessage(message: Message, tone: Tone): string {
  return typeof message === 'string' ? message : message[tone];
}

export function t(key: MessageKey, tone: Tone = DEFAULT_TONE): string {
  return resolveMessage(messages[key], tone);
}
