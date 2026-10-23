import { z } from 'zod';
import { ScheduleSchema } from '@/core/scheduling/schedule';
import { TournamentSchema, type Tournament } from '@/core/tournaments/tournament';
import { SCREEN_SCHEMA_VERSION } from './wire';

// The full snapshot the TV trusts (spec 08 §2): the persisted records, parsed with their own
// schemas, so whatever the relay hands back is checked before it's rendered.

/**
 * What a screen may see of a tournament (spec 08 §2): enough to draw the clock, nothing more.
 * Anyone with the code can read the snapshot, so the chip inventory (setup draft), allocation,
 * player names and results stay on the phone.
 */
export function forScreen(tournament: Tournament): Tournament {
  const { count, remaining } = tournament.participants;
  const shown: Tournament = { ...tournament, participants: { count, remaining } };
  delete shown.setupDraft;
  delete shown.allocation;
  delete shown.inventoryId;
  delete shown.results;
  delete shown.firedAlerts;
  return shown;
}

export const ScreenSnapshotSchema = z.object({
  schemaVersion: z.literal(SCREEN_SCHEMA_VERSION),
  tournament: TournamentSchema,
  schedule: ScheduleSchema,
  sentAt: z.number().int().nonnegative(),
});
export type ScreenSnapshot = z.infer<typeof ScreenSnapshotSchema>;

export const ScreenReplySchema = z.object({
  snapshot: ScreenSnapshotSchema,
  /** The server's clock when it stored the snapshot. */
  receivedAt: z.number().int().nonnegative(),
  /** The server's clock when it answered. */
  serverNow: z.number().int().nonnegative(),
});
export type ScreenReply = z.infer<typeof ScreenReplySchema>;

/**
 * Add to the TV's clock to get the phone's (spec 08 §3): how far the TV is behind the server,
 * less how far the phone was behind it when it sent the snapshot.
 */
export function phoneClockOffset(reply: ScreenReply, tvReceivedAt: number): number {
  const tvToServer = reply.serverNow - tvReceivedAt;
  const phoneToServer = reply.receivedAt - reply.snapshot.sentAt;
  return tvToServer - phoneToServer;
}
