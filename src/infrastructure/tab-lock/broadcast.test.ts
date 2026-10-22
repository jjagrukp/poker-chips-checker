import { openTournamentChannel, type TournamentMessage } from './broadcast';

/** In-memory BroadcastChannel: delivers to every other channel with the same name. */
function fakeChannels() {
  const open: Array<{ name: string; channel: BroadcastChannel }> = [];
  return (name: string) => {
    const channel = {
      onmessage: null as ((event: MessageEvent) => void) | null,
      postMessage(data: unknown) {
        for (const other of open) {
          if (other.name === name && other.channel !== (channel as unknown)) {
            other.channel.onmessage?.(new MessageEvent('message', { data }));
          }
        }
      },
      close() {
        open.splice(
          open.findIndex((o) => o.channel === (channel as unknown)),
          1,
        );
      },
    } as unknown as BroadcastChannel;
    open.push({ name, channel });
    return channel;
  };
}

describe('openTournamentChannel', () => {
  it('notifies other tabs watching the same tournament', () => {
    const factory = fakeChannels();
    const received: TournamentMessage[] = [];
    const controller = openTournamentChannel('t1', () => undefined, factory);
    openTournamentChannel('t1', (m) => received.push(m), factory);
    openTournamentChannel('t2', (m) => received.push(m), factory);

    controller.notifySaved(4);
    controller.notifySaved();
    expect(received).toEqual([
      { type: 'tournamentSaved', tournamentId: 't1', revision: 4 },
      { type: 'tournamentSaved', tournamentId: 't1' },
    ]);
  });

  it('ignores malformed messages and stops after close', () => {
    const factory = fakeChannels();
    const received: TournamentMessage[] = [];
    const viewer = openTournamentChannel('t1', (m) => received.push(m), factory);
    const raw = factory('tournament:t1');
    raw.postMessage({ type: 'tournamentSaved' });
    raw.postMessage('junk');
    expect(received).toEqual([]);

    viewer.close();
    openTournamentChannel('t1', () => undefined, factory).notifySaved();
    expect(received).toEqual([]);
  });

  it('is a no-op without BroadcastChannel', () => {
    const channel = openTournamentChannel('t1', () => undefined, undefined);
    expect(() => {
      channel.notifySaved(1);
      channel.close();
    }).not.toThrow();
  });
});
