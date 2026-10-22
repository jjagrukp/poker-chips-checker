import { z } from 'zod';

// Controller → viewer change notifications (spec 02 §7.7). Messages carry no data: viewers
// re-read from storage, so IndexedDB stays the single source of truth.
const TournamentMessageSchema = z.object({
  type: z.literal('tournamentSaved'),
  tournamentId: z.string().min(1),
  revision: z.number().int().nonnegative().optional(),
});
export type TournamentMessage = z.infer<typeof TournamentMessageSchema>;

export interface TournamentChannel {
  notifySaved(revision?: number): void;
  close(): void;
}

type ChannelFactory = (name: string) => BroadcastChannel;

const defaultFactory: ChannelFactory | undefined =
  typeof BroadcastChannel === 'undefined' ? undefined : (name) => new BroadcastChannel(name);

export function openTournamentChannel(
  tournamentId: string,
  onMessage: (message: TournamentMessage) => void,
  createChannel: ChannelFactory | undefined = defaultFactory,
): TournamentChannel {
  if (!createChannel) return { notifySaved: () => undefined, close: () => undefined };
  const channel = createChannel(`tournament:${tournamentId}`);
  channel.onmessage = (event: MessageEvent<unknown>) => {
    const parsed = TournamentMessageSchema.safeParse(event.data);
    if (parsed.success && parsed.data.tournamentId === tournamentId) onMessage(parsed.data);
  };
  return {
    notifySaved(revision) {
      const message: TournamentMessage = { type: 'tournamentSaved', tournamentId };
      if (revision !== undefined) message.revision = revision;
      channel.postMessage(message);
    },
    close: () => channel.close(),
  };
}
