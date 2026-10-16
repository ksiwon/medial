import { STAGE_API, type Command } from './protocol';

// How the tablet's presses reach the wall: one at a time, in the order they were pressed.
//
// Presses are separate HTTP requests, and two requests sent together can arrive in either order - a
// "seek" that was meant to come first would then land last and put the day back where the finger
// had already left. So the bus keeps one request in flight; while it is, a newer "seek" replaces an
// older one that has not been sent yet (only where the finger ended up matters), and every other
// press waits its turn. It also says what came of each press, so the tablet never has to assume.

export type PressResult =
  | { kind: 'ok' }
  /** The server took it but no wall was listening: the press went nowhere. */
  | { kind: 'no-wall' }
  /** The code was refused: an earlier run's, or this tablet has been released. */
  | { kind: 'refused' }
  | { kind: 'failed'; reason: string };

export type Post = (command: Command) => Promise<PressResult>;

export interface Bus {
  send(command: Command): void;
  /** Presses that have not been sent yet (a test and a "busy" light read it). */
  pending(): number;
}

export function createBus(post: Post, onResult: (command: Command, result: PressResult) => void): Bus {
  const queue: Command[] = [];
  let running = false;

  const drain = async () => {
    if (running) return;
    running = true;
    try {
      for (let next = queue.shift(); next; next = queue.shift()) {
        let result: PressResult;
        try { result = await post(next); } catch (error) {
          result = { kind: 'failed', reason: error instanceof Error ? error.message : String(error) };
        }
        onResult(next, result);
      }
    } finally {
      running = false;
    }
  };

  return {
    send(command) {
      if (command.name === 'seek') {
        const stale = queue.findIndex((c) => c.name === 'seek');
        if (stale >= 0) queue.splice(stale, 1);
      }
      queue.push(command);
      void drain();
    },
    pending: () => queue.length,
  };
}

/** The real post: the press, with the pairing token, to the server. */
export function postTo(token: string | null, fetcher: typeof fetch = fetch): Post {
  return async (command) => {
    const response = await fetcher(`${STAGE_API}/command?token=${encodeURIComponent(token ?? '')}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(command),
    });
    if (response.status === 403) return { kind: 'refused' };
    if (!response.ok) return { kind: 'failed', reason: `HTTP ${response.status}` };
    const body = (await response.json()) as { delivered?: number };
    return (body.delivered ?? 0) > 0 ? { kind: 'ok' } : { kind: 'no-wall' };
  };
}

/** What the wall shows, said to the server (and on to the tablet). Only the wall's own browser may. */
export async function postState(state: unknown, fetcher: typeof fetch = fetch): Promise<void> {
  await fetcher(`${STAGE_API}/state`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(state),
  });
}
